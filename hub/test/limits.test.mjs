/**
 * 限流与封禁：公网暴露前必须有的两道闸。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign } from 'node:crypto'
import WebSocket from 'ws'
import { createHub, keyIdOfRawPublicKey } from '../src/server.mjs'
import { handshakeTranscript, prekeyTranscript } from '../src/frames.mjs'

const ED_PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex')
const X_PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex')
const b64u = (b) => Buffer.from(b).toString('base64url')

function identity(seedByte) {
  const seed = Buffer.alloc(32, seedByte)
  const ed = createPrivateKey({ key: Buffer.concat([ED_PKCS8, seed]), format: 'der', type: 'pkcs8' })
  const x = createPrivateKey({ key: Buffer.concat([X_PKCS8, seed]), format: 'der', type: 'pkcs8' })
  const pubRaw = createPublicKey(ed).export({ format: 'der', type: 'spki' }).subarray(-32)
  const keyId = keyIdOfRawPublicKey(pubRaw)
  const xPub = b64u(createPublicKey(x).export({ format: 'der', type: 'spki' }).subarray(-32))
  return {
    ed, keyId,
    pubkey: b64u(createPublicKey(ed).export({ format: 'der', type: 'spki' })),
    prekey: xPub,
    prekeySig: b64u(sign(null, prekeyTranscript({ keyId, prekey: xPub }), ed)),
  }
}

function connect(port, id, account) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/hlp`)
    const frames = []
    const nonce = randomBytes(4).toString('hex')
    ws.on('open', () => ws.send(JSON.stringify({
      t: 'hello', v: 1, nodeId: `n-${account}`, account, keyId: id.keyId,
      pubkey: id.pubkey, prekey: id.prekey, prekeySig: id.prekeySig,
      nonce, ts: Date.now(), caps: { min: 1, max: 1, features: ['text'] },
    })))
    ws.on('message', (raw) => {
      const frame = JSON.parse(String(raw))
      frames.push(frame)
      if (frame.t === 'challenge') {
        const ts = Date.now()
        const transcript = handshakeTranscript({
          hubId: 'test-hub', nodeId: `n-${account}`, keyId: id.keyId,
          clientNonce: nonce, hubNonce: frame.hubNonce, ts,
        })
        ws.send(JSON.stringify({ t: 'auth', v: 1, keyId: id.keyId, ts, sig: b64u(sign(null, transcript, id.ed)) }))
      }
      if (frame.t === 'ready') resolve({ ws, frames, closed: () => ws.readyState !== 1 })
    })
    ws.on('close', () => resolve({ ws, frames, closed: () => true }))
    ws.on('error', reject)
  })
}

test('超过每秒配额会被 1003 拒绝，且连接保持', { timeout: 10000 }, async () => {
  const hub = createHub({ hubId: 'test-hub', msgPerSec: 2 })
  const { port } = await hub.listen(0, '127.0.0.1')
  const a = identity(1)
  const b = identity(2)
  const ca = await connect(port, a, 'alice')
  const cb = await connect(port, b, 'bob')

  for (let i = 0; i < 8; i += 1) {
    ca.ws.send(JSON.stringify({ t: 'relay', v: 1, to: b.keyId, env: 'x'.repeat(10) }))
  }
  await new Promise((r) => setTimeout(r, 300))
  const limited = ca.frames.filter((f) => f.t === 'hub/error' && f.code === 1003)
  assert.ok(limited.length > 0, '应该有被限流的帧')
  assert.equal(ca.ws.readyState, 1, '限流不应断开连接')
  assert.ok(cb.frames.some((f) => f.t === 'relay'), '配额内的应正常投递')

  ca.ws.close(); cb.ws.close()
  await hub.close()
})

test('封禁后立刻踢下线，且后续握手被拒', { timeout: 10000 }, async () => {
  const hub = createHub({ hubId: 'test-hub' })
  const { port } = await hub.listen(0, '127.0.0.1')
  const bad = identity(9)
  const c = await connect(port, bad, 'mallory')
  assert.equal(c.ws.readyState, 1)

  const res = await fetch(`http://127.0.0.1:${port}/admin/block`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keyId: bad.keyId }),
  })
  assert.equal(res.status, 200)
  await new Promise((r) => setTimeout(r, 200))
  assert.notEqual(c.ws.readyState, 1, '封禁后连接应关闭')

  const again = await connect(port, bad, 'mallory')
  await new Promise((r) => setTimeout(r, 200))
  assert.ok(again.frames.some((f) => f.t === 'hub/error' && f.code === 1008), '再次握手应收到 1008')

  // 解封后可以重新连
  await fetch(`http://127.0.0.1:${port}/admin/unblock`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keyId: bad.keyId }),
  })
  const ok = await connect(port, bad, 'mallory')
  await new Promise((r) => setTimeout(r, 200))
  assert.ok(ok.frames.some((f) => f.t === 'ready'), '解封后应能连上')

  ok.ws.close()
  await hub.close()
})

test('字节窗口超限也会被拒', { timeout: 10000 }, async () => {
  const hub = createHub({ hubId: 'test-hub', msgPerSec: 1000, bytesPerSec: 1024 })
  const { port } = await hub.listen(0, '127.0.0.1')
  const a = identity(3)
  const b = identity(4)
  const ca = await connect(port, a, 'alice')
  const cb = await connect(port, b, 'bob')
  ca.ws.send(JSON.stringify({ t: 'relay', v: 1, to: b.keyId, env: 'y'.repeat(2048) }))
  await new Promise((r) => setTimeout(r, 200))
  assert.ok(ca.frames.some((f) => f.t === 'hub/error' && f.code === 1003), '超字节上限应被拒')
  ca.ws.close(); cb.ws.close()
  await hub.close()
})
