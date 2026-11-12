import { randomUUID } from 'node:crypto'
import type { Account, SelfInfo } from '../protocol.ts'
import { lanIp } from './util.ts'
import { Storage } from './storage.ts'
import { ClientHub } from './client-hub.ts'
import { ChannelRegistry } from './channel-registry.ts'
import { MessageStore } from './message-store.ts'
import { Outbox } from './outbox.ts'
import { Messaging } from './messaging.ts'
import { FileTransfer } from './file-transfer.ts'
import { SharedFileStore } from './shared-file-store.ts'
import { Settings } from './settings.ts'
import { HttpGateway } from './http-gateway.ts'
import { IdentityStore, TrustStore, handshakePayload, type IdentityFile } from './identity.ts'
import { HubClient, type HubStatus } from './hub-client.ts'
import { HubLauncher } from './hub-launcher.ts'
import { Transport } from './transport.ts'
import { open as openEnvelope, seal as sealEnvelope } from './envelope.ts'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * 宿主运行时组合根：持有各业务模块与共享状态，并负责启动/停止编排。
 *
 * 模块依赖方向：
 * index.ts → Runtime → [Settings | Messaging | PeerNetwork | Discovery | HttpGateway]
 *                         ↘ [Storage / ClientHub / ChannelRegistry / MessageStore / Outbox / FileTransfer]
 * 业务模块间通过 Runtime 组合，不直接互相 import，避免功能耦合与循环依赖。
 */
