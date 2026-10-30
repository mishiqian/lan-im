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
  readonly agents = new AgentRegistry({
    dir: join(this.storage.dataDir(), 'agents'),
    selfAccount: () => this.self.accountId,
    onPublish: (card) => {
      this.peerNetwork.broadcastWire({ t: 'agentCard', card })
      this.clients.push({ t: 'agentsChanged', agents: this.agents.list() })
    },
  })
  readonly agentInstaller = new AgentInstaller({
    presetsDir: join(process.env.DSH_HOME && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh'), '.agent-presets'),
    registry: this.agents,
  })
  private readonly agentFetches = new Map<string, (pkg: AgentPackage | undefined) => void>()
  readonly gateway = new HttpGateway(this)

  async start(): Promise<void> {
    await this.storage.adoptLegacyData()
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
