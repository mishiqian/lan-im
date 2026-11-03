/**
 * Agent 包的打包与校验测试。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPackage, verifyPackage, filesDigest, packageDigest } from '../lib/types/host/agent-package.js'

const card = () => ({
  schema: 1,
  id: 'pr-reviewer',
  version: '1.0.0',
  name: 'PR 审阅',
  summary: '读 diff，按团队规范出评审意见',
  prompt: '你是代码评审员。读 diff，指出风险与缺失的测试，用中文给结论。',
  author: { accountId: 'alice', keyId: 'K7QF3M2X' },
  input: { type: 'text' },
  output: { type: 'markdown' },
  requires: { permissions: 'read-only', tools: [{ name: 'fs.read', scope: 'share/**' }], budget: {} },
  exposure: { cloneable: true, callable: false, acl: 'lan' },
  samples: [{ in: 'diff', out: '两条意见' }],
})

const files = () => [
  { path: 'preset.yml', encoding: 'utf8', data: 'name: pr-reviewer\n' },
  { path: 'skills/review.md', encoding: 'utf8', data: '# 评审规范\n先看风险\n' },
]

test('打包成功并自动写入 agent.json', () => {
  const r = createPackage(card(), files())
  assert.equal(r.ok, true)
  assert.ok(r.pkg.files.some((f) => f.path === 'agent.json'))
  assert.equal(r.pkg.integrity.card, r.pkg.card.integrity.sha256)
  assert.equal(r.pkg.integrity.pkg, packageDigest(r.pkg))
})

test('打包后的包能通过校验', () => {
  const pkg = createPackage(card(), files()).pkg
  const v = verifyPackage(JSON.parse(JSON.stringify(pkg)))
  assert.equal(v.ok, true)
})

test('改一个字节 → 文件哈希与整包哈希都失效', () => {
  const pkg = createPackage(card(), files()).pkg
  const tampered = JSON.parse(JSON.stringify(pkg))
  const target = tampered.files.find((f) => f.path === 'skills/review.md')
  target.data = '# 评审规范\n先看人情\n'
  const v = verifyPackage(tampered)
  assert.equal(v.ok, false)
  assert.ok(v.errors.some((e) => e.field === 'integrity.files'))
  assert.ok(v.errors.some((e) => e.field === 'integrity.pkg'))
})

test('改卡片字段 → 卡片哈希失效', () => {
  const pkg = createPackage(card(), files()).pkg
  const tampered = JSON.parse(JSON.stringify(pkg))
  tampered.card.summary = '偷偷改成别的东西'
  const v = verifyPackage(tampered)
  assert.equal(v.ok, false)
  assert.ok(v.errors.some((e) => e.field === 'card.integrity.sha256'))
})

test('路径逃逸被拒', () => {
  for (const path of ['../evil.md', '/etc/passwd', 'a/../../b.md', 'skills\\x.md']) {
    const r = createPackage(card(), [{ path, encoding: 'utf8', data: 'x' }])
    assert.equal(r.ok, false, `${path} 应该被拒`)
  }
})

test('单文件超过 1 MB 被拒', () => {
  const big = 'x'.repeat(1024 * 1024 + 1)
  const r = createPackage(card(), [{ path: 'assets/big.txt', encoding: 'utf8', data: big }])
  assert.equal(r.ok, false)
})

test('文件哈希与顺序无关', () => {
  const a = files()
  const b = [...a].reverse()
  assert.equal(filesDigest(a), filesDigest(b))
})

test('非法卡片在打包阶段就被拦下', () => {
  const bad = { ...card(), prompt: '' }
  const r = createPackage(bad, files())
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.field === 'card.prompt'))
})
