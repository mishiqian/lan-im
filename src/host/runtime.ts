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
import { AgentService } from './agent-service.ts'
import { authorizeCall } from './agent-acl.ts'
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
  /** 宿主上下文：agentService 需要它来创建真实 session */
  ctx: any
  readonly agentService = new AgentService(this)
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
  /** 当前 profile 目录（由 profileContext 注入，供写 preset 行） */
  profileDir = ''
  readonly agentInstaller = new AgentInstaller({
    presetsDir: this.presetsRoot,
    registry: this.agents,
    patchFile: () => (this.profileDir === '' ? undefined : join(this.profileDir, 'cordis.patch.yml')),
  })
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

  /** 远端 agent 调用的待回包请求（reqId → resolve） */
  private readonly agentReplies = new Map<string, (payload: any) => void>()

  /** 发一个 agent 调用帧并等回包；超时返回 undefined */
  private async agentCall(nodeId: string, frame: any, timeoutMs = 30_000): Promise<any> {
    const reqId = String(frame.reqId)
    return await new Promise<any>((resolve) => {
      const timer = setTimeout(() => { this.agentReplies.delete(reqId); resolve(undefined) }, timeoutMs)
      this.agentReplies.set(reqId, (payload) => { clearTimeout(timer); this.agentReplies.delete(reqId); resolve(payload) })
      const sent = this.peerNetwork.sendWire(nodeId, frame)
      if (!sent) this.clients.logEvent(`agent 调用排队（对端未连上）：${frame.t}`)
    })
  }

  /** 收到回包 */
  resolveAgentReply(reqId: string, payload: unknown): void {
    const done = this.agentReplies.get(reqId)
    if (done !== undefined) done(payload)
  }

  /** 调用方：请对端开一个会话 */
  async remoteAgentOpen(account: string, agentId: string): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
    const peer = this.peerNetwork.peersSnapshot().find((p) => p.accountId === account)
    if (peer === undefined) return { ok: false, error: `@${account} 不在线` }
    if (peer.trusted !== true) return { ok: false, error: `@${account} 的身份未通过验证，拒绝调用` }
    const reply = await this.agentCall(peer.nodeId, { t: 'agentOpen', reqId: randomUUID(), agentId, caller: this.self.accountId })
    if (reply === undefined) return { ok: false, error: '对端没有响应（可能离线或未开放调用）' }
    return { ok: reply.ok === true, ...(reply.sessionId ? { sessionId: reply.sessionId } : {}), ...(reply.error ? { error: reply.error } : {}) }
  }

  /** 调用方：发一轮 */
  async remoteAgentSend(account: string, sessionId: string, text: string): Promise<{ ok: boolean; text?: string; error?: string }> {
    const peer = this.peerNetwork.peersSnapshot().find((p) => p.accountId === account)
    if (peer === undefined) return { ok: false, error: `@${account} 不在线` }
    const reply = await this.agentCall(peer.nodeId, { t: 'agentSend', reqId: randomUUID(), sessionId, text }, 180_000)
    if (reply === undefined) return { ok: false, error: '对端没有响应（或这一轮超时）' }
    return { ok: reply.ok === true, ...(reply.text ? { text: reply.text } : {}), ...(reply.error ? { error: reply.error } : {}) }
  }

  /** 作者侧：处理 open —— 校验卡片是否开放调用，再用 preset 或 prompt 落会话 */
  async handleAgentOpen(fromAccount: string, agentId: string, verified: boolean): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
    const card = this.agents.myAgents().find((c) => c.id === agentId)
    const allowed = authorizeCall(
      { accountId: fromAccount, verified },
      card === undefined ? undefined : { id: card.id, authorAccountId: card.author.accountId, callable: card.exposure.callable },
    )
    if (!allowed.ok) {
      this.clients.logEvent(`拒绝 ${fromAccount === '' ? '未识别连接' : '@' + fromAccount} 的调用：${allowed.error}`)
      return { ok: false, error: allowed.error }
    }
    if (card === undefined) return { ok: false, error: '没有这个 agent' }

    const preset = `${this.self.accountId}-${card.id}`
    const common = {
      callerId: fromAccount,
      agentKey: `${card.author.accountId}/${card.id}`,
      prompt: card.prompt,
      tools: card.requires.tools,
      budget: card.requires.budget,
    }
    const withPreset = await this.agentService.open({ ...common, preset })
    if (withPreset.ok) return withPreset
    // preset 行要重启才生效；没注册时退回「会话级 prompt」，别把调用直接打回去
    this.clients.logEvent(`用 preset 开会话失败（${withPreset.error}），退回会话级 prompt`)
    return await this.agentService.open(common)
  }

  /** 这个 agent 的 owner 是谁（用于把 sessionId 路由回正确的 peer） */
  agentOwner(sessionId: string): string | undefined {
    return this.agentService.get(sessionId)?.callerId
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

  /** 由插件入口注入宿主 ctx（agent/session 服务都在上面） */
  attach(ctx: any): void {
    this.ctx = ctx
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
