/**
 * Agent 卡片：唯一的发布单元。
 *
 * 职责边界：
 * - 只做「定义 + 校验 + 规范化 + 内容哈希」，不做 IO、不碰网络、不碰 DSH 服务；
 * - 校验必须给出字段级错误（发布流程直接展示给作者）；
 * - 哈希用于克隆安装时防篡改，签名字段留给 M2。
 */
import { createHash } from 'node:crypto'

export const AGENT_CARD_SCHEMA = 1

/** agent id：小写字母/数字/连字符，2–32 位 */
export const AGENT_ID_RE = /^[a-z0-9][a-z0-9-]{1,31}$/
/** 账号：与现有账号规则一致 */
export const AGENT_ACCOUNT_RE = /^[a-zA-Z0-9_.-]{1,32}$/
export const AGENT_SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/** 能力包络允许声明的工具（未在此列的工具一律拒绝） */
export const AGENT_TOOLS = ['fs.read', 'fs.write', 'bash', 'web.fetch'] as const
export type AgentToolName = (typeof AGENT_TOOLS)[number]

export const AGENT_PERMISSIONS = ['read-only', 'workspace-write', 'danger-full-access'] as const
export type AgentPermission = (typeof AGENT_PERMISSIONS)[number]

export interface AgentToolGrant {
  name: AgentToolName
  /** fs.read / fs.write：相对 agent 根目录的路径范围，如 "share/**" */
  scope?: string
  /** bash / web.fetch：允许的前缀或域名 */
  allow?: string[]
  /** bash：明确禁止的前缀（优先级高于 allow） */
  deny?: string[]
}

export interface AgentBudget {
  turns?: number
  tokens?: number
  seconds?: number
}

export interface AgentSample {
  in: string
  out: string
  note?: string
}

export interface AgentCard {
  schema: number
  id: string
  version: string
  name: string
  summary: string
  author: { accountId: string; keyId?: string }
  input: { type: 'text' | 'file' | 'any'; hint?: string }
  output: { type: 'markdown' | 'text' | 'json' | 'file' }
  requires: {
    model?: string
    permissions?: AgentPermission
    tools: AgentToolGrant[]
    budget: AgentBudget
  }
  exposure: { cloneable: boolean; callable: boolean; acl?: 'lan' | 'accounts'; accounts?: string[] }
  samples: AgentSample[]
  integrity?: { sha256?: string; keyId?: string; sig?: string }
}

export interface CardIssue {
  field: string
  message: string
}

export interface CardResult { ok: boolean; card?: AgentCard; errors: CardIssue[] }

const INPUT_TYPES = ['text', 'file', 'any'] as const
const OUTPUT_TYPES = ['markdown', 'text', 'json', 'file'] as const

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isStr = (v: unknown): v is string => typeof v === 'string'
const clampInt = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback

/** 路径范围：不得绝对路径、不得含 `..`；允许尾部 `/**` */
function scopeProblem(scope: unknown): string | undefined {
  if (!isStr(scope) || scope.trim() === '') return '缺少 scope'
  const s = scope.trim()
  if (s.startsWith('/') || /^[a-zA-Z]:/.test(s)) return 'scope 必须是相对路径'
  if (s.split('/').some((seg) => seg === '..')) return 'scope 不能包含 ..'
  return undefined
}

/**
 * 校验并规范化卡片。成功返回规范化后的卡片（默认值已补齐、字符串已 trim）。
 * 失败返回字段级错误列表，调用方直接展示，不需要再猜。
 */
