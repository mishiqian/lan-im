/**
 * HLP 协议常量与编解码辅助（枢纽侧）。
 *
 * 这里只做规范里写死的事：字节布局、错误码、帧校验。
 * 任何实现都可以用任意语言照 PROTOCOL.md 重写这个文件。
 */
export const PROTOCOL_VERSION = 1
export const HANDSHAKE_PREFIX = 'lanim-hlp-v1'
export const PREKEY_PREFIX = 'lanim-prekey-v1'
export const HANDSHAKE_SKEW_MS = 120_000
export const MAX_FRAME_BYTES = 1024 * 1024
export const MAX_CONTROL_BYTES = 64 * 1024

export const ERR = {
  UNAUTHENTICATED: 1001,
  UNSUPPORTED_VERSION: 1002,
  RATE_LIMITED: 1003,
  PAYLOAD_TOO_LARGE: 1004,
  UNKNOWN_FRAME: 1005,
  BAD_SIGNATURE: 1006,
  INVITE_INVALID: 1007,
  BLOCKED: 1008,
  INTERNAL: 1009,
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 base32，无填充 */
export function base32(bytes) {
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
 * 握手签名转录串：字段之间单个 0x00，无空格无换行。
 * 顺序：prefix, hubId, nodeId, keyId, clientNonce, hubNonce, ts(十进制)
 */
export function handshakeTranscript({ hubId, nodeId, keyId, clientNonce, hubNonce, ts }) {
  return Buffer.from(
    [HANDSHAKE_PREFIX, hubId, nodeId, keyId, clientNonce, hubNonce, String(ts)].join('\u0000'),
    'utf8',
  )
}

/** prekey 签名转录串 */
export function prekeyTranscript({ keyId, prekey }) {
  return Buffer.from([PREKEY_PREFIX, keyId, prekey].join('\u0000'), 'utf8')
}

export function isKeyId(value) {
  return typeof value === 'string' && /^[A-Z2-7]{16}$/.test(value)
}

export function isNonce(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{6,32}$/.test(value)
}

/** 只接受已知帧类型，且必须是对象、带整数 v */
export function parseFrame(raw) {
  let frame
  try {
    frame = JSON.parse(raw)
  } catch {
    return { ok: false, code: ERR.UNKNOWN_FRAME, reason: 'not-json' }
  }
  if (frame === null || typeof frame !== 'object' || Array.isArray(frame)) {
    return { ok: false, code: ERR.UNKNOWN_FRAME, reason: 'not-object' }
  }
  if (!Number.isInteger(frame.v)) {
    return { ok: false, code: ERR.UNSUPPORTED_VERSION, reason: 'missing-v' }
  }
  if (typeof frame.t !== 'string') {
    return { ok: false, code: ERR.UNKNOWN_FRAME, reason: 'missing-t' }
  }
  return { ok: true, frame }
}

export function errorFrame(code, message, extra = {}) {
  return JSON.stringify({ t: 'hub/error', v: PROTOCOL_VERSION, code, message, ...extra })
}
