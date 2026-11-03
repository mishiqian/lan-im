/**
 * 卡片校验与哈希的回归测试。
 * 运行：npm run build && node --test test/
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateCard, sealCard, verifyCard, cardDigest, canonicalJson } from '../lib/types/host/agent-card.js'

const base = () => ({
  schema: 1,
  id: 'pr-reviewer',
  version: '1.0.0',
  name: 'PR 审阅',
  summary: '读 diff，按团队规范出评审意见',
  prompt: '你是代码评审员。读 diff，指出风险与缺失的测试，用中文给结论。',
  author: { accountId: 'alice', keyId: 'K7QF3M2X' },
  input: { type: 'text', hint: '贴 diff' },
  output: { type: 'markdown' },
  requires: {
    model: 'deepseek-flash',
    permissions: 'read-only',
    tools: [{ name: 'fs.read', scope: 'share/**' }],
    budget: {},
  },
  exposure: { cloneable: true, callable: false, acl: 'lan' },
  samples: [{ in: 'diff --git a/x b/x', out: '两条意见' }],
})

test('合法卡片通过并补齐默认预算', () => {
  const r = validateCard(base())
  assert.equal(r.ok, true)
  assert.equal(r.card.requires.budget.turns, 30)
  assert.equal(r.card.requires.budget.tokens, 60000)
  assert.equal(r.card.requires.budget.seconds, 1800)
  assert.equal(r.card.exposure.acl, 'lan')
})

test('样例可选；给了就必须完整', () => {
  const noSamples = base(); noSamples.samples = []
  assert.equal(validateCard(noSamples).ok, true)

  const broken = base(); broken.samples = [{ in: 'a', out: '' }]
  const r = validateCard(broken)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.field === 'samples[0].out'))
})

test('缺 prompt 被拒（agent 的核心）', () => {
  const c = base(); c.prompt = ''
  const r = validateCard(c)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.field === 'prompt'))
})

test('未知工具被拒', () => {
  const c = base(); c.requires.tools = [{ name: 'fs.rm', scope: 'x/**' }]
  const r = validateCard(c)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.field === 'requires.tools[0].name'))
})

test('fs.read 缺 scope 被拒', () => {
  const c = base(); c.requires.tools = [{ name: 'fs.read' }]
  const r = validateCard(c)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.field === 'requires.tools[0].scope'))
})

test('scope 含 .. 或绝对路径被拒', () => {
  for (const scope of ['../etc/**', '/etc/**']) {
    const c = base(); c.requires.tools = [{ name: 'fs.read', scope }]
    const r = validateCard(c)
    assert.equal(r.ok, false, `scope ${scope} 应该被拒`)
  }
})

test('bash 必须声明 allow', () => {
  const c = base(); c.requires.tools = [{ name: 'bash' }]
  const r = validateCard(c)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.field === 'requires.tools[0].allow'))
})

test('cloneable 与 callable 同时 false 被拒', () => {
  const c = base(); c.exposure = { cloneable: false, callable: false, acl: 'lan' }
  const r = validateCard(c)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.field === 'exposure'))
})

test('哈希：封存后校验通过，改一个字段即失效', () => {
  const sealed = sealCard(validateCard(base()).card)
  assert.equal(verifyCard(sealed), true)
  const tampered = { ...sealed, summary: '被改过的说明' }
  assert.equal(verifyCard(tampered), false)
})

test('哈希与键序无关（canonicalJson 稳定）', () => {
  const a = { b: 2, a: [1, { y: 1, x: 2 }] }
  const b = { a: [1, { x: 2, y: 1 }], b: 2 }
  assert.equal(canonicalJson(a), canonicalJson(b))
})

test('哈希覆盖 author，换作者即失效', () => {
  const card = validateCard(base()).card
  const sealed = sealCard(card)
  assert.equal(verifyCard(sealed), true)
  const other = { ...sealed, author: { accountId: 'mallory' } }
  assert.notEqual(cardDigest(other), sealed.integrity.sha256)
})
