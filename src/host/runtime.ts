import { randomUUID } from 'node:crypto'
import type { Account, SelfInfo } from '../protocol.ts'
import { lanIp } from './util.ts'
import { Storage } from './storage.ts'
import { ClientHub } from './client-hub.ts'
import { ChannelRegistry } from './channel-registry.ts'
import { MessageStore } from './message-store.ts'
import { Outbox } from './outbox.ts'
import { PeerNetwork } from './peer-network.ts'
import { Discovery } from './discovery.ts'
import { Messaging } from './messaging.ts'
import { FileTransfer } from './file-transfer.ts'
import { SharedFileStore } from './shared-file-store.ts'
import { Settings } from './settings.ts'
import { HttpGateway } from './http-gateway.ts'
import { AgentRegistry } from './agent-registry.ts'
import { IdentityStore, TrustStore, handshakePayload, type IdentityFile } from './identity.ts'
import { AgentInstaller } from './agent-install.ts'
import type { AgentPackage } from '../protocol.ts'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 宿主运行时组合根：持有各业务模块与共享状态，并负责启动/停止编排。
 *
 * 模块依赖方向：
 * index.ts → Runtime → [Settings | Messaging | PeerNetwork | Discovery | HttpGateway]
 *                         ↘ [Storage / ClientHub / ChannelRegistry / MessageStore / Outbox / FileTransfer]
 * 业务模块间通过 Runtime 组合，不直接互相 import，避免功能耦合与循环依赖。
 */
export class HostRuntime {
  readonly self: SelfInfo = { accountId: '', name: '', nodeId: '', ip: lanIp(), wsPort: 0, hasPsk: false, hasPassword: false }
  psk = ''
  stopped = false

