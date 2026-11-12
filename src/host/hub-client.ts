/**
 * Hub 客户端：节点 ↔ 枢纽的唯一通道。
 *
 * 对应 PROTOCOL.md §3：hello → challenge → auth → ready，之后 relay / lookup / presence。
 * 断线自动重连（指数退避），重连后重新握手。
 */
import { randomBytes, sign, createPrivateKey } from 'node:crypto'
import { connect as tlsConnect, type TLSSocket } from 'node:tls'
import WebSocket from 'ws'
import type { IdentityFile } from './identity.ts'
import { prekeyPayload, toBase64Url } from './identity.ts'

export const HLP_VERSION = 1
const HANDSHAKE_PREFIX = 'lanim-hlp-v1'
const MAX_RECONNECT_MS = 30_000

export interface HubConfig {
  url: string
  invite?: string
  /** 证书指纹（sha256 hex，小写无冒号）；wss 首次连接时由用户确认后写入 */
  certPin?: string
}

export interface HubStatus {
  state: 'offline' | 'connecting' | 'online'
  hubId?: string
  url: string
  lastError?: string
  since?: number
  /** 首次连接 wss 时观测到的指纹（未确认前不会建立可信连接） */
  observedPin?: string
}

export interface HubHandlers {
  onFrame?: (frame: any) => void
  onStatus?: (status: HubStatus) => void
}

/** 握手转录串：prefix ␀ hubId ␀ nodeId ␀ keyId ␀ clientNonce ␀ hubNonce ␀ ts */
export function handshakeTranscript(input: {
  hubId: string; nodeId: string; keyId: string; clientNonce: string; hubNonce: string; ts: number
}): string {
  return [HANDSHAKE_PREFIX, input.hubId, input.nodeId, input.keyId, input.clientNonce, input.hubNonce, String(input.ts)].join('\u0000')
}

const b64u = (buf: Buffer): string => buf.toString('base64url')

export class HubClient {
  private ws: WebSocket | undefined
  private closed = false
  private attempts = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private status: HubStatus
  private clientNonce = ''
  /** ready 里下发的配额，供上层计算安全发送节奏 */
  limits: { msgPerSec?: number; bytesPerSec?: number; frameBytes?: number } = {}
  private pauseUntil = 0

  constructor(
    private readonly identity: IdentityFile,
    private readonly config: HubConfig,
    private readonly self: { nodeId: string; accountId: string; name?: string },
    private readonly handlers: HubHandlers = {},
  ) {
    this.status = { state: 'offline', url: config.url }
  }

  getStatus(): HubStatus {
    return this.status
  }

  private setStatus(patch: Partial<HubStatus>): void {
    this.status = { ...this.status, ...patch }
    this.handlers.onStatus?.(this.status)
  }

  /**
   * wss 的校验策略：
   * - 有 pin：必须与证书指纹一致（自签也能安全用）
   * - 无 pin：捕获指纹后拒绝连接，交由用户确认（TOFU）
   * - ws：局域网/本机，不涉及证书
   */
  private tlsOptions(): Record<string, unknown> | undefined {
    if (!this.config.url.startsWith('wss://')) return undefined
    const expected = (this.config.certPin ?? '').toLowerCase().replace(/:/g, '')
    return {
      rejectUnauthorized: false,
      checkServerIdentity: (_host: string, cert: { raw?: Buffer; fingerprint256?: string }) => {
        const pin = (cert?.fingerprint256 ?? '').replace(/:/g, '').toLowerCase()
        if (pin === '') return new Error('枢纽证书不可读')
        if (expected === '') {
          this.setStatus({ observedPin: pin, state: 'offline', lastError: '证书未确认：请在设置里确认指纹后重试' })
          return new Error('证书指纹未确认')
        }
        if (pin !== expected) {
          this.setStatus({ state: 'offline', lastError: `证书指纹不匹配（期望 ${expected.slice(0, 16)}…，实际 ${pin.slice(0, 16)}…）` })
          return new Error('证书指纹不匹配')
        }
        return undefined
      },
    }
  }

  private edPrivate() {
    return createPrivateKey({ key: Buffer.from(this.identity.privateKey, 'base64'), format: 'der', type: 'pkcs8' })
  }

