/**
 * Agent 包：卡片 + 文件的单文件分发格式。
 *
 * M0 先用「一个 JSON」：文本内联、二进制 base64。理由是走现有文件通道最省事、
 * 接收方一眼能看清内容（源码可见是既定策略），也不用引入 tar 依赖。
 * 体积上限 4 MB，超出请拆 agent，不要塞数据集。
 */
import { createHash } from 'node:crypto'
import { canonicalJson, cardDigest, sealCard, validateCard, verifyCard, type AgentCard } from './agent-card.ts'

export const AGENT_PACKAGE_FORMAT = 'lanim-agent'
export const AGENT_PACKAGE_SCHEMA = 1
export const MAX_PACKAGE_BYTES = 4 * 1024 * 1024
export const MAX_FILE_BYTES = 1024 * 1024

export interface AgentPackageFile {
  /** 包内相对路径，如 skills/review.md */
  path: string
  encoding: 'utf8' | 'base64'
  data: string
}

export interface AgentPackage {
  format: string
  schema: number
  card: AgentCard
  files: AgentPackageFile[]
  integrity: { card: string; files: string; pkg: string }
}

export interface PackageIssue { field: string; message: string }
export interface PackageResult { ok: boolean; pkg?: AgentPackage; errors: PackageIssue[] }

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

/** 包内路径安全：相对、无 `..`、无绝对路径、无反斜杠 */
export function packagePathProblem(path: unknown): string | undefined {
  if (typeof path !== 'string' || path.trim() === '') return '缺少文件路径'
  const p = path.trim()
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return '不能是绝对路径'
  if (p.includes('\\')) return '不能包含反斜杠'
  if (p.split('/').some((seg) => seg === '..' || seg === '')) return '路径不能为空段或包含 ..'
  if (p.split('/').length > 6) return '目录层级过深'
  return undefined
}

/** 文件清单的哈希：按路径排序后只覆盖 path / encoding / 内容哈希 */
export function filesDigest(files: AgentPackageFile[]): string {
  const rows = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => ({ path: f.path, encoding: f.encoding, sha256: sha256(f.data) }))
  return sha256(canonicalJson(rows))
}

/** 整包哈希：卡片哈希 + 文件清单哈希 */
export function packageDigest(pkg: Pick<AgentPackage, 'card' | 'files'>): string {
  return sha256(canonicalJson({ card: cardDigest(pkg.card), files: filesDigest(pkg.files) }))
}

/** 打包：校验卡片与路径，补上三层哈希 */
export function createPackage(rawCard: unknown, files: AgentPackageFile[]): PackageResult {
  const errors: PackageIssue[] = []
  const cardResult = validateCard(rawCard)
  if (!cardResult.ok) {
    return { ok: false, errors: cardResult.errors.map((e) => ({ field: `card.${e.field}`, message: e.message })) }
  }
  const card = sealCard(cardResult.card)

  const seen = new Set<string>()
  const normalized: AgentPackageFile[] = []
  files.forEach((file, i) => {
    const field = `files[${i}]`
    const problem = packagePathProblem(file.path)
    if (problem !== undefined) { errors.push({ field: `${field}.path`, message: problem }); return }
    if (seen.has(file.path)) { errors.push({ field: `${field}.path`, message: `路径重复：${file.path}` }); return }
    seen.add(file.path)
    if (file.encoding !== 'utf8' && file.encoding !== 'base64') {
      errors.push({ field: `${field}.encoding`, message: 'encoding 只能是 utf8 或 base64' })
      return
    }
    if (typeof file.data !== 'string') { errors.push({ field: `${field}.data`, message: 'data 必须是字符串' }); return }
    const bytes = file.encoding === 'base64' ? Buffer.byteLength(file.data, 'base64') : Buffer.byteLength(file.data, 'utf8')
    if (bytes > MAX_FILE_BYTES) { errors.push({ field: `${field}.data`, message: `单文件超过 1 MB（${bytes} 字节）` }); return }
    normalized.push({ path: file.path, encoding: file.encoding, data: file.data })
  })

  if (!seen.has('agent.json')) {
    // 卡片在包里同时以文件形式存在，接收方解包后可直接读
    normalized.push({ path: 'agent.json', encoding: 'utf8', data: `${JSON.stringify(card, null, 2)}\n` })
  }

  if (errors.length > 0) return { ok: false, errors }

  const total = normalized.reduce((sum, f) => sum + Buffer.byteLength(f.data, 'utf8'), 0)
  if (total > MAX_PACKAGE_BYTES) {
    return { ok: false, errors: [{ field: 'files', message: `整包超过 4 MB（${total} 字节）` }] }
  }

  const pkg: AgentPackage = {
    format: AGENT_PACKAGE_FORMAT,
    schema: AGENT_PACKAGE_SCHEMA,
    card,
    files: normalized,
    integrity: {
      card: card.integrity?.sha256 ?? '',
      files: filesDigest(normalized),
      pkg: packageDigest({ card, files: normalized }),
    },
  }
  return { ok: true, pkg, errors: [] }
}

/** 解包前校验：格式、卡片哈希、文件哈希、整包哈希、路径安全 */
export function verifyPackage(raw: unknown): PackageResult {
  const errors: PackageIssue[] = []
  const push = (field: string, message: string): void => { errors.push({ field, message }) }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: [{ field: '$', message: '包必须是对象' }] }
  }
  const pkg = raw as AgentPackage
  if (pkg.format !== AGENT_PACKAGE_FORMAT) push('format', `format 必须是 ${AGENT_PACKAGE_FORMAT}`)
  if (pkg.schema !== AGENT_PACKAGE_SCHEMA) push('schema', `schema 必须是 ${AGENT_PACKAGE_SCHEMA}`)

  const cardResult = validateCard(pkg.card)
  const card = cardResult.ok ? cardResult.card : undefined
  if (!cardResult.ok) {
    for (const e of cardResult.errors) push(`card.${e.field}`, e.message)
  } else if (card !== undefined && !verifyCard(card)) {
    push('card.integrity.sha256', '卡片内容与哈希不一致（可能被改过）')
  }

  const files = Array.isArray(pkg.files) ? pkg.files : []
  if (files.length === 0) push('files', '包内没有文件')
  for (const [i, file] of files.entries()) {
    const problem = packagePathProblem(file?.path)
    if (problem !== undefined) push(`files[${i}].path`, problem)
    if (file?.encoding !== 'utf8' && file?.encoding !== 'base64') push(`files[${i}].encoding`, 'encoding 非法')
    if (typeof file?.data !== 'string') push(`files[${i}].data`, 'data 必须是字符串')
  }

  if (errors.length === 0 && card !== undefined) {
    const expectedFiles = filesDigest(files)
    if (pkg.integrity?.files !== expectedFiles) push('integrity.files', '文件清单哈希不一致')
    const expectedPkg = packageDigest({ card, files })
    if (pkg.integrity?.pkg !== expectedPkg) push('integrity.pkg', '整包哈希不一致')
    const cardInFiles = files.find((f) => f.path === 'agent.json')
    if (cardInFiles === undefined) push('files', '缺少 agent.json')
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, pkg, errors: [] }
}

/** 取出可读文本文件（安装时写盘用）；二进制返回 Buffer */
export function readPackageFile(pkg: AgentPackage, path: string): string | Buffer | undefined {
  const file = pkg.files.find((f) => f.path === path)
  if (file === undefined) return undefined
  return file.encoding === 'base64' ? Buffer.from(file.data, 'base64') : file.data
}
