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

/** 公钥 → keyId：sha256 的 base32 前 16 位（约 80 bit，局域网内够用） */
export function keyIdOf(publicKeyB64: string): string {
  return base32(createHash('sha256').update(Buffer.from(publicKeyB64, 'base64')).digest()).slice(0, 16)
}

export interface IdentityFile {
  version: 1
  keyId: string
  publicKey: string
  privateKey: string
  createdAt: number
}

export interface Signable { nodeId: string; accountId: string; ts: number }

/** 握手签名的规范化串：字段顺序固定，跨版本可复现 */
export function handshakePayload(input: Signable): string {
  return `lanim-hello-v1|${input.nodeId}|${input.accountId}|${input.ts}`
}

/** 握手时间戳容忍窗口 */
export const HANDSHAKE_SKEW_MS = 2 * 60 * 1000

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
          if (parsed.keyId !== keyIdOf(parsed.publicKey)) throw new Error('keyId 与公钥不一致')
          this.data = parsed
          return { identity: parsed, created: false }
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
    return { identity, created: true }
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
