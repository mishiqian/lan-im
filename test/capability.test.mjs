/**
 * 能力包络的四道闸：工具白名单、路径/命令/域名范围、预算。
 * 重点覆盖真实绕过手法：路径穿越、符号链接逃逸、前缀误判、命令拼接、域名后缀欺骗。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CapabilitySet, SessionBudget, decideToolCall } from '../lib/types/host/capability.js'

const grants = () => ([
  { name: 'fs.read', scope: 'share/**' },
  { name: 'fs.write', scope: 'share/out/**' },
  { name: 'bash', allow: ['git log', 'rg ', 'ls'], deny: ['rm', 'curl'] },
  { name: 'web.fetch', allow: ['*.github.com', 'example.org'] },
])

test('第一道闸：未声明工具一律拒绝', () => {
  const caps = new CapabilitySet(grants(), tmpdir())
  assert.equal(caps.checkTool('fs.read').decision, 'allow')
  assert.equal(caps.checkTool('fs.remove').decision, 'deny')
})

test('路径必须落在 scope 内', () => {
  const caps = new CapabilitySet(grants(), tmpdir())
  assert.equal(caps.checkPath('fs.read', 'share/a.md').decision, 'allow')
  assert.equal(caps.checkPath('fs.read', 'share/deep/b.md').decision, 'allow')
  assert.equal(caps.checkPath('fs.read', 'other/a.md').decision, 'deny')
  // 前缀误判：share-evil 不在 share 下
  assert.equal(caps.checkPath('fs.read', 'share-evil/a.md').decision, 'deny')
  // 写权限只到 share/out
  assert.equal(caps.checkPath('fs.write', 'share/out/x.md').decision, 'allow')
  assert.equal(caps.checkPath('fs.write', 'share/x.md').decision, 'deny')
})

test('绝对路径与 .. 被拒', () => {
  const caps = new CapabilitySet(grants(), tmpdir())
  assert.equal(caps.checkPath('fs.read', '/etc/passwd').decision, 'deny')
  assert.equal(caps.checkPath('fs.read', 'share/../../etc/passwd').decision, 'deny')
})

test('符号链接逃逸被 realpath 挡住', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lanim-cap-'))
  await mkdir(join(root, 'share'))
  const outside = await mkdtemp(join(tmpdir(), 'lanim-out-'))
  await writeFile(join(outside, 'secret.txt'), 'secret')
  await symlink(outside, join(root, 'share', 'link'))

  const caps = new CapabilitySet(grants(), root)
  // 字面路径在 share 下，但解析后指向外部
  assert.equal(caps.checkPath('fs.read', 'share/link/secret.txt').decision, 'deny')
})

test('命令：allow 命中放行，deny 优先', () => {
  const caps = new CapabilitySet(grants(), tmpdir())
  assert.equal(caps.checkCommand('git log --oneline -5').decision, 'allow')
  assert.equal(caps.checkCommand('rg TODO src/').decision, 'allow')
  assert.equal(caps.checkCommand('rm -rf /').decision, 'deny')
  assert.equal(caps.checkCommand('curl http://x').decision, 'deny')
  assert.equal(caps.checkCommand('cat /etc/passwd').decision, 'deny')
})

test('命令拼接与控制符被拒', () => {
  const caps = new CapabilitySet(grants(), tmpdir())
  assert.equal(caps.checkCommand('ls; rm -rf /').decision, 'deny')
  assert.equal(caps.checkCommand('ls && curl evil').decision, 'deny')
  assert.equal(caps.checkCommand('ls $(whoami)').decision, 'deny')
  assert.equal(caps.checkCommand('ls > out.txt').decision, 'deny')
})

test('域名：后缀匹配，但不能被相似域欺骗', () => {
  const caps = new CapabilitySet(grants(), tmpdir())
  assert.equal(caps.checkDomain('https://api.github.com/x').decision, 'allow')
  assert.equal(caps.checkDomain('https://github.com/x').decision, 'allow')
  assert.equal(caps.checkDomain('https://example.org/a').decision, 'allow')
  // 相似域
  assert.equal(caps.checkDomain('https://github.com.evil.com/x').decision, 'deny')
  assert.equal(caps.checkDomain('https://notgithub.com/x').decision, 'deny')
  assert.equal(caps.checkDomain('not a url').decision, 'deny')
})

test('预算：轮数/token/时长耗尽即拒', () => {
  const budget = new SessionBudget({ turns: 2, tokens: 100, seconds: 3600 })
  assert.equal(budget.beginTurn().decision, 'allow')
  assert.equal(budget.beginTurn().decision, 'allow')
  assert.equal(budget.beginTurn().decision, 'deny')

  const tokenBudget = new SessionBudget({ turns: 5, tokens: 100, seconds: 3600 })
  assert.equal(tokenBudget.addTokens(60).decision, 'allow')
  assert.equal(tokenBudget.addTokens(60).decision, 'deny')
})

test('未声明 scope 的 fs 授权视为无效', () => {
  const caps = new CapabilitySet([{ name: 'fs.read' }], tmpdir())
  assert.equal(caps.checkPath('fs.read', 'share/a.md').decision, 'deny')
})

test('工具名映射：bash / read / write / 未知工具', () => {
  const caps = new CapabilitySet(grants(), tmpdir())
  assert.equal(decideToolCall(caps, 'bash', { command: 'git log' }).decision, 'allow')
  assert.equal(decideToolCall(caps, 'bash', { command: 'rm -rf /' }).decision, 'deny')
  assert.equal(decideToolCall(caps, 'read', { file_path: 'share/a.md' }).decision, 'allow')
  assert.equal(decideToolCall(caps, 'read', { file_path: '/etc/passwd' }).decision, 'deny')
  assert.equal(decideToolCall(caps, 'write', { file_path: 'share/out/x.md' }).decision, 'allow')
  assert.equal(decideToolCall(caps, 'write', { file_path: 'share/x.md' }).decision, 'deny')
  // 未授权工具默认拒绝（不是放行）
  assert.equal(decideToolCall(caps, 'subagent', {}).decision, 'deny')
  // 缺路径的读类工具直接拒绝，避免「不给 path 就扫全盘」
  assert.equal(decideToolCall(caps, 'glob', { pattern: '**/*.md' }).decision, 'deny')
})
