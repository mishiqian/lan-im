/**
 * 身份与信任：局域网内唯一可验证的身份。
 *
 * 原则：
 * - 账号名（accountId）只是显示名，真正的唯一标识是 `keyId`（公钥指纹）；
 * - 私钥只存本机数据目录，0600，永不出机；
 * - 没有 CA：首次见到某账号时把 keyId 钉住（TOFU）；同一账号换钥 = 冲突，必须人工确认。
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 base32（无填充） */
export function base32(bytes: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

/**
 * 公钥 → keyId：对**原始 32 字节公钥**做 sha256，取 base32 前 16 位。
 * 注意不是对 SPKI DER 做哈希——PROTOCOL.md §2 规定的是原始公钥字节。
 */
export function keyIdOf(publicKeyB64: string): string {
  const der = Buffer.from(publicKeyB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  return base32(createHash('sha256').update(der.subarray(-32)).digest()).slice(0, 16)
}

export interface IdentityFile {
  version: 1
  keyId: string
  publicKey: string
  privateKey: string
  createdAt: number
  /** 端到端加密用的 X25519 子钥（由 Ed25519 主钥签名发布，见 PROTOCOL.md §4） */
  x25519PublicKey?: string
  x25519PrivateKey?: string
}

/** prekey 签名转录串：prefix ␀ keyId ␀ prekey */
export function prekeyPayload(keyId: string, prekey: string): string {
  return `lanim-prekey-v1\u0000${keyId}\u0000${prekey}`
}

export interface Signable { nodeId: string; accountId: string; ts: number }

/** 握手签名的规范化串：字段顺序固定，跨版本可复现 */
export function handshakePayload(input: Signable): string {
  return `lanim-hello-v1|${input.nodeId}|${input.accountId}|${input.ts}`
}

/** 握手时间戳容忍窗口 */
export const HANDSHAKE_SKEW_MS = 2 * 60 * 1000


/** 宽松解码：既接受标准 base64 也接受 base64url（身份文件历史是 base64） */
export function decodeAnyBase64(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/** 规范要求传输一律 base64url */
export function toBase64Url(input: string): string {
  return decodeAnyBase64(input).toString('base64url')
}

const importPrivate = (b64: string) => createPrivateKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'pkcs8' })
const importPublic = (b64: string) => createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' })

export class IdentityStore {
  readonly path: string
  private data: IdentityFile | undefined

  constructor(private readonly dir: string) {
    this.path = join(dir, 'identity.json')
  }

  /** 首次启动生成密钥；之后复用。返回是否新建。 */
  async loadOrCreate(): Promise<{ identity: IdentityFile; created: boolean }> {
    if (existsSync(this.path)) {
      try {
        const parsed = JSON.parse(await readFile(this.path, 'utf8')) as IdentityFile
        if (parsed.version === 1 && typeof parsed.publicKey === 'string' && typeof parsed.privateKey === 'string') {
          const expected = keyIdOf(parsed.publicKey)
          if (parsed.keyId !== expected) {
            // 旧版本对 SPKI DER 做哈希，与协议规定（原始 32 字节）不同：就地迁移
            parsed.keyId = expected
            await writeFile(this.path, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
          }
          this.data = parsed
          if (typeof parsed.x25519PublicKey !== 'string' || typeof parsed.x25519PrivateKey !== 'string') {
            await this.ensureX25519()
          }
          return { identity: this.data, created: false }
        }
      } catch {
        // 损坏就当没有：重新生成（旧文件会被覆盖，但不会导致进程起不来）
      }
    }
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
    const priv = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')
    const identity: IdentityFile = {
      version: 1,
      keyId: keyIdOf(pub),
      publicKey: pub,
      privateKey: priv,
      createdAt: Date.now(),
    }
    await mkdir(dirname(this.path), { recursive: true })
    await writeFile(this.path, `${JSON.stringify(identity, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    try { await chmod(this.path, 0o600) } catch { /* Windows 忽略 */ }
    this.data = identity
    await this.ensureX25519()
    return { identity: this.data, created: true }
  }

  /** 补齐 X25519 子钥（老身份文件没有这个字段）；已有则不动 */
  private async ensureX25519(): Promise<void> {
    const data = this.data
    if (data === undefined) return
    if (typeof data.x25519PublicKey === 'string' && typeof data.x25519PrivateKey === 'string') return
    const { publicKey, privateKey } = generateKeyPairSync('x25519')
    data.x25519PublicKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url')
    data.x25519PrivateKey = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')
    await writeFile(this.path, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    try { await chmod(this.path, 0o600) } catch { /* Windows 忽略 */ }
  }

  /** 发布用的 prekey 签名（Ed25519 主钥签署 X25519 公钥） */
  prekeySignature(): string | undefined {
    const data = this.data
    if (data === undefined || data.x25519PublicKey === undefined) return undefined
    return this.sign(prekeyPayload(data.keyId, data.x25519PublicKey))
  }

  get current(): IdentityFile | undefined {
    return this.data
  }

  sign(payload: string): string {
    if (this.data === undefined) throw new Error('identity 未初始化')
    return sign(null, Buffer.from(payload), importPrivate(this.data.privateKey)).toString('base64')
  }

  /** 校验任意公钥对 payload 的签名 */
  static verify(publicKeyB64: string, payload: string, signatureB64: string): boolean {
    try {
      return verify(null, Buffer.from(payload), importPublic(publicKeyB64), Buffer.from(signatureB64, 'base64'))
    } catch {
      return false
    }
  }

  /** 校验握手签名：keyId 必须与公钥匹配、时间戳在容忍窗口内、签名有效 */
  static verifyHandshake(input: Signable & { publicKey: string; keyId: string; sig: string }, now = Date.now()): boolean {
    if (keyIdOf(input.publicKey) !== input.keyId) return false
    if (Math.abs(now - input.ts) > HANDSHAKE_SKEW_MS) return false
    return IdentityStore.verify(input.publicKey, handshakePayload(input), input.sig)
  }
}

export interface TrustPin {
  accountId: string
  keyId: string
  publicKey: string
  firstSeen: number
  lastSeen: number
}

export type PinOutcome = 'new' | 'same' | 'conflict'

/** 钉住表：accountId → keyId（TOFU） */
export class TrustStore {
  private pins = new Map<string, TrustPin>()

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    try {
      const rows = JSON.parse(await readFile(this.file, 'utf8')) as TrustPin[]
      for (const row of rows) this.pins.set(row.accountId, row)
    } catch { /* 首次运行 */ }
  }

  get(accountId: string): TrustPin | undefined {
    return this.pins.get(accountId)
  }

  list(): TrustPin[] {
    return [...this.pins.values()]
  }

  /** 记录一次见到；conflict 时不覆盖旧值（等人确认） */
  async observe(accountId: string, keyId: string, publicKey: string): Promise<PinOutcome> {
    const existing = this.pins.get(accountId)
    if (existing === undefined) {
      this.pins.set(accountId, { accountId, keyId, publicKey, firstSeen: Date.now(), lastSeen: Date.now() })
      await this.persist()
      return 'new'
    }
    if (existing.keyId === keyId) {
      existing.lastSeen = Date.now()
      await this.persist()
      return 'same'
    }
    return 'conflict'
  }

  /** 人工确认后替换钉住 */
  async repin(accountId: string, keyId: string, publicKey: string): Promise<void> {
    this.pins.set(accountId, { accountId, keyId, publicKey, firstSeen: Date.now(), lastSeen: Date.now() })
    await this.persist()
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, `${JSON.stringify([...this.pins.values()], null, 2)}\n`, 'utf8')
  }
}