  private signPayload(payload: string): string {
    return b64u(sign(null, Buffer.from(payload, 'utf8'), this.edPrivate()))
  }

  private prekeySignature(): string | undefined {
    const x = this.identity.x25519PublicKey
    if (x === undefined) return undefined
    return this.signPayload(prekeyPayload(this.identity.keyId, x))
  }

  connect(): void {
    this.closed = false
    this.open()
  }

  private open(): void {
    if (this.closed) return
    this.setStatus({ state: 'connecting', lastError: undefined })
    void this.connectOnce()
  }

  private async connectOnce(): Promise<void> {
    let socket: TLSSocket | undefined
    if (this.config.url.startsWith('wss://')) {
      try {
        socket = await this.verifiedSocket()
      } catch {
        this.scheduleReconnect()
        return
      }
    }
    let ws: WebSocket
    try {
      ws = socket === undefined
        ? new WebSocket(this.config.url)
        : new WebSocket(this.config.url, { createConnection: () => socket as TLSSocket })
    } catch (err: any) {
      this.setStatus({ state: 'offline', lastError: String(err?.message ?? err) })
      this.scheduleReconnect()
      return
    }
    this.ws = ws
    ws.on('open', () => {
      this.attempts = 0
      this.clientNonce = randomBytes(4).toString('hex')
      this.send({ ...this.helloFrame() })
    })
    ws.on('message', (raw) => this.onMessage(String(raw)))
    ws.on('close', () => {
      if (this.ws === ws) this.ws = undefined
      if (this.closed) return
      this.setStatus({ state: 'offline' })
      this.scheduleReconnect()
    })
    ws.on('error', (err: any) => this.setStatus({ state: 'offline', lastError: String(err?.message ?? err) }))
  }

  private helloFrame(): Record<string, unknown> {
    return {
      t: 'hello',
      v: HLP_VERSION,
      nodeId: this.self.nodeId,
      account: this.self.accountId,
      name: this.self.name,
      keyId: this.identity.keyId,
      pubkey: toBase64Url(this.identity.publicKey),
      ...(this.identity.x25519PublicKey === undefined ? {} : {
        prekey: this.identity.x25519PublicKey,
        prekeySig: this.prekeySignature(),
      }),
      nonce: this.clientNonce,
      ts: Date.now(),
      caps: { min: HLP_VERSION, max: HLP_VERSION, features: ['text', 'presence', 'queue', 'lookup'] },
      ...(this.config.invite === undefined || this.config.invite === '' ? {} : { invite: this.config.invite }),
    }
  }

  /** 一次 TLS 握手，返回 socket 与证书指纹 */
  private handshake(opts: { verifyChain: boolean }): Promise<{ socket: TLSSocket; pin: string }> {
    const url = new URL(this.config.url)
    const port = Number(url.port === '' ? '443' : url.port)
    return new Promise((resolve, reject) => {
      const socket = tlsConnect({
        host: url.hostname,
        port,
        servername: url.hostname,
        rejectUnauthorized: opts.verifyChain,
      })
      socket.once('error', (err) => { socket.destroy(); reject(err) })
      socket.once('secureConnect', () => {
        const cert = socket.getPeerCertificate() as { fingerprint256?: string }
        const pin = (cert?.fingerprint256 ?? '').replace(/:/g, '').toLowerCase()
        resolve({ socket, pin })
      })
    })
  }

  /**
   * 证书校验分两级：
   * 1. 系统信任链能过（公网 CA，例如 Let's Encrypt）→ 直接接受，不需要用户确认
   * 2. 链过不了（自签）→ TOFU：有 pin 就比对，没有就把指纹交回用户确认
   */
  private async verifiedSocket(): Promise<TLSSocket> {
    const expected = (this.config.certPin ?? '').toLowerCase().replace(/:/g, '')

    try {
      const { socket, pin } = await this.handshake({ verifyChain: true })
      if (pin !== '') this.setStatus({ observedPin: pin })
      return socket
    } catch {
      // 链不可信（自签/私有 CA），进入指纹确认
    }

    let captured: { socket: TLSSocket; pin: string }
    try {
      captured = await this.handshake({ verifyChain: false })
    } catch (err: any) {
      this.setStatus({ state: 'offline', lastError: `无法建立 TLS 连接：${err?.message ?? err}` })
      throw err
    }
    const { socket, pin } = captured
    if (pin === '') {
      socket.destroy()
      this.setStatus({ state: 'offline', lastError: '枢纽证书不可读' })
      throw new Error('枢纽证书不可读')
    }
    if (expected === '') {
      socket.destroy()
      this.setStatus({ state: 'offline', lastError: '证书未确认：请确认指纹后重试', observedPin: pin })
      throw new Error('证书未确认')
    }
    if (pin !== expected) {
      socket.destroy()
      this.setStatus({
        state: 'offline',
        observedPin: pin,
        lastError: `证书指纹不匹配（期望 ${expected.slice(0, 16)}…，实际 ${pin.slice(0, 16)}…）`,
      })
      throw new Error('证书指纹不匹配')
    }
    this.setStatus({ observedPin: pin })
    return socket
  }