export function validateCard(raw: unknown): CardResult {
  const errors: CardIssue[] = []
  const push = (field: string, message: string): void => { errors.push({ field, message }) }

  if (!isRecord(raw)) return { ok: false, errors: [{ field: '$', message: '卡片必须是对象' }] }

  if (raw.schema !== AGENT_CARD_SCHEMA) push('schema', `schema 必须是 ${AGENT_CARD_SCHEMA}`)

  const id = isStr(raw.id) ? raw.id.trim() : ''
  if (!AGENT_ID_RE.test(id)) push('id', 'id 只能是 2–32 位小写字母/数字/连字符，且以字母或数字开头')

  const version = isStr(raw.version) ? raw.version.trim() : ''
  if (!AGENT_SEMVER_RE.test(version)) push('version', 'version 必须是 semver，如 1.0.0')

  const name = isStr(raw.name) ? raw.name.trim() : ''
  if (name === '' || name.length > 24) push('name', 'name 必填，且不超过 24 字')

  const summary = isStr(raw.summary) ? raw.summary.trim() : ''
  if (summary === '' || summary.length > 80) push('summary', 'summary 必填，且不超过 80 字')

  const authorRaw = isRecord(raw.author) ? raw.author : {}
  const accountId = isStr(authorRaw.accountId) ? authorRaw.accountId.trim() : ''
  if (!AGENT_ACCOUNT_RE.test(accountId)) push('author.accountId', 'author.accountId 非法')

  const inputRaw = isRecord(raw.input) ? raw.input : {}
  const inputType = isStr(inputRaw.type) ? inputRaw.type : 'text'
  if (!(INPUT_TYPES as readonly string[]).includes(inputType)) push('input.type', `input.type 只能是 ${INPUT_TYPES.join(' / ')}`)

  const outputRaw = isRecord(raw.output) ? raw.output : {}
  const outputType = isStr(outputRaw.type) ? outputRaw.type : 'markdown'
  if (!(OUTPUT_TYPES as readonly string[]).includes(outputType)) push('output.type', `output.type 只能是 ${OUTPUT_TYPES.join(' / ')}`)

  const requiresRaw = isRecord(raw.requires) ? raw.requires : {}
  const permissions = isStr(requiresRaw.permissions) ? requiresRaw.permissions : 'read-only'
  if (!(AGENT_PERMISSIONS as readonly string[]).includes(permissions)) {
    push('requires.permissions', `permissions 只能是 ${AGENT_PERMISSIONS.join(' / ')}`)
  }

  const toolsRaw = Array.isArray(requiresRaw.tools) ? requiresRaw.tools : []
  const tools: AgentToolGrant[] = []
  const seenTools = new Set<string>()
  toolsRaw.forEach((grant, i) => {
    const field = `requires.tools[${i}]`
    if (!isRecord(grant)) { push(field, '工具声明必须是对象'); return }
    const toolName = isStr(grant.name) ? grant.name : ''
    if (!(AGENT_TOOLS as readonly string[]).includes(toolName)) {
      push(`${field}.name`, `未知工具 ${JSON.stringify(toolName)}；可用：${AGENT_TOOLS.join(', ')}`)
      return
    }
    if (seenTools.has(toolName)) { push(`${field}.name`, `工具 ${toolName} 重复声明`); return }
    seenTools.add(toolName)

    const normalized: AgentToolGrant = { name: toolName as AgentToolName }
    if (toolName === 'fs.read' || toolName === 'fs.write') {
      const problem = scopeProblem(grant.scope)
      if (problem !== undefined) push(`${field}.scope`, problem)
      else normalized.scope = String(grant.scope).trim()
    } else {
      const allow = Array.isArray(grant.allow) ? grant.allow.filter(isStr).map((s) => s.trim()).filter(Boolean) : []
      if (allow.length === 0) push(`${field}.allow`, `${toolName} 必须声明允许范围（allow 至少一条）`)
      normalized.allow = allow
      if (toolName === 'bash' && Array.isArray(grant.deny)) {
        normalized.deny = grant.deny.filter(isStr).map((s) => s.trim()).filter(Boolean)
      }
    }
    tools.push(normalized)
  })

  const budgetRaw = isRecord(requiresRaw.budget) ? requiresRaw.budget : {}
  const budget: AgentBudget = {
    turns: clampInt(budgetRaw.turns, 1, 200, 30),
    tokens: clampInt(budgetRaw.tokens, 1000, 500000, 60000),
    seconds: clampInt(budgetRaw.seconds, 30, 86400, 1800),
  }

  const exposureRaw = isRecord(raw.exposure) ? raw.exposure : {}
  const cloneable = exposureRaw.cloneable === true
  const callable = exposureRaw.callable === true
  if (!cloneable && !callable) push('exposure', 'cloneable 与 callable 至少有一个为 true，否则这个 agent 发布出去没人能用')
  const acl = exposureRaw.acl === 'accounts' ? 'accounts' : 'lan'
  const accounts = Array.isArray(exposureRaw.accounts)
    ? exposureRaw.accounts.filter(isStr).map((s) => s.trim()).filter((s) => AGENT_ACCOUNT_RE.test(s))
    : []
  if (acl === 'accounts' && accounts.length === 0) push('exposure.accounts', 'acl 为 accounts 时必须给出账号列表')

  const samplesRaw = Array.isArray(raw.samples) ? raw.samples : []
  if (samplesRaw.length === 0) push('samples', '至少给 1 组样例，接收方靠它判断好不好用')
  if (samplesRaw.length > 3) push('samples', '样例最多 3 组')
  const samples: AgentSample[] = []
  samplesRaw.slice(0, 3).forEach((s, i) => {
    const field = `samples[${i}]`
    if (!isRecord(s)) { push(field, '样例必须是对象'); return }
    const input = isStr(s.in) ? s.in : ''
    const output = isStr(s.out) ? s.out : ''
    if (input.trim() === '') push(`${field}.in`, '样例缺少输入')
    if (output.trim() === '') push(`${field}.out`, '样例缺少输出')
    if (input.length > 8000 || output.length > 8000) push(field, '单组样例不超过 8000 字')
    samples.push({ in: input, out: output, ...(isStr(s.note) && s.note.trim() !== '' ? { note: s.note.trim() } : {}) })
  })

  if (errors.length > 0) return { ok: false, errors }

  const card: AgentCard = {
    schema: AGENT_CARD_SCHEMA,
    id,
    version,
    name,
    summary,
    author: { accountId, ...(isStr(authorRaw.keyId) && authorRaw.keyId !== '' ? { keyId: String(authorRaw.keyId) } : {}) },
    input: { type: inputType as AgentCard['input']['type'], ...(isStr(inputRaw.hint) && inputRaw.hint.trim() !== '' ? { hint: inputRaw.hint.trim().slice(0, 200) } : {}) },
    output: { type: outputType as AgentCard['output']['type'] },
    requires: { ...(isStr(requiresRaw.model) && requiresRaw.model !== '' ? { model: String(requiresRaw.model) } : {}), permissions: permissions as AgentPermission, tools, budget },
    exposure: { cloneable, callable, acl, ...(acl === 'accounts' ? { accounts } : {}) },
    samples,
    // 完整性块原样保留：校验只规范化业务字段，不能把哈希洗掉
    ...(isRecord(raw.integrity) ? { integrity: raw.integrity as AgentCard['integrity'] } : {}),
  }
  return { ok: true, card, errors: [] }
}

/** 递归排序键，得到稳定 JSON（哈希的前提） */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/** 内容哈希：覆盖除 integrity 以外的全部字段 */
export function cardDigest(card: AgentCard): string {
  const { integrity: _omit, ...rest } = card
  return createHash('sha256').update(canonicalJson(rest)).digest('hex')
}

/** 盖上哈希（发布前调用） */
export function sealCard(card: AgentCard): AgentCard {
  return { ...card, integrity: { ...(card.integrity ?? {}), sha256: cardDigest(card) } }
}

/** 校验哈希（克隆安装前调用） */
export function verifyCard(card: AgentCard): boolean {
  const expected = card.integrity?.sha256
  return typeof expected === 'string' && expected !== '' && expected === cardDigest(card)
}
