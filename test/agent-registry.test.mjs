/**
 * 目录与安装的回归测试（全部在临时目录里跑，不碰 ~/.dsh）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentRegistry, compareVersion } from '../lib/types/host/agent-registry.js'
import { AgentInstaller } from '../lib/types/host/agent-install.js'
import { createPackage } from '../lib/types/host/agent-package.js'

const card = (over = {}) => ({
  schema: 1,
  id: 'pr-reviewer',
  version: '1.0.0',
  name: 'PR 审阅',
  summary: '读 diff 出意见',
  prompt: '你是代码评审员。读 diff，指出风险与缺失的测试，用中文给结论。',
  author: { accountId: 'alice' },
  input: { type: 'text' },
  output: { type: 'markdown' },
  requires: { permissions: 'read-only', tools: [], budget: {} },
  exposure: { cloneable: true, callable: false, acl: 'lan' },
  samples: [{ in: 'diff', out: '两条意见' }],
  ...over,
})

const files = () => [
  { path: 'preset.yml', encoding: 'utf8', data: 'name: pr-reviewer\n' },
  { path: 'skills/review.md', encoding: 'utf8', data: '# 规范\n' },
]

async function makeRegistry() {
  const dir = await mkdtemp(join(tmpdir(), 'lanim-agents-'))
  const published = []
  const registry = new AgentRegistry({ dir, selfAccount: () => 'alice', onPublish: (c) => published.push(c) })
  await registry.load()
  return { dir, registry, published }
}

test('版本比较：补丁号、预发布', () => {
  assert.ok(compareVersion('1.2.0', '1.1.9') > 0)
  assert.ok(compareVersion('1.0.0-rc.1', '1.0.0') < 0)
  assert.equal(compareVersion('1.0.0', '1.0.0'), 0)
})

test('发布后落盘、列表可见、回调触发', async () => {
  const { dir, registry, published } = await makeRegistry()
  const r = await registry.publish(card(), files())
  assert.equal(r.ok, true)
  assert.equal(published.length, 1)
  assert.equal(registry.list().length, 1)
  assert.equal(registry.list()[0].source, 'mine')
  const onDisk = JSON.parse(await readFile(join(dir, 'published', 'pr-reviewer', 'agent.json'), 'utf8'))
  assert.equal(onDisk.id, 'pr-reviewer')
})

test('发布非法卡片被拒，且不落盘', async () => {
  const { dir, registry } = await makeRegistry()
  const r = await registry.publish(card({ prompt: '' }), files())
  assert.equal(r.ok, false)
  assert.equal(registry.list().length, 0)
  assert.deepEqual(await readdir(join(dir, 'published')), [])
})

test('远端卡片：验哈希、去重、版本高者胜', async () => {
  const { registry } = await makeRegistry()
  const pkg = createPackage(card({ author: { accountId: 'bob' } }), files()).pkg
  assert.equal(registry.upsertRemote(pkg.card), true)
  assert.equal(registry.list().filter((e) => e.source === 'peer').length, 1)

  // 同版本重复推送 → 忽略
  assert.equal(registry.upsertRemote(pkg.card), false)

  // 低版本 → 忽略
  const older = createPackage(card({ author: { accountId: 'bob' }, version: '0.9.0' }), files()).pkg
  assert.equal(registry.upsertRemote(older.card), false)

  // 高版本 → 替换
  const newer = createPackage(card({ author: { accountId: 'bob' }, version: '1.1.0' }), files()).pkg
  assert.equal(registry.upsertRemote(newer.card), true)
  const row = registry.list().find((e) => e.source === 'peer')
  assert.equal(row.card.version, '1.1.0')
})

test('篡改过的远端卡片被拒', async () => {
  const { registry } = await makeRegistry()
  const pkg = createPackage(card({ author: { accountId: 'bob' } }), files()).pkg
  const tampered = { ...pkg.card, summary: '偷偷改' }
  assert.equal(registry.upsertRemote(tampered), false)
})

test('重启后目录仍在（load 读盘）', async () => {
  const { dir, registry } = await makeRegistry()
  await registry.publish(card(), files())
  const pkg = createPackage(card({ author: { accountId: 'bob' } }), files()).pkg
  registry.upsertRemote(pkg.card)

  const again = new AgentRegistry({ dir, selfAccount: () => 'alice' })
  await again.load()
  assert.equal(again.list().length, 2)
})

test('安装：preset.yml 落成 agent.cordis.yml，记账可查', async () => {
  const { dir, registry } = await makeRegistry()
  const presetsDir = await mkdtemp(join(tmpdir(), 'lanim-presets-'))
  const installer = new AgentInstaller({ presetsDir, registry })

  const pkg = createPackage(card({ author: { accountId: 'bob' } }), files()).pkg
  const r = await installer.install(pkg)
  assert.equal(r.ok, true)

  const target = join(presetsDir, 'bob-pr-reviewer')
  const names = await readdir(target)
  assert.ok(names.includes('agent.cordis.yml'))
  assert.ok(names.includes('agent.json'))
  assert.ok(names.includes('skills'))

  const rec = registry.installedRecord('bob', 'pr-reviewer')
  assert.equal(rec.version, '1.0.0')
})

test('安装被篡改的包会失败且不写盘', async () => {
  const { registry } = await makeRegistry()
  const presetsDir = await mkdtemp(join(tmpdir(), 'lanim-presets-'))
  const installer = new AgentInstaller({ presetsDir, registry })
  const pkg = JSON.parse(JSON.stringify(createPackage(card({ author: { accountId: 'bob' } }), files()).pkg))
  pkg.files.find((f) => f.path === 'skills/review.md').data = '# 改过\n'
  const r = await installer.install(pkg)
  assert.equal(r.ok, false)
  assert.deepEqual(await readdir(presetsDir), [])
})

test('缺 preset.yml 的包被拒', async () => {
  const { registry } = await makeRegistry()
  const presetsDir = await mkdtemp(join(tmpdir(), 'lanim-presets-'))
  const installer = new AgentInstaller({ presetsDir, registry })
  const pkg = createPackage(card({ author: { accountId: 'bob' } }), [{ path: 'skills/a.md', encoding: 'utf8', data: 'x' }]).pkg
  const r = await installer.install(pkg)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.field === 'files'))
})

test('卸载删目录并清记账', async () => {
  const { registry } = await makeRegistry()
  const presetsDir = await mkdtemp(join(tmpdir(), 'lanim-presets-'))
  const installer = new AgentInstaller({ presetsDir, registry })
  const pkg = createPackage(card({ author: { accountId: 'bob' } }), files()).pkg
  await installer.install(pkg)
  assert.equal(await installer.uninstall('bob', 'pr-reviewer'), true)
  assert.equal(registry.installedRecord('bob', 'pr-reviewer'), undefined)
  assert.deepEqual(await readdir(presetsDir), [])
})
