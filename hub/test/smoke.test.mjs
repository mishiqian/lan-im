/**
 * 端到端冒烟：两个客户端经枢纽互发一条加密消息，再验证离线队列。
 *
 * 这个测试刻意不 import 客户端代码——它按 PROTOCOL.md 用 node:crypto 自己实现一遍，
 * 相当于“第二实现”的第一块砖：协议能不能被独立实现，先在这里验证。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createPrivateKey, createPublicKey, createCipheriv, createDecipheriv, diffieHellman, hkdfSync, randomBytes, sign } from 'node:crypto'
import WebSocket from 'ws'
import { createHub, keyIdOfRawPublicKey } from '../src/server.mjs'
import { handshakeTranscript, prekeyTranscript } from '../src/frames.mjs'

const ED_PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex')
const X_PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex')
const edFromSeed = (seed) => createPrivateKey({ key: Buffer.concat([ED_PKCS8, seed]), format: 'der', type: 'pkcs8' })
const xFromSeed = (seed) => createPrivateKey({ key: Buffer.concat([X_PKCS8, seed]), format: 'der', type: 'pkcs8' })
const spki = (priv) => createPublicKey(priv).export({ format: 'der', type: 'spki' })
const raw32 = (priv) => spki(priv).subarray(-32)
const b64u = (b) => Buffer.from(b).toString('base64url')

function makeIdentity(seedByte) {
  const seed = Buffer.alloc(32, seedByte)
  const ed = edFromSeed(seed)
  const x = xFromSeed(seed)
  const xPub = b64u(raw32(x))
  const keyId = keyIdOfRawPublicKey(raw32(ed))
  const prekeySig = b64u(sign(null, prekeyTranscript({ keyId, prekey: xPub }), ed))
  return { ed, x, xPub, keyId, prekeySig, pubkey: b64u(spki(ed)) }
}

/** 按 §4.3 派生会话密钥 */
function sessionKey(a, b) {
  const shared = diffieHellman({ privateKey: a.x, publicKey: createPublicKey(b.x) })
  const salt = Buffer.from('lanim-e2e-v1|' + [a.keyId, b.keyId].sort().join('|'), 'utf8')
  return Buffer.from(hkdfSync('sha256', shared, salt, Buffer.from('lanim-envelope-v1', 'utf8'), 32))
}

/** 按 §4.1/§4.4 打包信封 */
function seal(from, to, key, plaintext, seq) {
  const iv = randomBytes(12)
  const header = Buffer.from(JSON.stringify({
    v: 1, id: '01J' + randomBytes(12).toString('hex').toUpperCase(), from: from.keyId, to: to.keyId,
    ts: Date.now(), seq, kind: 'text', nonce: iv.toString('base64url'),
  }), 'utf8')
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(header)
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()])
  const tag = cipher.getAuthTag()
  const sig = sign(null, Buffer.concat([header, ct, tag]), from.ed)
  const len = Buffer.alloc(4)
  len.writeUInt32BE(header.length)
  return Buffer.concat([sig, len, header, ct, tag]).toString('base64url')
}

function open(fromPub, key, envB64) {
  const bytes = Buffer.from(envB64, 'base64url')
  const headerLen = bytes.readUInt32BE(64)
  const header = bytes.subarray(68, 68 + headerLen)
  const ct = bytes.subarray(68 + headerLen, bytes.length - 16)
  const tag = bytes.subarray(bytes.length - 16)
  const meta = JSON.parse(header.toString('utf8'))
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(meta.nonce, 'base64url'))
  decipher.setAAD(header)
  decipher.setAuthTag(tag)
  return JSON.parse(Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8'))
}

