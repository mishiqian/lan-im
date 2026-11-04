/**
 * 从「名称 + 角色设定」生成可发布的 agent 包。
 *
 * 关键点：agent 的核心是 prompt，不是表单。所以这里做的是——
 * 拿一份本机已有的 preset 当骨架，把它的 persona 段替换成作者的 prompt，
 * 其余行（工具、技能、模型路由）原样保留。这样装到对方机器上，
 * 生效的就是作者的 prompt，而不是一段占位 YAML。
 */
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentCard, AgentToolGrant } from '../protocol.ts'
import type { AgentPackageFile } from '../protocol.ts'

export interface BasePreset {
  /** 目录名，如 agent-dev */
  name: string
  /** 文件路径 */
  path: string
}

/** 列出可当骨架的 preset（有 agent.cordis.yml 的目录） */
export async function listBasePresets(presetsDir: string): Promise<BasePreset[]> {
  if (!existsSync(presetsDir)) return []
  const items = await readdir(presetsDir, { withFileTypes: true })
  const out: BasePreset[] = []
  for (const item of items) {
    if (!item.isDirectory()) continue
    const path = join(presetsDir, item.name, 'agent.cordis.yml')
    if (existsSync(path)) out.push({ name: item.name, path })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** 把 preset 里的 persona 段替换成给定 prompt；找不到 persona 行就报错（不猜结构） */
export function injectPersona(baseYaml: string, prompt: string): { ok: boolean; yaml?: string; error?: string } {
  const lines = baseYaml.split('\n')
  const start = lines.findIndex((line) => /^- id: persona\s*$/.test(line))
  if (start < 0) return { ok: false, error: '这份基础 preset 里没有 persona 行，换一个再发布' }

  let end = start + 1
  while (end < lines.length && !/^-\s/.test(lines[end])) end++

  const body = prompt.trimEnd().split('\n').map((line) => (line === '' ? '' : `      ${line}`))
  // 注意：这一版 persona 的配置键是 prefix（不是老 preset 里的 text）
  const block = [
    '- id: persona',
    "  name: '@deepseek-ai/dsh-persona'",
    '  config:',
    '    prefix: |',
    ...body,
    '',
  ]
  const next = [...lines.slice(0, start), ...block, ...lines.slice(end)]
  return { ok: true, yaml: next.join('\n') }
}

/** 名称 → id：小写、非字母数字转连字符；中文名走兜底 */
export function slugFromName(name: string): string {
  const ascii = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (ascii.length >= 3) return ascii.slice(0, 32)
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0
  return `agent-${hash.toString(36).slice(0, 6)}`
}

export interface BuildInput {
  presetsDir: string
  base: string
  accountId: string
  /** 编辑已有 agent 时沿用原 id */
  id?: string
  name: string
  prompt: string
  summary?: string
  tools?: AgentToolGrant[]
  cloneable?: boolean
  callable?: boolean
  sampleIn?: string
  sampleOut?: string
  version?: string
}

export interface BuildResult {
  ok: boolean
  errors: Array<{ field: string; message: string }>
  card?: AgentCard
  files?: AgentPackageFile[]
}

const firstLine = (text: string): string => {
  const line = text.trim().split('\n').find((l) => l.trim() !== '') ?? ''
  return line.length > 60 ? `${line.slice(0, 60)}…` : line
}

/** 组装卡片与包内文件（不做哈希，交给 createPackage） */
export async function buildAgentPackage(input: BuildInput): Promise<BuildResult> {
  const errors: Array<{ field: string; message: string }> = []
  const name = input.name.trim()
  const prompt = input.prompt.trim()
  if (name === '') errors.push({ field: 'name', message: '名称必填' })
  if (prompt.length < 10) errors.push({ field: 'prompt', message: '角色设定至少 10 个字' })

  const bases = await listBasePresets(input.presetsDir)
  const base = bases.find((b) => b.name === input.base)
  if (base === undefined) {
    errors.push({ field: 'base', message: `找不到基础 preset「${input.base}」，可选：${bases.map((b) => b.name).join(' / ') || '（无）'}` })
  }
  if (errors.length > 0 || base === undefined) return { ok: false, errors }

  let yaml: string
  try {
    yaml = await readFile(base.path, 'utf8')
  } catch (err: any) {
    return { ok: false, errors: [{ field: 'base', message: `读不到 ${base.path}：${err?.message ?? err}` }] }
  }
  const injected = injectPersona(yaml, prompt)
  if (!injected.ok || injected.yaml === undefined) {
    return { ok: false, errors: [{ field: 'base', message: injected.error ?? '注入 persona 失败' }] }
  }

  const summary = (input.summary ?? '').trim() || firstLine(prompt)
  const tools = input.tools ?? []
  const card: AgentCard = {
    schema: 1,
    id: input.id !== undefined && input.id !== '' ? input.id : slugFromName(name),
    version: input.version ?? '1.0.0',
    name,
    summary: summary.slice(0, 80),
    prompt,
    author: { accountId: input.accountId },
    input: { type: 'text' },
    output: { type: 'markdown' },
    requires: { permissions: 'read-only', tools, budget: {} },
    exposure: { cloneable: input.cloneable !== false, callable: input.callable === true, acl: 'lan' },
    samples: (input.sampleIn ?? '').trim() === '' && (input.sampleOut ?? '').trim() === ''
      ? []
      : [{ in: input.sampleIn ?? '', out: input.sampleOut ?? '' }],
  }

  const files: AgentPackageFile[] = [
    { path: 'preset.yml', encoding: 'utf8', data: injected.yaml },
    { path: 'skills/ROLE.md', encoding: 'utf8', data: `# ${name}\n\n${prompt}\n` },
    { path: 'PROMPT.md', encoding: 'utf8', data: `${prompt}\n` },
  ]
  return { ok: true, errors: [], card, files }
}
