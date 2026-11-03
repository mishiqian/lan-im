/**
 * 把安装好的 agent 注册成 profile 里的 preset 行。
 *
 * 为什么需要：preset 不是扫描 `.agent-presets/` 目录来的，而是 profile 组合里的
 * `preset-*` 配置行（和 standard / minimal 同一机制）。所以「装到本机」要真的出现在
 * preset 下拉里，就必须往 profile 的 patch 文件里写一行。
 *
 * 做法：用注释标记包住一段 YAML，卸载时整段删掉；重复安装则原地替换。
 * 缺点：需要重启 dsh 生效——这一点在安装结果里如实返回。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'

export interface PresetRowInput {
  /** 作者账号 + agent id，用来生成稳定的行 id 与标记 */
  account: string
  agentId: string
  agentName: string
  /** 包里的 agent.cordis.yml 原文（顶层 YAML 列表） */
  composition: string
  order?: number
}

const marker = (input: Pick<PresetRowInput, 'account' | 'agentId'>): string =>
  `lanim-agent:${input.account}/${input.agentId}`

/** preset 行 id：只允许小写字母/数字/连字符 */
export function presetRowId(account: string, agentId: string): string {
  const slug = `${account}-${agentId}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-')
  return `preset-lanim-${slug}`.slice(0, 64)
}

/** 组合里的 preset id（用户看到的名字） */
export function presetName(account: string, agentId: string): string {
  return `${account}-${agentId}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
}

/** 生成带标记的 YAML 块；composition 的每一行缩进到 plugins 之下 */
export function buildPresetBlock(input: PresetRowInput): string {
  const key = marker(input)
  const rowId = presetRowId(input.account, input.agentId)
  const name = presetName(input.account, input.agentId)
  // 组合原文整体缩进到 plugins 之下（10 空格）
  const body = input.composition
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : `          ${line}`))
    .join('\n')
    .replace(/\n+$/, '')
  return [
    `# >>> ${key}`,
    // profile patch 是「覆盖层」：新增行必须走 insert，直接写 - id: X 会被当成覆盖不存在的行
    '- insert:',
    `    - id: ${rowId}`,
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    `        id: ${name}`,
    `        order: ${input.order ?? 100}`,
    '        plugins:',
    body,
    `# <<< ${key}`,
    '',
  ].join('\n')
}

/** 从已有文本里摘掉某个 agent 的块；返回新文本 */
export function removePresetBlock(text: string, account: string, agentId: string): string {
  const key = marker({ account, agentId })
  const start = text.indexOf(`# >>> ${key}`)
  if (start < 0) return text
  const endMark = `# <<< ${key}`
  const end = text.indexOf(endMark, start)
  if (end < 0) return text
  const after = end + endMark.length
  const rest = text.slice(after).replace(/^\n/, '')
  return `${text.slice(0, start)}${rest}`.replace(/\n{3,}/g, '\n\n')
}

/** 写入或替换；返回最终文本（便于测试） */
export function upsertPresetBlock(text: string, input: PresetRowInput): string {
  const cleaned = removePresetBlock(text, input.account, input.agentId)
  const block = buildPresetBlock(input)
  const trimmed = cleaned.replace(/\s+$/, '')
  // 空文件或空数组（`[]`）都不能直接追加——`[]` 后面接块序列是非法的 YAML
  if (trimmed === '' || trimmed === '[]') return block
  // 顶层是 flow 形式（如 `[ ... ]`）时无法安全追加块序列，交给调用方报错
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    throw new Error('profile patch 使用了 flow 数组写法，无法追加 preset 行，请改成块写法')
  }
  return `${trimmed}\n\n${block}`
}

export interface PatchResult { ok: boolean; file: string; error?: string }

/** 真正落盘：读 → 改 → 写 */
export async function writePresetRow(patchFile: string, input: PresetRowInput): Promise<PatchResult> {
  try {
    let current = ''
    if (existsSync(patchFile)) current = await readFile(patchFile, 'utf8')
    const next = upsertPresetBlock(current, input)
    await mkdir(dirname(patchFile), { recursive: true })
    await writeFile(patchFile, next, 'utf8')
    return { ok: true, file: patchFile }
  } catch (err: any) {
    return { ok: false, file: patchFile, error: String(err?.message ?? err) }
  }
}

/** 卸载：删掉对应块 */
export async function removePresetRow(patchFile: string, account: string, agentId: string): Promise<PatchResult> {
  try {
    if (!existsSync(patchFile)) return { ok: true, file: patchFile }
    const current = await readFile(patchFile, 'utf8')
    const next = removePresetBlock(current, account, agentId)
    if (next !== current) await writeFile(patchFile, next, 'utf8')
    return { ok: true, file: patchFile }
  } catch (err: any) {
    return { ok: false, file: patchFile, error: String(err?.message ?? err) }
  }
}