  readonly clients = new ClientHub()
  readonly storage = new Storage()
  readonly channelRegistry = new ChannelRegistry(this)
  readonly messageStore = new MessageStore(this)
  readonly outbox = new Outbox(this)
  readonly fileTransfer = new FileTransfer(this)
  readonly sharedFileStore = new SharedFileStore(this)
  readonly peerNetwork = new PeerNetwork(this)
  readonly discovery = new Discovery(this)
  readonly messaging = new Messaging(this)
  readonly settings = new Settings(this)
  readonly identity = new IdentityStore(join(this.storage.dataDir(), 'identity'))
  readonly trust = new TrustStore(join(this.storage.dataDir(), 'trust.json'))
  private identityData: IdentityFile | undefined
  /** 诊断：本次进程里观察过多少次对端身份 */
  identityObserved = 0
  readonly agents = new AgentRegistry({
    dir: join(this.storage.dataDir(), 'agents'),
    selfAccount: () => this.self.accountId,
    onPublish: (card) => {
      this.peerNetwork.broadcastWire({ t: 'agentCard', card })
      this.clients.push({ t: 'agentsChanged', agents: this.agents.list() })
    },
  })
  /** DSH 的 preset 根目录：既是安装目标，也是「基础 preset」的来源 */
  readonly presetsRoot = join(process.env.DSH_HOME && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh'), '.agent-presets')
  readonly agentInstaller = new AgentInstaller({ presetsDir: this.presetsRoot, registry: this.agents })
  private readonly agentFetches = new Map<string, (pkg: AgentPackage | undefined) => void>()
  readonly gateway = new HttpGateway(this)

  async start(): Promise<void> {
    await this.storage.adoptLegacyData()
    const idResult = await this.identity.loadOrCreate()
    this.identityData = idResult.identity
    await this.trust.load()
    if (idResult.created) this.clients.logEvent(`已生成本机局域网身份 ${idResult.identity.keyId}`)
    await this.agents.load()
    const config = await this.storage.readConfig()
    await this.storage.ensureDataDir()
    this.clients.logEvent(`数据目录：${this.storage.dataDir()}`)
    this.self.nodeId = typeof config.nodeId === 'string' && config.nodeId !== '' ? config.nodeId : randomUUID()
    const acct = config.account
    if (acct && typeof acct.username === 'string' && acct.username !== '') {
      this.self.accountId = acct.username
      this.self.name = typeof acct.displayName === 'string' && acct.displayName !== '' ? acct.displayName : acct.username
    }
    this.psk = typeof config.psk === 'string' ? config.psk : ''
    this.self.hasPsk = this.psk !== ''
    this.self.hasPassword = Boolean(acct?.passwordHash)
    this.channelRegistry.seed(config.channels, config.hiddenChannels)
    await this.saveConfig()
    await this.messageStore.load()
    this.channelRegistry.migrateMessageTargets(this.messageStore.messages)
    await this.sharedFileStore.load()
    await this.outbox.load()
    if (this.stopped) return

    this.self.wsPort = await this.peerNetwork.startPeerServer()
    if (this.stopped) {
      this.peerNetwork.stop()
      return
    }
    if (this.self.wsPort > 0) this.discovery.start()
    this.peerNetwork.startSweep()
    this.clients.logEvent(this.self.accountId !== '' ? `本机账号 ${this.self.name} 上线 (${this.self.ip})` : `本机上线 (${this.self.ip})，等待设置账号`)
  }

  stop(): void {
    this.stopped = true
    this.peerNetwork.stop()
    this.discovery.stop()
    this.gateway.closeClients()
    this.clients.closeAll()
  }

  get keyId(): string { return this.identityData?.keyId ?? '' }

  /** 给 hello / helloAck 签名 */
  signHandshake(nodeId: string): { pubkey: string; keyId: string; ts: number; sig: string } | undefined {
    const data = this.identityData
    if (data === undefined) return undefined
    const ts = Date.now()
    const payload = handshakePayload({ nodeId, accountId: this.self.accountId, ts })
    return { pubkey: data.publicKey, keyId: data.keyId, ts, sig: this.identity.sign(payload) }
  }

  /**
   * 校验对端身份并钉住。
   * 返回 trusted：true=签名有效且钉住一致；false=未提供/无效/冲突（冲突会写告警）。
   */
  async observePeerIdentity(input: { accountId: string; nodeId: string; pubkey?: string; keyId?: string; ts?: number; sig?: string }): Promise<boolean> {
    this.identityObserved += 1
    const { accountId, nodeId, pubkey, keyId, ts, sig } = input
    if (typeof pubkey !== 'string' || typeof keyId !== 'string' || typeof ts !== 'number' || typeof sig !== 'string') {
      this.clients.logEvent(`@${accountId} 未提供身份（旧版本），本次连接标记为未验证`)
      this.peerNetwork.applyIdentity(accountId, undefined, false)
      return false
    }
    const ok = IdentityStore.verifyHandshake({ nodeId, accountId, ts, publicKey: pubkey, keyId, sig })
    if (!ok) {
      this.clients.logEvent(`拒绝 @${accountId} 的身份：签名无效或时间戳过期`)
      this.peerNetwork.applyIdentity(accountId, keyId, false)
      return false
    }
    const outcome = await this.trust.observe(accountId, keyId, pubkey)
    if (outcome === 'new') {
      this.clients.logEvent(`首次见到 @${accountId}，已钉住身份 ${keyId}`)
      this.peerNetwork.applyIdentity(accountId, keyId, true)
      return true
    }
    if (outcome === 'conflict') {
      const pinned = this.trust.get(accountId)?.keyId ?? '?'
      this.clients.logEvent(`身份冲突：@${accountId} 使用了新的公钥（钉住 ${pinned}，本次 ${keyId}），可能有人冒充`)
      this.peerNetwork.applyIdentity(accountId, pinned, false)
      return false
    }
    this.peerNetwork.applyIdentity(accountId, keyId, true)
    return true
  }

  /** 向某个 peer 拉取 agent 包；超时返回 undefined，不抛错。 */
  async fetchAgentPackage(account: string, id: string, timeoutMs = 15000): Promise<AgentPackage | undefined> {
    const peer = this.peerNetwork.peersSnapshot().find((p) => p.accountId === account)
    if (peer === undefined) return undefined
    const reqId = randomUUID()
    return await new Promise<AgentPackage | undefined>((resolve) => {
      const timer = setTimeout(() => {
        this.agentFetches.delete(reqId)
        resolve(undefined)
      }, timeoutMs)
      this.agentFetches.set(reqId, (pkg) => {
        clearTimeout(timer)
        this.agentFetches.delete(reqId)
        resolve(pkg)
      })
      const sent = this.peerNetwork.sendWire(peer.nodeId, { t: 'agentFetch', reqId, accountId: this.self.accountId, id })
      if (!sent) this.clients.logEvent(`agent 包请求排队：${account}/${id}`)
    })
  }

  /** peer 回包 */
  resolveAgentPackage(reqId: string, pkg: AgentPackage | undefined): void {
    const done = this.agentFetches.get(reqId)
    if (done !== undefined) done(pkg)
  }

  /** 连上某个 peer 后，把我的目录同步过去 */
  syncAgentsTo(nodeId: string): void {
    const cards = this.agents.myAgents()
    if (cards.length === 0) return
    this.peerNetwork.sendWire(nodeId, { t: 'agentCardsSync', cards })
  }

  /** 当前配置视角账号；沿用旧文件里的 passwordHash/salt。 */
  private accountWithCredentials(previous?: Account): Account {
    const account: Account = { username: this.self.accountId, displayName: this.self.name }
    if (previous?.passwordHash) {
      account.passwordHash = previous.passwordHash
      account.salt = previous.salt
    }
    return account
  }

  async saveConfig(): Promise<void> {
    const old = await this.storage.readConfig()
    await this.storage.writeConfig({
      nodeId: this.self.nodeId,
      account: this.accountWithCredentials(old.account),
      psk: this.psk || undefined,
      channels: this.channelRegistry.persisted(),
      hiddenChannels: this.channelRegistry.hiddenSnapshot(),
    })
  }

  async persistChannels(): Promise<void> {
    const config = await this.storage.readConfig()
    await this.storage.writeConfig({
      nodeId: this.self.nodeId,
      account: this.accountWithCredentials(config.account),
      psk: (typeof config.psk === 'string' ? config.psk : this.psk) || undefined,
      channels: this.channelRegistry.persisted(),
      hiddenChannels: this.channelRegistry.hiddenSnapshot(),
    })
  }

}
