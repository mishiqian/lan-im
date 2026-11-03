/**
 * 调用授权：身份验证 + 授权两件事，没有别的层级。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { authorizeCall, authorizeSessionControl } from '../lib/types/host/agent-acl.js'

const caller = (over = {}) => ({ accountId: 'bob', verified: true, ...over })
const target = (over = {}) => ({ id: 'pr-review', authorAccountId: 'alice', callable: true, ...over })

test('身份已验证 + 卡片开放调用 → 放行', () => {
  assert.equal(authorizeCall(caller(), target()).ok, true)
})

test('身份未验证 → 拒绝（没有降级通道）', () => {
  const r = authorizeCall(caller({ verified: false }), target())
  assert.equal(r.ok, false)
  assert.match(r.error, /身份未通过验证/)
})

test('身份缺失（握手没完成）→ 拒绝', () => {
  assert.equal(authorizeCall(caller({ accountId: '' }), target()).ok, false)
})

test('卡片没开放调用 → 拒绝', () => {
  const r = authorizeCall(caller(), target({ callable: false }))
  assert.equal(r.ok, false)
  assert.match(r.error, /没有开放调用/)
})

test('不存在的 agent → 拒绝', () => {
  assert.equal(authorizeCall(caller(), undefined).ok, false)
})

test('会话只能由开它的人驱动', () => {
  assert.equal(authorizeSessionControl('bob', 'bob').ok, true)
  assert.equal(authorizeSessionControl('eve', 'bob').ok, false)
  assert.equal(authorizeSessionControl('', 'bob').ok, false)
  assert.equal(authorizeSessionControl('bob', undefined).ok, false)
})
