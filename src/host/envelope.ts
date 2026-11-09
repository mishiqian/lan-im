/**
 * LEP：端到端信封（客户端侧）。
 *
 * 与 PROTOCOL.md §4 逐条对应；字节布局由 spec/vectors 的 V2/V3 校验。
 * 这里不做任何 IO——只做“明文 ↔ 信封字节”。
 */
import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, randomBytes, sign, verify } from 'node:crypto'
import type { IdentityFile } from './identity.ts'
import { decodeAnyBase64 } from './identity.ts'

export const ENVELOPE_VERSION = 1
const KDF_SALT_PREFIX = 'lanim-e2e-v1|'
const KDF_INFO = 'lanim-envelope-v1'

export interface EnvelopeHeader {
  v: number
  id: string
  from: string
  to: string
  ts: number
  seq: number
  kind: 'text' | 'file-meta' | 'file-chunk' | 'channel' | 'presence' | 'receipt'
  nonce: string
}

const b64u = (buf: Buffer): string => buf.toString('base64url')

/**
 * 三类缓存：私钥 KeyObject、对端公钥 KeyObject、会话密钥。
 * 没有它们时，每发一个 48KB 分片都要完整做一次 ECDH + HKDF + 两次 DER 解析，
 * 实测吞吐只有 ~500KB/s；缓存后瓶颈才回到网络与限流。
 */
const privCache = new Map<string, ReturnType<typeof createPrivateKey>>()
const pubCache = new Map<string, ReturnType<typeof createPublicKey>>()
const keyCache = new Map<string, Buffer>()
const CACHE_LIMIT = 512

function cached<T>(map: Map<string, T>, key: string, make: () => T): T {
  const hit = map.get(key)
  if (hit !== undefined) return hit
  const made = make()
  if (map.size >= CACHE_LIMIT) {
    const first = map.keys().next()
    if (first.done !== true) map.delete(first.value)
  }
  map.set(key, made)
  return made
}

function importEdPrivate(b64: string) {
  return cached(privCache, b64, () => createPrivateKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'pkcs8' }))
}

function importEdPublic(pub: string) {
  return cached(pubCache, pub, () => createPublicKey({ key: decodeAnyBase64(pub), format: 'der', type: 'spki' }))
}

/** Ed25519 私钥（pkcs8 base64） */
function edPrivate(identity: IdentityFile) {
  return importEdPrivate(identity.privateKey)
}

function xPrivate(identity: IdentityFile) {
  return createPrivateKey({ key: Buffer.from(identity.x25519PrivateKey ?? '', 'base64'), format: 'der', type: 'pkcs8' })
}

/** 32 字节 X25519 公钥（base64url）→ KeyObject */
function xPublicFromB64u(pub: string) {
  const raw = Buffer.from(pub, 'base64url')
  if (raw.length !== 32) throw new Error('X25519 公钥必须是 32 字节')
  // SPKI 前缀 + 原始 32 字节
  const prefix = Buffer.from('302a300506032b656e032100', 'hex')
  return createPublicKey({ key: Buffer.concat([prefix, raw]), format: 'der', type: 'spki' })
}

/** §4.3：会话密钥（双方算出同一把） */
export function deriveSessionKey(identity: IdentityFile, peerKeyId: string, peerX25519Pub: string): Buffer {
  if (identity.x25519PrivateKey === undefined || identity.x25519PublicKey === undefined) {
    throw new Error('本机身份缺少 X25519 子钥')
  }
  // 缓存键带上对端 prekey：对方换了子钥时自动失效
  const cacheKey = `${identity.keyId}|${peerKeyId}|${peerX25519Pub}`
  return cached(keyCache, cacheKey, () => {
    const shared = diffieHellman({ privateKey: xPrivate(identity), publicKey: xPublicFromB64u(peerX25519Pub) })
    const salt = Buffer.from(KDF_SALT_PREFIX + [identity.keyId, peerKeyId].sort().join('|'), 'utf8')
    return Buffer.from(hkdfSync('sha256', shared, salt, Buffer.from(KDF_INFO, 'utf8'), 32))
  })
}