test('握手 → 加密转发 → 离线队列', { timeout: 8000 }, async () => {
  const hub = createHub({ hubId: 'test-hub' })
  const { port } = await hub.listen(0, '127.0.0.1')
  const alice = makeIdentity(1)
  const bob = makeIdentity(2)

  // 客户端需要暂存 clientNonce 才能构造转录串；这里把 connect 拆开写清楚
  const openClient = (identity, account) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/hlp`)
      const clientNonce = randomBytes(4).toString('hex')
      let ready = false
      const frames = []
      ws.on('open', () => {
        ws.send(JSON.stringify({
          t: 'hello', v: 1, hubId: 'test-hub', nodeId: `node-${account}`, account,
          keyId: identity.keyId, pubkey: identity.pubkey, prekey: identity.xPub,
          prekeySig: identity.prekeySig, nonce: clientNonce, ts: Date.now(),
          caps: { min: 1, max: 1, features: ['text'] },
        }))
      })
      ws.on('message', (raw) => {
        const frame = JSON.parse(String(raw))
        frames.push(frame)
        if (frame.t === 'challenge') {
          const ts = Date.now()
          const transcript = handshakeTranscript({
            hubId: 'test-hub', nodeId: `node-${account}`, keyId: identity.keyId,
            clientNonce, hubNonce: frame.hubNonce, ts,
          })
          ws.send(JSON.stringify({ t: 'auth', v: 1, keyId: identity.keyId, ts, sig: b64u(sign(null, transcript, identity.ed)) }))
        }
        if (frame.t === 'ready' && !ready) {
          ready = true
          resolve({ ws, frames, send: (o) => ws.send(JSON.stringify(o)) })
        }
      })
      ws.on('error', reject)
    })

  try {
  const a = await openClient(alice, 'alice')
  const b = await openClient(bob, 'bob')
  assert.equal(a.frames.at(-1).t, 'ready')
  assert.equal(b.frames.at(-1).t, 'ready')

  const key = sessionKey(alice, bob)
  const env = seal(alice, bob, key, JSON.stringify({ t: 'msg', body: '你好' }), 0)
  a.send({ t: 'relay', v: 1, to: bob.keyId, env })

  await new Promise((r) => setTimeout(r, 100))
  const received = b.frames.find((f) => f.t === 'relay')
  assert.ok(received !== undefined, 'bob 应该收到 relay')
  assert.equal(received.to, bob.keyId)
  assert.deepEqual(open(alice, key, received.env), { t: 'msg', body: '你好' })

  // 离线：bob 断开，alice 再发一条，bob 重连后应收到
  b.ws.close()
  await new Promise((r) => setTimeout(r, 80))
  const env2 = seal(alice, bob, key, JSON.stringify({ t: 'msg', body: '离线消息' }), 1)
  a.send({ t: 'relay', v: 1, to: bob.keyId, env: env2 })
  await new Promise((r) => setTimeout(r, 80))
  const receipt = a.frames.filter((f) => f.t === 'relay/receipt').at(-1)
  assert.equal(receipt.status, 'queued')

  const b2 = await openClient(bob, 'bob')
  await new Promise((r) => setTimeout(r, 120))
  const queued = b2.frames.filter((f) => f.t === 'relay')
  assert.equal(queued.length, 1, '离线消息应在重连后投递')
  assert.deepEqual(open(alice, key, queued[0].env), { t: 'msg', body: '离线消息' })

  a.ws.close(); b2.ws.close()
  } finally {
    await hub.close()
  }
})

test('未认证就发 relay 被拒', { timeout: 5000 }, async () => {
  const hub = createHub({ hubId: 'test-hub' })
  const { port } = await hub.listen(0, '127.0.0.1')
  const ws = new WebSocket(`ws://127.0.0.1:${port}/hlp`)
  const frames = []
  ws.on('message', (raw) => frames.push(JSON.parse(String(raw))))
  await new Promise((r) => ws.once('open', r))
  ws.send(JSON.stringify({ t: 'relay', v: 1, to: 'ZZZZ1111YYYY2222', env: 'x' }))
  await new Promise((r) => setTimeout(r, 100))
  assert.equal(frames[0].t, 'hub/error')
  assert.equal(frames[0].code, 1001)
  ws.close()
  await hub.close()
})

test('邀请码错误被拒', { timeout: 5000 }, async () => {
  const hub = createHub({ hubId: 'test-hub', invites: ['GOOD-CODE'] })
  const { port } = await hub.listen(0, '127.0.0.1')
  const identity = makeIdentity(3)
  const codes = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/hlp`)
    const seen = []
    ws.on('open', () => ws.send(JSON.stringify({
      t: 'hello', v: 1, hubId: 'test-hub', nodeId: 'n3', account: 'carol',
      keyId: identity.keyId, pubkey: identity.pubkey, prekey: identity.xPub,
      prekeySig: identity.prekeySig, invite: 'WRONG', nonce: '06a1b2c3', ts: Date.now(),
      caps: { min: 1, max: 1, features: [] },
    })))
    ws.on('message', (raw) => { seen.push(JSON.parse(String(raw))); resolve(seen) })
    ws.on('error', reject)
  })
  assert.equal(codes[0].t, 'hub/error')
  assert.equal(codes[0].code, 1007)
  await hub.close()
})
