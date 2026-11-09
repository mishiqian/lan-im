/**
 * LEP 信封与 Hub 客户端：与规范向量、真实枢纽实现对照。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freePort, startHub, waitFor } from './hub-harness.mjs'
import { IdentityStore } from '../lib/types/host/identity.js'
import { deriveSessionKey, open, seal } from '../lib/types/host/envelope.js'
import { HubClient } from '../lib/types/host/hub-client.js'

async function newIdentity() {
  const dir = await mkdtemp(join(tmpdir(), 'lanim-env-'))
  const store = new IdentityStore(dir)
  const { identity } = await store.loadOrCreate()
  return { store, identity }
}

test('身份文件自动补齐 X25519 子钥，且 prekey 签名可验证', async () => {
  const { store, identity } = await newIdentity()
  assert.equal(typeof identity.x25519PublicKey, 'string')
  assert.equal(Buffer.from(identity.x25519PublicKey, 'base64url').length, 32)
  const sig = store.prekeySignature()
  assert.equal(typeof sig, 'string')
  // 用主钥验签一次，确保发布出去的东西是可验证的
  const { createPublicKey, verify } = await import('node:crypto')
  const { prekeyPayload } = await import('../lib/types/host/identity.js')
  const ok = verify(null,
    Buffer.from(prekeyPayload(identity.keyId, identity.x25519PublicKey), 'utf8'),
    createPublicKey({ key: Buffer.from(identity.publicKey, 'base64'), format: 'der', type: 'spki' }),
    Buffer.from(sig, 'base64url'))
  assert.equal(ok, true)
})

test('信封往返：A 加密 → B 解开，密文不含明文', async () => {
  const a = await newIdentity()
  const b = await newIdentity()
  const env = seal({
    from: a.identity,
    toKeyId: b.identity.keyId,
    peerX25519Pub: b.identity.x25519PublicKey,
    kind: 'text',
    seq: 1,
    plaintext: JSON.stringify({ t: 'msg', body: '你好，世界' }),
  })
  assert.ok(!Buffer.from(env, 'base64url').toString('utf8').includes('你好'))

  const result = open({
    identity: b.identity,
    fromKeyId: a.identity.keyId,
    fromX25519Pub: a.identity.x25519PublicKey,
    fromEd25519Pub: a.identity.publicKey,
    envelope: env,
  })
  assert.equal(result.ok, true)
  assert.deepEqual(JSON.parse(result.plaintext), { t: 'msg', body: '你好，世界' })
  assert.equal(result.header.seq, 1)
})

test('篡改密文 / 换收件人 / 换发送方都会被拒', async () => {
  const a = await newIdentity()
  const b = await newIdentity()
  const c = await newIdentity()
  const env = seal({
    from: a.identity, toKeyId: b.identity.keyId, peerX25519Pub: b.identity.x25519PublicKey,
    kind: 'text', seq: 2, plaintext: 'secret',
  })

  const bytes = Buffer.from(env, 'base64url')
  bytes[bytes.length - 20] ^= 0xff
  const tampered = bytes.toString('base64url')
  const tamperResult = open({
    identity: b.identity, fromKeyId: a.identity.keyId, fromX25519Pub: a.identity.x25519PublicKey,
    fromEd25519Pub: a.identity.publicKey, envelope: tampered,
  })
  assert.equal(tamperResult.ok, false)

  // 收件人不匹配
  const wrongRecipient = open({
    identity: c.identity, fromKeyId: a.identity.keyId, fromX25519Pub: a.identity.x25519PublicKey,
    fromEd25519Pub: a.identity.publicKey, envelope: env,
  })
  assert.equal(wrongRecipient.ok, false)

  // 声称的发送方与实际不符
  const wrongSender = open({
    identity: b.identity, fromKeyId: c.identity.keyId, fromX25519Pub: c.identity.x25519PublicKey,
    fromEd25519Pub: c.identity.publicKey, envelope: env,
  })
  assert.equal(wrongSender.ok, false)
})

test('会话密钥缓存：同一对端返回同一个 Buffer，换人/换 prekey 会变', async () => {
  const a = await newIdentity()
  const b = await newIdentity()
  const c = await newIdentity()
  const k1 = deriveSessionKey(a.identity, b.identity.keyId, b.identity.x25519PublicKey)
  const k2 = deriveSessionKey(a.identity, b.identity.keyId, b.identity.x25519PublicKey)
  assert.equal(k1, k2, '缓存命中应返回同一个对象')
  const k3 = deriveSessionKey(a.identity, c.identity.keyId, c.identity.x25519PublicKey)
  assert.notEqual(k1.toString('hex'), k3.toString('hex'))
  const k4 = deriveSessionKey(a.identity, b.identity.keyId, c.identity.x25519PublicKey)
  assert.notEqual(k1.toString('hex'), k4.toString('hex'), '对端 prekey 变化必须换密钥')
})

test('双方派生出同一把会话密钥', async () => {
  const a = await newIdentity()
  const b = await newIdentity()
  const ka = deriveSessionKey(a.identity, b.identity.keyId, b.identity.x25519PublicKey)
  const kb = deriveSessionKey(b.identity, a.identity.keyId, a.identity.x25519PublicKey)
  assert.equal(ka.toString('hex'), kb.toString('hex'))
})

test('HubClient 完成握手并可路由一条加密消息', { timeout: 15000 }, async () => {
  const port = await freePort()
  const hub = await startHub(port)
  const a = await newIdentity()
  const b = await newIdentity()

  const statusA = []
  const clientA = new HubClient(a.identity, { url: `ws://127.0.0.1:${port}/hlp` }, { nodeId: 'node-a', accountId: 'alice' }, {
    onStatus: (s) => statusA.push(s.state),
  })
  const framesB = []
  const clientB = new HubClient(b.identity, { url: `ws://127.0.0.1:${port}/hlp` }, { nodeId: 'node-b', accountId: 'bob' }, {
    onFrame: (f) => framesB.push(f),
  })
  clientA.connect()
  clientB.connect()

  await waitFor(() => clientA.getStatus().state === 'online' && clientB.getStatus().state === 'online', 8000)
  assert.deepEqual(statusA.slice(-1), ['online'])

  const env = seal({
    from: a.identity, toKeyId: b.identity.keyId, peerX25519Pub: b.identity.x25519PublicKey,
    kind: 'text', seq: 0, plaintext: 'hello via hub',
  })
  assert.equal(clientA.relay(b.identity.keyId, env), true)

  await waitFor(() => framesB.some((f) => f.t === 'relay'), 5000)
  const relayed = framesB.find((f) => f.t === 'relay')
  const opened = open({
    identity: b.identity, fromKeyId: a.identity.keyId, fromX25519Pub: a.identity.x25519PublicKey,
    fromEd25519Pub: a.identity.publicKey, envelope: relayed.env,
  })
  assert.equal(opened.ok, true)
  assert.equal(opened.plaintext, 'hello via hub')

  clientA.close()
  clientB.close()
  await hub.stop()
})

test('hub lookup 按账号返回 keyId 与公钥', { timeout: 15000 }, async () => {
  const port = await freePort()
  const hub = await startHub(port)
  const a = await newIdentity()
  const b = await newIdentity()
  const frames = []
  const clientA = new HubClient(a.identity, { url: `ws://127.0.0.1:${port}/hlp` }, { nodeId: 'node-a', accountId: 'alice' }, {
    onFrame: (f) => frames.push(f),
  })
  const clientB = new HubClient(b.identity, { url: `ws://127.0.0.1:${port}/hlp` }, { nodeId: 'node-b', accountId: 'bob' }, {})
  clientA.connect(); clientB.connect()
  await waitFor(() => clientA.getStatus().state === 'online' && clientB.getStatus().state === 'online', 8000)

  clientA.send({ t: 'lookup', v: 1, account: 'bob' })
  await waitFor(() => frames.some((f) => f.t === 'lookup/result'), 5000)
  const result = frames.find((f) => f.t === 'lookup/result')
  assert.equal(result.found, true)
  assert.equal(result.account, 'bob')
  assert.equal(result.keyId, b.identity.keyId)
  assert.equal(result.prekey, b.identity.x25519PublicKey)
  assert.equal(typeof result.pubkey, 'string')

  clientA.close(); clientB.close()
  await hub.stop()
})
