/**
 * 规范向量自检：枢纽侧实现必须与 spec/vectors 逐字节一致。
 * 这三组向量同时被客户端与任何第三方实现使用，改动即红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, sign, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { base32, handshakeTranscript } from '../src/frames.mjs'

const vector = (name) => JSON.parse(readFileSync(new URL(`../../spec/vectors/${name}`, import.meta.url), 'utf8'))

const ED_PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex')
const X_PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex')
const edFromSeed = (hex) => createPrivateKey({ key: Buffer.concat([ED_PKCS8, Buffer.from(hex, 'hex')]), format: 'der', type: 'pkcs8' })
const xFromSeed = (hex) => createPrivateKey({ key: Buffer.concat([X_PKCS8, Buffer.from(hex, 'hex')]), format: 'der', type: 'pkcs8' })
const raw32 = (priv) => createPublicKey(priv).export({ format: 'der', type: 'spki' }).subarray(-32)
const b64u = (b) => Buffer.from(b).toString('base64url')

test('V1 握手签名与规范逐字节一致', () => {
  const v = vector('hlp-hello.json')
  const priv = edFromSeed(v.inputs.ed25519SeedHex)
  const pub = raw32(priv)
  assert.equal(b64u(pub), v.inputs.publicKeyBase64url)

  const keyId = base32(createHash('sha256').update(pub).digest()).slice(0, 16)
  assert.equal(keyId, v.derived.keyId)

  const transcript = handshakeTranscript({
    hubId: v.inputs.hubId,
    nodeId: v.inputs.nodeId,
    keyId,
    clientNonce: v.inputs.clientNonce,
    hubNonce: v.inputs.hubNonce,
    ts: v.inputs.ts,
  })
  assert.equal(transcript.toString('utf8'), v.expected.transcriptUtf8)
  assert.equal(transcript.toString('hex'), v.expected.transcriptHex)

  const sig = sign(null, transcript, priv)
  assert.equal(b64u(sig), v.expected.signatureBase64url)
  assert.equal(verify(null, transcript, createPublicKey(priv), sig), true)
})

test('V2 ECDH + HKDF 与规范一致', () => {
  const v = vector('e2e-hkdf.json')
  const a = xFromSeed(v.inputs.aPrivateSeedHex)
  const b = xFromSeed(v.inputs.bPrivateSeedHex)
  assert.equal(b64u(raw32(a)), v.inputs.aPublicKeyBase64url)
  assert.equal(b64u(raw32(b)), v.inputs.bPublicKeyBase64url)

  const shared = diffieHellman({ privateKey: a, publicKey: createPublicKey(b) })
  assert.equal(shared.toString('hex'), v.expected.sharedSecretHex)

  const salt = 'lanim-e2e-v1|' + [v.inputs.aPublicKeyBase64url, v.inputs.bPublicKeyBase64url].sort().join('|')
  assert.equal(salt, v.expected.salt)
  const key = Buffer.from(hkdfSync('sha256', shared, Buffer.from(salt), Buffer.from('lanim-envelope-v1'), 32))
  assert.equal(key.toString('hex'), v.expected.keyHex)
})

test('V3 AES-GCM 信封与规范一致', () => {
  const v = vector('envelope-gcm.json')
  const key = Buffer.from(v.inputs.keyHex, 'hex')
  const iv = Buffer.from(v.inputs.nonceHex, 'hex')
  const header = Buffer.from(v.inputs.headerHex, 'hex')
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(header)
  const ct = Buffer.concat([cipher.update(Buffer.from(v.inputs.plaintextHex, 'hex')), cipher.final()])
  assert.equal(ct.toString('hex'), v.expected.ciphertextHex)
  assert.equal(cipher.getAuthTag().toString('hex'), v.expected.tagHex)

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(header)
  decipher.setAuthTag(Buffer.from(v.expected.tagHex, 'hex'))
  const plain = Buffer.concat([decipher.update(ct), decipher.final()])
  assert.equal(plain.toString('hex'), v.inputs.plaintextHex)
})