/** 宿主实际加载的插件版本：用来发现「界面新、宿主旧」这种半新半旧状态 */
export const PLUGIN_VERSION: string = (() => {
  try {
    const file = fileURLToPath(new URL('../package.json', import.meta.url))
    return String((JSON.parse(readFileSync(file, 'utf8')) as { version?: string }).version ?? '0.0.0')
  } catch {
    return '0.0.0'
  }
})()

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
  readonly transport = new Transport(this)
  readonly messaging = new Messaging(this)
  readonly settings = new Settings(this)
  readonly pluginVersion = PLUGIN_VERSION

  /** 枢纽连接（未配置时为 undefined） */
  private hubClient: HubClient | undefined
  private hubConfig: { url: string; invite?: string; certPin?: string } | undefined
  /** account → 对端公钥目录（来自 lookup/presence） */
  private readonly hubDir = new Map<string, { account: string; keyId: string; pubkey: string; prekey: string; seen?: number; name?: string }>()
  private readonly hubByKeyId = new Map<string, { account: string; keyId: string; pubkey: string; prekey: string; seen?: number; name?: string }>()
  private readonly hubLookups = new Map<string, (entry: any) => void>()
  /** LEP 发送序列号（持久化） */
  private hubSeq = 0
  /** 一键起枢纽：托管的本地 hub 子进程 */
  readonly hubLauncher = new HubLauncher()

  readonly identity = new IdentityStore(join(this.storage.dataDir(), 'identity'))
  readonly trust = new TrustStore(join(this.storage.dataDir(), 'trust.json'))
  private identityData: IdentityFile | undefined
  /** 诊断：本次进程里观察过多少次对端身份 */
  identityObserved = 0
  readonly gateway = new HttpGateway(this)

  async start(): Promise<void> {
    await this.storage.adoptLegacyData()
    const idResult = await this.identity.loadOrCreate()
    this.identityData = idResult.identity
    await this.trust.load()
    if (idResult.created) this.clients.logEvent(`已生成本机局域网身份 ${idResult.identity.keyId}`)
    this.clients.logEvent(`lan-im v${PLUGIN_VERSION} 已加载`)
    const config = await this.storage.readConfig()
    await this.storage.ensureDataDir()
    this.clients.logEvent(`数据目录：${this.storage.dataDir()}`)
    this.self.nodeId = typeof config.nodeId === 'string' && config.nodeId !== '' ? config.nodeId : randomUUID()
    this.hubConfig = config.hub
    this.hubSeq = typeof config.hubSeq === 'number' ? config.hubSeq : 0
    let acct = config.account
    if ((acct === undefined || acct.username === '')) {
      // 账号丢失时尝试用上一版配置恢复，避免"打开就是建号页"
      const previous = await this.storage.readPreviousConfig()
      if (previous.account !== undefined && previous.account.username !== '') {
        acct = previous.account
        this.clients.logEvent(`账号信息丢失，已从上一版配置恢复为 ${previous.account.username}`)
      }
    }
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

    this.clients.logEvent(this.self.accountId !== '' ? `本机账号 ${this.self.name} 上线 (${this.self.ip})` : `本机上线 (${this.self.ip})，等待设置账号`)
    this.startHub()
  }

  /** 按配置连接枢纽；未配置就保持离线（M1 起通信全部经枢纽） */
  startHub(): void {
    const id = this.identityData
    if (id === undefined || this.hubConfig === undefined || this.hubConfig.url === '') return
    this.hubClient?.close()
    const client = new HubClient(id, this.hubConfig, { nodeId: this.self.nodeId, accountId: this.self.accountId, name: this.self.name }, {
      onFrame: (frame) => this.onHubFrame(frame),
      onStatus: (status) => {
        this.clients.hubStatus(status)
        if (status.state === 'online') this.clients.logEvent(`已连接枢纽 ${status.hubId ?? status.url}`)
        else if (status.state === 'offline' && status.lastError !== undefined) this.clients.logEvent(`枢纽断开：${status.lastError}`)
      },
    })
    this.hubClient = client
    client.connect()
  }

  stopHub(): void {
    this.hubClient?.close()
    this.hubClient = undefined
  }

  hubStatus(): HubStatus {
    const base = this.hubClient?.getStatus() ?? { state: 'offline', url: this.hubConfig?.url ?? '' }
    const managed = this.hubLauncher.status()
    return { ...base, ...(managed.running ? { managed: true } : {}), ...(base.lastError === undefined && managed.error !== undefined ? { lastError: managed.error } : {}) } as HubStatus
  }

  /** 确认证书指纹（TOFU）后重连 */
  async trustHubPin(): Promise<{ ok: boolean; error?: string }> {
    const pin = this.hubStatus().observedPin
    if (pin === undefined) return { ok: false, error: '还没有观测到证书指纹，请先连接一次' }
    if (this.hubConfig === undefined) return { ok: false, error: '尚未配置枢纽地址' }
    await this.configureHub(this.hubConfig.url, this.hubConfig.invite, pin)
    this.clients.logEvent(`已钉住枢纽证书指纹 ${pin.slice(0, 16)}…`)
    return { ok: true }
  }

  /** 一键起枢纽：拉起本机 hub 子进程并自动连上 */
  async startLocalHub(): Promise<{ ok: boolean; url?: string; invite?: string; error?: string }> {
    const started = await this.hubLauncher.start(this.storage.dataDir(), this.self.ip)
    if (started.running !== true || started.url === undefined) {
      this.clients.logEvent(`启动本机枢纽失败：${started.error ?? '未知原因'}`)
      return { ok: false, ...(started.error === undefined ? {} : { error: started.error }) }
    }
    await this.configureHub(started.url, started.invite)
    this.clients.logEvent(`已在 ${started.url} 启动本机枢纽（邀请码 ${started.invite ?? '无'}）`)
    if (started.adminUrl !== undefined) this.clients.logEvent(`枢纽管理页：${started.adminUrl}`)
    return { ok: true, url: started.url, ...(started.invite === undefined ? {} : { invite: started.invite }) }
  }

  /** 停止托管的枢纽 */
  async stopLocalHub(): Promise<void> {
    this.hubLauncher.stop()
    this.stopHub()
    this.clients.logEvent('本机枢纽已停止')
  }

  /** 保存枢纽配置并立即重连 */
  async configureHub(rawUrl: string, invite?: string, certPin?: string): Promise<void> {
    // 支持“一个地址搞定”：ws://host:port/hlp?invite=XXXX
    let url = rawUrl.trim()
    let inviteFromUrl = ''
    if (url !== '') {
      try {
        const parsed = new URL(url)
        const fromQuery = parsed.searchParams.get('invite')
        if (fromQuery !== null && fromQuery !== '') {
          inviteFromUrl = fromQuery
          parsed.searchParams.delete('invite')
          url = parsed.toString()
        }
      } catch { /* 非法 URL 交给连接时报错 */ }
    }
    const finalInvite = invite === undefined || invite === '' ? inviteFromUrl : invite
    this.hubConfig = url === '' ? undefined : {
      url,
      ...(finalInvite === undefined || finalInvite === '' ? {} : { invite: finalInvite }),
      ...(certPin === undefined || certPin === '' ? {} : { certPin }),
    }
    const config = await this.storage.readConfig()
    await this.storage.writeConfig({
      ...config,
      ...(this.hubConfig === undefined ? { hub: undefined } : { hub: this.hubConfig }),
      hubSeq: this.hubSeq,
    })
    this.stopHub()
    if (this.hubConfig !== undefined) this.startHub()
  }

  private onHubFrame(frame: any): void {
    if (frame.t === 'relay') { void this.onHubRelay(frame); return }
    if (frame.t === 'lookup/result') {
      if (frame.found === true && typeof frame.keyId === 'string') {
        const previous = this.hubByKeyId.get(String(frame.keyId))
        const name = String(frame.name ?? '') || previous?.name || ''
        const entry = {
          account: String(frame.account ?? ''),
          keyId: String(frame.keyId),
          pubkey: String(frame.pubkey ?? ''),
          prekey: String(frame.prekey ?? ''),
          ...(name === '' ? {} : { name }),
        }
        this.rememberPeer(entry)
        this.hubLookups.get(entry.account)?.(entry)
        this.hubLookups.get(entry.keyId)?.(entry)
      }
      return
    }
    if (frame.t === 'presence') {
      const keyId = String(frame.keyId ?? '')
      const account = String(frame.account ?? '')
      if (keyId === '' || account === '') return
      const prev = this.hubByKeyId.get(keyId)
      const name = String(frame.name ?? '')
      this.rememberPeer({ account, keyId, pubkey: prev?.pubkey ?? '', prekey: prev?.prekey ?? '', ...(name === '' ? {} : { name }) })
      const entry = this.hubByKeyId.get(keyId)
      if (entry !== undefined) entry.seen = Date.now()
      this.clients.peers(this.hubPeers())
      return
    }
  }

  private rememberPeer(entry: { account: string; keyId: string; pubkey: string; prekey: string; seen?: number; name?: string }): void {
    if (entry.account !== '') this.hubDir.set(entry.account, entry)
    this.hubByKeyId.set(entry.keyId, entry)
  }

  /** 查目录（缓存优先，未命中则向枢纽 lookup 并等待） */
  async resolvePeer(accountOrKeyId: string, timeoutMs = 4000): Promise<{ account: string; keyId: string; pubkey: string; prekey: string } | undefined> {
    const key = accountOrKeyId
    const cached = this.hubDir.get(key) ?? this.hubByKeyId.get(key)
    // presence 预热只带 account/keyId；缺公钥时必须再 lookup 一次
    if (cached !== undefined && cached.pubkey !== '' && cached.prekey !== '') return cached
    const client = this.hubClient
    if (client === undefined || client.getStatus().state !== 'online') return undefined
    const result = await new Promise<any>((resolve) => {
      const timer = setTimeout(() => { this.hubLookups.delete(key); resolve(undefined) }, timeoutMs)
      this.hubLookups.set(key, (entry) => { clearTimeout(timer); this.hubLookups.delete(key); resolve(entry) })
      const byKeyId = /^[A-Z2-7]{16}$/.test(key)
      client.send({ t: 'lookup', v: 1, ...(byKeyId ? { keyId: key } : { account: key }) })
    })
    return result
  }

  /**
   * 文件分片的安全发送间隔：按枢纽下发的配额算，留 30% 余量。
   * envelope 走 base64，长度约为原文的 1.37 倍。
   */
  hubChunkPaceMs(plainChunkBytes: number): number {
    const limits = this.hubClient?.limits ?? {}
    const msgPerSec = limits.msgPerSec ?? 50
    const bytesPerSec = limits.bytesPerSec ?? 4 * 1024 * 1024
    const envelopeBytes = Math.ceil(plainChunkBytes * 1.37) + 512
    const byBytes = envelopeBytes / (bytesPerSec * 0.7) * 1000
    const byCount = 1000 / (msgPerSec * 0.7)
    return Math.ceil(Math.max(byBytes, byCount))
  }

  /** 命中限流惩罚时先等一等，避免继续丢帧 */
  async hubWaitPause(): Promise<void> {
    const remaining = this.hubClient?.pauseRemaining() ?? 0
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
  }

  /** 经枢纽发一条应用层消息（LEP 封装） */
  async sendViaHub(toAccount: string, kind: 'text' | 'channel' | 'receipt' | 'presence' | 'file-meta' | 'file-chunk', payload: unknown): Promise<boolean> {
    const client = this.hubClient
    const identity = this.identityData
    if (client === undefined || identity === undefined || client.getStatus().state !== 'online') return false
    // 冷启动时目录可能还没热（lookup 在连上枢纽后才可用）：再等一次
    let peer = await this.resolvePeer(toAccount)
    if (peer === undefined || peer.prekey === '' || peer.pubkey === '') {
      await new Promise((resolve) => setTimeout(resolve, 600))
      peer = await this.resolvePeer(toAccount)
    }
    if (peer === undefined || peer.prekey === '' || peer.pubkey === '') {
      this.clients.logEvent(`找不到 @${toAccount} 的公钥，消息暂存本机`)
      return false
    }
    this.hubSeq += 1
    const seq = this.hubSeq
    let envelope: string
    try {
      envelope = sealEnvelope({
        from: identity, toKeyId: peer.keyId, peerX25519Pub: peer.prekey,
        kind, seq, plaintext: JSON.stringify(payload),
      })
    } catch (err: any) {
      this.clients.logEvent(`封装失败：${err?.message ?? err}`)
      return false
    }
    const sent = client.relay(peer.keyId, envelope)
    void this.persistHubSeq()
    return sent
  }

  private async persistHubSeq(): Promise<void> {
    try {
      const config = await this.storage.readConfig()
      await this.storage.writeConfig({ ...config, hubSeq: this.hubSeq })
    } catch { /* 忽略：下次发送会再写 */ }
  }

  private async onHubRelay(frame: any): Promise<void> {
    const identity = this.identityData
    if (identity === undefined) return
    const fromKeyId = String(frame.from ?? '')
    // presence 预热只带 account/keyId，缺公钥时不能直接用（否则验签必然失败）
    const cached = this.hubByKeyId.get(fromKeyId)
    const peer = cached !== undefined && cached.pubkey !== '' && cached.prekey !== ''
      ? cached
      : (await this.resolvePeer(fromKeyId)) ?? cached
    if (peer === undefined) {
      this.clients.logEvent('收到无法识别的发送方信封，已丢弃')
      return
    }
    const opened = openEnvelope({
      identity, fromKeyId, fromX25519Pub: peer.prekey,
      fromEd25519Pub: peer.pubkey, envelope: String(frame.env ?? ''),
    })
    if (!opened.ok) {
      this.clients.logEvent(`信封被拒：${opened.error}`)
      return
    }
    let payload: any
    try { payload = JSON.parse(opened.plaintext) } catch { return }
    if (payload?.t === 'msg') this.receiveRemoteMessage(payload)
    else this.transport.dispatch(payload)
  }

  /** 已知对端（给 UI 与 transport 用） */
  hubPeers(): Array<{ accountId: string; name: string; nodeId: string; ip: string; wsPort: number; lastSeen: number; keyId?: string; trusted?: boolean }> {
    return [...this.hubDir.values()].map((entry) => ({
      accountId: entry.account,
      name: entry.name !== undefined && entry.name !== '' ? entry.name : entry.account,
      nodeId: entry.keyId,
      ip: '',
      wsPort: 0,
      lastSeen: entry.seen ?? Date.now(),
      keyId: entry.keyId,
      trusted: true,
    }))
  }

  hubPeerByKeyId(keyId: string): { account: string; keyId: string } | undefined {
    const entry = this.hubByKeyId.get(keyId)
    return entry === undefined ? undefined : { account: entry.account, keyId: entry.keyId }
  }

  /** 兼容旧 deliverToAccount：把待发消息标记为已投递 */
  hubMarkDelivered(account: string): void {
    for (const message of this.messageStore.messages) {
      if (message.to === account && message.local && message.status !== 'delivered') {
        this.messageStore.markDelivered(message.id)
      }
    }
  }

  /** 统一的远端消息入口：直连与枢纽都走这里 */
  receiveRemoteMessage(wire: any): void {
    if (wire?.t !== 'msg') return
    if (wire.from === this.self.accountId) return
    if (wire.toType === 'account' && wire.to !== this.self.accountId) return
    if (wire.toType === 'channel' && !this.channelRegistry.canReceive(String(wire.to ?? ''))) return
    if (this.messageStore.has(wire.id)) return
    this.messageStore.push({
      id: wire.id, from: wire.from, fromName: wire.fromName ?? wire.from,
      to: wire.to, toType: wire.toType,
      body: String(wire.body ?? ''), ts: Number(wire.ts ?? Date.now()),
      kind: 'text', local: false,
      ...(wire.replyTo === undefined ? {} : { replyTo: wire.replyTo }),
      ...(Array.isArray(wire.mentions) ? { mentions: wire.mentions.map((x: unknown) => String(x)).slice(0, 32) } : {}),
    } as any)
  }

  stop(): void {
    this.stopped = true
    this.hubLauncher.stop()
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
      return false
    }
    const ok = IdentityStore.verifyHandshake({ nodeId, accountId, ts, publicKey: pubkey, keyId, sig })
    if (!ok) {
      this.clients.logEvent(`拒绝 @${accountId} 的身份：签名无效或时间戳过期`)
      return false
    }
    const outcome = await this.trust.observe(accountId, keyId, pubkey)
    if (outcome === 'new') {
      this.clients.logEvent(`首次见到 @${accountId}，已钉住身份 ${keyId}`)
      return true
    }
    if (outcome === 'conflict') {
      const pinned = this.trust.get(accountId)?.keyId ?? '?'
      this.clients.logEvent(`身份冲突：@${accountId} 使用了新的公钥（钉住 ${pinned}，本次 ${keyId}），可能有人冒充`)
      return false
    }
    return true
  }

  /** 当前配置视角账号；沿用旧文件里的 passwordHash/salt。 */
  private accountWithCredentials(previous?: Account): Account {
    // 关键：self 为空时（例如进程刚起、还没读到配置）绝不能把已存的账号写成空
    const username = this.self.accountId !== '' ? this.self.accountId : (previous?.username ?? '')
    const displayName = this.self.name !== '' ? this.self.name : (previous?.displayName ?? username)
    const account: Account = { username, displayName }
    if (previous?.passwordHash) {
      account.passwordHash = previous.passwordHash
      account.salt = previous.salt
    }
    return account
  }

  async saveConfig(): Promise<void> {
    const old = await this.storage.readConfig()
    await this.storage.writeConfig({
      ...old,
      nodeId: this.self.nodeId,
      account: this.accountWithCredentials(old.account),
      psk: this.psk || undefined,
      channels: this.channelRegistry.persisted(),
      hiddenChannels: this.channelRegistry.hiddenSnapshot(),
      ...(this.hubConfig === undefined ? { hub: undefined } : { hub: this.hubConfig }),
      hubSeq: this.hubSeq,
    })
  }

  async persistChannels(): Promise<void> {
    const config = await this.storage.readConfig()
    await this.storage.writeConfig({
      ...config,
      nodeId: this.self.nodeId,
      account: this.accountWithCredentials(config.account),
      psk: (typeof config.psk === 'string' ? config.psk : this.psk) || undefined,
      channels: this.channelRegistry.persisted(),
      hiddenChannels: this.channelRegistry.hiddenSnapshot(),
    })
  }

}