  private onMessage(raw: string): void {
    let frame: any
    try { frame = JSON.parse(raw) } catch { return }

    if (frame.t === 'challenge') {
      // 枢纽在 challenge 里回传自己的 hubId，客户端原样用于转录串（不猜）
      const hubId = String(frame.hubId ?? '')
      const hubNonce = String(frame.hubNonce ?? '')
      const ts = Date.now()
      const transcript = handshakeTranscript({
        hubId, nodeId: this.self.nodeId, keyId: this.identity.keyId,
        clientNonce: this.clientNonce, hubNonce, ts,
      })
      this.send({ t: 'auth', v: HLP_VERSION, keyId: this.identity.keyId, ts, sig: this.signPayload(transcript) })
      return
    }

    if (frame.t === 'ready') {
      this.attempts = 0
      this.limits = {
        ...(Number.isFinite(frame.limits?.msgPerSec) ? { msgPerSec: frame.limits.msgPerSec } : {}),
        ...(Number.isFinite(frame.limits?.bytesPerSec) ? { bytesPerSec: frame.limits.bytesPerSec } : {}),
        ...(Number.isFinite(frame.limits?.frameBytes) ? { frameBytes: frame.limits.frameBytes } : {}),
      }
      this.setStatus({ state: 'online', hubId: String(frame.hubId ?? ''), since: Date.now(), lastError: undefined })
      this.send({ t: 'presence', v: HLP_VERSION, status: 'online' })
      this.handlers.onFrame?.(frame)
      return
    }

    if (frame.t === 'ping') { this.send({ t: 'pong', v: HLP_VERSION, ts: Date.now() }); return }

    if (frame.t === 'hub/error') {
      if (frame.code === 1003 && Number.isFinite(frame.retryAfterMs)) {
        this.pauseUntil = Math.max(this.pauseUntil, Date.now() + Number(frame.retryAfterMs))
      }
      this.setStatus({ lastError: `${frame.code}: ${frame.message ?? ''}` })
    }
    this.handlers.onFrame?.(frame)
  }

  /** 距离上次限流惩罚结束还要等多久 */
  pauseRemaining(): number {
    return Math.max(0, this.pauseUntil - Date.now())
  }

  /** 发送一帧；未连接返回 false（调用方自行排队） */
  send(frame: Record<string, unknown>): boolean {
    const ws = this.ws
    if (ws === undefined || ws.readyState !== WebSocket.OPEN) return false
    try { ws.send(JSON.stringify(frame)); return true } catch { return false }
  }

  /** 转发一个端到端信封 */
  relay(toKeyId: string, envelope: string): boolean {
    return this.send({ t: 'relay', v: HLP_VERSION, to: toKeyId, env: envelope })
  }

  lookup(keyId: string): boolean {
    return this.send({ t: 'lookup', v: HLP_VERSION, keyId })
  }

  presence(status: 'online' | 'away' = 'online'): boolean {
    return this.send({ t: 'presence', v: HLP_VERSION, status })
  }

  private scheduleReconnect(): void {
    if (this.closed) return
    this.attempts += 1
    const delay = Math.min(1000 * 2 ** (this.attempts - 1), MAX_RECONNECT_MS)
    this.timer = setTimeout(() => this.open(), delay)
  }

  close(): void {
    this.closed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    try { this.ws?.close() } catch { /* 忽略 */ }
    this.ws = undefined
    this.setStatus({ state: 'offline' })
  }
}