export interface SealInput {
  from: IdentityFile
  toKeyId: string
  peerX25519Pub: string
  kind: EnvelopeHeader['kind']
  seq: number
  plaintext: string
  ts?: number
}

/** §4.1 + §4.4：明文 → 信封字节（base64url） */
export function seal(input: SealInput): string {
  const key = deriveSessionKey(input.from, input.toKeyId, input.peerX25519Pub)
  const nonce = randomBytes(12)
  const header: EnvelopeHeader = {
    v: ENVELOPE_VERSION,
    id: `${Date.now().toString(36).toUpperCase()}${randomBytes(8).toString('hex').toUpperCase()}`.slice(0, 26),
    from: input.from.keyId,
    to: input.toKeyId,
    ts: input.ts ?? Date.now(),
    seq: input.seq,
    kind: input.kind,
    nonce: b64u(nonce),
  }
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8')
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(headerBytes)
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(input.plaintext, 'utf8')), cipher.final()])
  const tag = cipher.getAuthTag()
  const signature = sign(null, Buffer.concat([headerBytes, ciphertext, tag]), edPrivate(input.from))
  const headerLen = Buffer.alloc(4)
  headerLen.writeUInt32BE(headerBytes.length)
  return b64u(Buffer.concat([signature, headerLen, headerBytes, ciphertext, tag]))
}

export interface OpenInput {
  identity: IdentityFile
  fromKeyId: string
  fromX25519Pub: string
  /** 发送方 Ed25519 公钥（SPKI base64url），用于验签 */
  fromEd25519Pub: string
  envelope: string
}

export interface OpenResult {
  ok: boolean
  header?: EnvelopeHeader
  plaintext?: string
  error?: string
}

/** 验签 → 解密；任何一步失败都返回错误，不降级 */
export function open(input: OpenInput): OpenResult {
  let bytes: Buffer
  try {
    bytes = Buffer.from(input.envelope, 'base64url')
  } catch {
    return { ok: false, error: '信封不是合法 base64url' }
  }
  if (bytes.length < 64 + 4 + 16) return { ok: false, error: '信封过短' }

  const signature = bytes.subarray(0, 64)
  const headerLen = bytes.readUInt32BE(64)
  if (bytes.length < 68 + headerLen + 16) return { ok: false, error: '信封长度与 header 不符' }
  const headerBytes = bytes.subarray(68, 68 + headerLen)
  const ciphertext = bytes.subarray(68 + headerLen, bytes.length - 16)
  const tag = bytes.subarray(bytes.length - 16)

  // 先验签，再解析 header —— 顺序不能反
  let signed = false
  try {
    signed = verify(null, Buffer.concat([headerBytes, ciphertext, tag]), importEdPublic(input.fromEd25519Pub), signature)
  } catch {
    signed = false
  }
  if (!signed) return { ok: false, error: '信封签名无效' }

  let header: EnvelopeHeader
  try {
    header = JSON.parse(headerBytes.toString('utf8')) as EnvelopeHeader
  } catch {
    return { ok: false, error: 'header 不是合法 JSON' }
  }
  if (header.v !== ENVELOPE_VERSION) return { ok: false, error: `不支持的信封版本 ${header.v}` }
  if (header.from !== input.fromKeyId) return { ok: false, error: '信封 from 与声称的发送方不一致' }
  if (header.to !== input.identity.keyId) return { ok: false, error: '信封不是发给本机的' }

  let key: Buffer
  try {
    key = deriveSessionKey(input.identity, input.fromKeyId, input.fromX25519Pub)
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) }
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(header.nonce, 'base64url'))
    decipher.setAAD(headerBytes)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    return { ok: true, header, plaintext }
  } catch {
    return { ok: false, error: '解密失败（密钥或密文不匹配）' }
  }
}
