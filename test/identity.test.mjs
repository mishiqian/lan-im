/**
 * 身份：密钥生成、持久化、签名/验签、TOFU 钉住。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, stat, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  IdentityStore, TrustStore, keyIdOf, base32, handshakePayload, HANDSHAKE_SKEW_MS,
} from '../lib/types/host/identity.js'

test('首次生成、第二次复用，keyId 与公钥一致', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lanim-id-'))
  const store = new IdentityStore(dir)
  const first = await store.loadOrCreate()
  assert.equal(first.created, true)
  assert.equal(first.identity.keyId, keyIdOf(first.identity.publicKey))

  const again = await new IdentityStore(dir).loadOrCreate()
  assert.equal(again.created, false)
  assert.equal(again.identity.keyId, first.identity.keyId)
  assert.equal(again.identity.publicKey, first.identity.publicKey)
})

test('私钥文件权限 0600', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lanim-id-'))
  const store = new IdentityStore(dir)
  await store.loadOrCreate()
  const mode = (await stat(store.path)).mode & 0o777
  assert.equal(mode, 0o600)
})

test('签名可被自己的公钥验证，改一个字节即失效', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lanim-id-'))
  const store = new IdentityStore(dir)
  const { identity } = await store.loadOrCreate()
  const payload = handshakePayload({ nodeId: 'n1', accountId: 'alice', ts: Date.now() })
  const sig = store.sign(payload)
  assert.equal(IdentityStore.verify(identity.publicKey, payload, sig), true)
  assert.equal(IdentityStore.verify(identity.publicKey, payload + 'x', sig), false)

  const tampered = Buffer.from(sig, 'base64')
  tampered[0] ^= 0xff
  assert.equal(IdentityStore.verify(identity.publicKey, payload, tampered.toString('base64')), false)
})

test('握手验签：keyId 不匹配 / 时间戳过期 / 正常', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lanim-id-'))
  const store = new IdentityStore(dir)
  const { identity } = await store.loadOrCreate()
  const now = Date.now()
  const base = { nodeId: 'n1', accountId: 'alice', ts: now }
  const sig = store.sign(handshakePayload(base))

  assert.equal(IdentityStore.verifyHandshake({ ...base, publicKey: identity.publicKey, keyId: identity.keyId, sig }, now), true)
  // keyId 与公钥不配套
  assert.equal(IdentityStore.verifyHandshake({ ...base, publicKey: identity.publicKey, keyId: 'WRONGKEYID', sig }, now), false)
  // 时间戳过期
  assert.equal(IdentityStore.verifyHandshake({ ...base, publicKey: identity.publicKey, keyId: identity.keyId, sig }, now + HANDSHAKE_SKEW_MS + 1), false)
})

test('钉住：新账号 new、同钥 same、换钥 conflict 且不覆盖', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lanim-id-'))
  const file = join(dir, 'trust.json')
  const store = new TrustStore(file)
  await store.load()

  assert.equal(await store.observe('alice', 'K1', 'k1'), 'new')
  assert.equal(await store.observe('alice', 'K1', 'k1'), 'same')
  assert.equal(await store.observe('alice', 'K2', 'k2'), 'conflict')
  assert.equal(store.get('alice').keyId, 'K1')

  // 人工确认后可替换
  await store.repin('alice', 'K2', 'k2')
  assert.equal(store.get('alice').keyId, 'K2')

  // 重启后仍在
  const again = new TrustStore(file)
  await again.load()
  assert.equal(again.get('alice').keyId, 'K2')
})

test('损坏的 identity 文件不会让进程起不来（重新生成）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lanim-id-'))
  await writeFile(join(dir, 'identity.json'), '{ not json')
  const { created } = await new IdentityStore(dir).loadOrCreate()
  assert.equal(created, true)
  const raw = JSON.parse(await readFile(join(dir, 'identity.json'), 'utf8'))
  assert.equal(raw.version, 1)
})

test('base32 编码稳定（用于 keyId 展示）', () => {
  assert.equal(base32(Buffer.from('abc')), 'MFRGG')
})
