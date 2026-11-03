/**
 * 从「名称 + 角色设定」构图：persona 注入、id 生成、包组装。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { injectPersona, slugFromName, buildAgentPackage, listBasePresets } from '../lib/types/host/agent-build.js'

const baseYaml = `# 注释保留
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: >-
      旧的设定

- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
`

test('persona 段被替换，其他行保留', () => {
  const r = injectPersona(baseYaml, '你是评审员。\n只看 diff。')
  assert.equal(r.ok, true)
  assert.ok(r.yaml.includes('你是评审员。'))
  assert.ok(!r.yaml.includes('旧的设定'))
  assert.ok(r.yaml.includes('- id: tool-bash'))
  assert.ok(r.yaml.includes('# 注释保留'))
})

test('没有 persona 行时报错而不是硬塞', () => {
  const r = injectPersona('- id: tool-bash\n  name: x\n', '你是评审员。')
  assert.equal(r.ok, false)
  assert.ok(String(r.error).includes('persona'))
})

test('名称 → id：英文可读、中文走哈希兜底', () => {
  assert.equal(slugFromName('PR Reviewer'), 'pr-reviewer')
  assert.match(slugFromName('PR 审阅'), /^agent-[a-z0-9]{1,6}$/)
})

test('列基础 preset 只认带 agent.cordis.yml 的目录', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lanim-presets-'))
  await mkdir(join(dir, 'good'))
  await writeFile(join(dir, 'good', 'agent.cordis.yml'), baseYaml)
  await mkdir(join(dir, 'empty'))
  const bases = await listBasePresets(dir)
  assert.deepEqual(bases.map((b) => b.name), ['good'])
})

test('构图：卡片带 prompt，preset 里是作者原文，另附 PROMPT.md', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lanim-presets-'))
  await mkdir(join(dir, 'std'))
  await writeFile(join(dir, 'std', 'agent.cordis.yml'), baseYaml)

  const prompt = '你是代码评审员。\n先看风险，再看测试覆盖。\n用中文给结论。'
  const built = await buildAgentPackage({ presetsDir: dir, base: 'std', accountId: 'alice', name: 'PR Reviewer', prompt })
  assert.equal(built.ok, true)
  assert.equal(built.card.prompt, prompt)
  assert.equal(built.card.id, 'pr-reviewer')
  assert.equal(built.card.summary, '你是代码评审员。')

  const preset = built.files.find((f) => f.path === 'preset.yml')
  assert.ok(preset.data.includes('你是代码评审员。'))
  assert.ok(preset.data.includes('- id: tool-bash'))

  const role = built.files.find((f) => f.path === 'PROMPT.md')
  assert.equal(role.data.trim(), prompt)
})

test('构图：没基础 preset 时给可读错误', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lanim-presets-'))
  const built = await buildAgentPackage({ presetsDir: dir, base: 'nope', accountId: 'alice', name: 'X', prompt: '你是助手，认真回答问题。' })
  assert.equal(built.ok, false)
  assert.ok(built.errors.some((e) => e.field === 'base'))
})

test('构图：prompt 太短被拒', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lanim-presets-'))
  await mkdir(join(dir, 'std'))
  await writeFile(join(dir, 'std', 'agent.cordis.yml'), baseYaml)
  const built = await buildAgentPackage({ presetsDir: dir, base: 'std', accountId: 'alice', name: 'X', prompt: '短' })
  assert.equal(built.ok, false)
  assert.ok(built.errors.some((e) => e.field === 'prompt'))
})
