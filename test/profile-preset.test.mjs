/**
 * preset 行写入 profile patch：只做文本块增删，不解析整份 YAML。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildPresetBlock, upsertPresetBlock, removePresetBlock, presetRowId, presetName, writePresetRow, removePresetRow,
} from '../lib/types/host/profile-preset.js'

const composition = `- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: |
      你是代码评审员。
- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
`

const input = () => ({ account: 'alice', agentId: 'agent-19wyua', agentName: 'PR 审阅', composition, order: 120 })

test('行 id 与 preset 名稳定且合法', () => {
  assert.equal(presetRowId('alice', 'agent-19wyua'), 'preset-lanim-alice-agent-19wyua')
  assert.equal(presetName('Alice', 'PR-Reviewer'), 'alice-pr-reviewer')
})

test('块里包含 preset 行、id、order 与缩进后的组合', () => {
  const block = buildPresetBlock(input())
  assert.ok(block.includes('- insert:'))
  assert.ok(block.includes("      name: '@deepseek-ai/dsh-agent-preset'"))
  assert.ok(block.includes('        id: alice-agent-19wyua'))
  assert.ok(block.includes('        order: 120'))
  assert.ok(block.includes('          - id: persona'))
  assert.ok(block.includes('# >>> lanim-agent:alice/agent-19wyua'))
})

test('追加到已有 patch 后面，不破坏原内容', () => {
  const existing = '- id: ui-chat\n  name: "@deepseek-ai/dsh-client-ui-chat"\n'
  const next = upsertPresetBlock(existing, input())
  assert.ok(next.startsWith(existing.trimEnd()))
  assert.ok(next.includes('# >>> lanim-agent:alice/agent-19wyua'))
})

test('重复写入是替换而不是叠加', () => {
  const once = upsertPresetBlock('', input())
  const twice = upsertPresetBlock(once, { ...input(), order: 200 })
  assert.equal((twice.match(/# >>> lanim-agent:alice\/agent-19wyua/g) ?? []).length, 1)
  assert.ok(twice.includes('order: 200'))
  assert.ok(!twice.includes('order: 120'))
})

test('卸载只删自己的块', () => {
  const other = '\n- id: other\n  name: x\n'
  const withBoth = upsertPresetBlock(other, input())
  const removed = removePresetBlock(withBoth, 'alice', 'agent-19wyua')
  assert.ok(!removed.includes('lanim-agent:alice'))
  assert.ok(removed.includes('- id: other'))
})

test('空数组 [] 的 patch 直接替换，不拼接非法 YAML', () => {
  const next = upsertPresetBlock('[]\n', input())
  assert.ok(!next.startsWith('[]'))
  assert.ok(next.startsWith('# >>> lanim-agent'))
})

test('flow 数组写法明确报错，不产出坏文件', () => {
  assert.throws(() => upsertPresetBlock('[ { id: x } ]\n', input()), /flow/)
})

test('落盘：写入 → 读回 → 删除', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lanim-patch-'))
  const file = join(dir, 'cordis.patch.yml')
  await writeFile(file, '- id: keep\n  name: keep\n')
  const wrote = await writePresetRow(file, input())
  assert.equal(wrote.ok, true)

  const text = await readFile(file, 'utf8')
  assert.ok(text.includes('lanim-agent:alice/agent-19wyua'))
  assert.ok(text.includes('- id: keep'))

  const removed = await removePresetRow(file, 'alice', 'agent-19wyua')
  assert.equal(removed.ok, true)
  const after = await readFile(file, 'utf8')
  assert.ok(!after.includes('lanim-agent'))
  assert.ok(after.includes('- id: keep'))
})
