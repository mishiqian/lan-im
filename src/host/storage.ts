import { appendFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { sanitizeFilename } from './util.ts'
import type { Account, Channel, SharedFile } from '../protocol.ts'

/**
 * 当前实例所属的 profile 名字。
 * 数据必须按 profile 隔离：同一台机器上 web / desktop 两个 profile 各跑一个实例时，
 * 共用一个 nodeId 会互相顶掉 mDNS 广播（Service name is already in use）、账号也会串。
 */
let profileKey: string | undefined

function parseProfileFromBaseUrl(baseUrl: string): string | undefined {
  try {
    const path = baseUrl.startsWith('file:') ? new URL(baseUrl).pathname : baseUrl
    const m = /\/profiles\/([^/]+)\/?$/.exec(decodeURIComponent(path))
    return m?.[1]
  } catch {
    return undefined
  }
}

/** 从环境变量 / Loader 的 baseUrl / cwd 里尽力认出 profile 名；认不出就不隔离（保持老行为）。 */
export function resolveProfileKey(ctx?: unknown): string | undefined {
  // 宿主自带的 profileContext 最准：name 是 profile 名，dir 是它的目录
  try {
    const pc = (ctx as { get?: (name: string) => unknown } | undefined)?.get?.('profileContext') as
      | { name?: unknown; dir?: unknown }
      | undefined
    if (pc !== undefined && typeof pc.dir === 'string' && pc.dir !== '') return basename(pc.dir)
    if (pc !== undefined && typeof pc.name === 'string' && pc.name !== '') return pc.name
  } catch { /* 没这个服务就继续往下猜 */ }
  const dir = process.env.DSH_PROFILE_DIR
  if (dir !== undefined && dir !== '') return basename(dir)
  const name = process.env.DSH_PROFILE
  if (name !== undefined && name !== '') return name
  const baseUrl = (ctx as { loader?: { baseUrl?: string } } | undefined)?.loader?.baseUrl
  if (typeof baseUrl === 'string') {
    const fromLoader = parseProfileFromBaseUrl(baseUrl)
    if (fromLoader !== undefined) return fromLoader
  }
  const fromCwd = parseProfileFromBaseUrl(process.cwd())
  if (fromCwd !== undefined) return fromCwd
  return undefined
}

export function setProfileKey(key: string | undefined): void {
  profileKey = key
}

export interface StoredConfig {
  nodeId?: string
  account?: Account
  psk?: string
  channels?: Channel[]
  hiddenChannels?: string[]
  /** 通信枢纽：配了才启用（M1 全部经枢纽） */
  hub?: { url: string; invite?: string }
  /** LEP 发送序列号：必须持久化，否则接收方判重失效（PROTOCOL.md §4.2） */
  hubSeq?: number
}

/**
 * lan-im 数据目录与磁盘 IO。
 * 所有持久化统一收敛到这里：配置、按天历史、outbox、接收文件目录。
 */
export class Storage {
  /** 未识别到 profile 时的历史目录（保持兼容）。 */
  private legacyRoot(): string {
    const base = process.env.DSH_HOME && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
    return join(base, 'plugins-data', 'lan-im')
  }

  private base(): string {
    if (profileKey === undefined) return this.legacyRoot()
    return join(this.legacyRoot(), 'profiles', sanitizeFilename(profileKey))
  }

  /** 首次按 profile 隔离时，把老目录里的账号/历史搬进当前 profile，避免用户以为数据丢了。 */
  async adoptLegacyData(): Promise<void> {
    if (profileKey === undefined) return
    const dir = this.dataDir()
    if (existsSync(dir)) return
    const legacy = this.legacyRoot()
    if (!existsSync(join(legacy, 'config.json'))) return
    await mkdir(dir, { recursive: true })
    for (const entry of await readdir(legacy)) {
      if (entry === 'profiles') continue
      try { await rename(join(legacy, entry), join(dir, entry)) } catch { /* 搬不动的跳过 */ }
    }
  }

  dataDir(): string { return this.base() }

  filesDir(): string { return join(this.dataDir(), 'files') }

  configPath(): string { return join(this.dataDir(), 'config.json') }

  legacyHistoryPath(): string { return join(this.dataDir(), 'history.jsonl') }

  historyDir(): string { return join(this.dataDir(), 'history') }

  historyFileFor(ts: number): string {
    const d = new Date(ts)
    const p = (n: number): string => String(n).padStart(2, '0')
    return join(this.historyDir(), `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.jsonl`)
  }

  outboxDir(): string { return join(this.dataDir(), 'outbox') }

  outboxFile(accountId: string): string { return join(this.outboxDir(), `${accountId}.jsonl`) }

  sharedIndexPath(): string { return join(this.dataDir(), 'shared-files.json') }

  async ensureDataDir(): Promise<void> {
    await mkdir(this.dataDir(), { recursive: true })
  }

  async readConfig(): Promise<StoredConfig> {
    try {
      return JSON.parse(await readFile(this.configPath(), 'utf8')) as StoredConfig
    } catch {
      return {}
    }
  }

  async writeConfig(config: StoredConfig): Promise<void> {
    await mkdir(this.dataDir(), { recursive: true })
    // 覆盖前留一版：账号被写空的极端情况下还能恢复
    try {
      const previous = await readFile(this.configPath(), 'utf8')
      await writeFile(this.configPath() + '.prev', previous, 'utf8')
    } catch { /* 首次写入没有旧文件 */ }
    await writeFile(this.configPath(), JSON.stringify(config, null, 2), 'utf8')
  }

  /** 读上一版配置（恢复用） */
  async readPreviousConfig(): Promise<StoredConfig> {
    try {
      return JSON.parse(await readFile(this.configPath() + '.prev', 'utf8')) as StoredConfig
    } catch {
      return {}
    }
  }

  async appendHistory(ts: number, line: string): Promise<void> {
    await mkdir(this.historyDir(), { recursive: true })
    await appendFile(this.historyFileFor(ts), line, 'utf8')
  }

  async readLegacyHistory(): Promise<string> {
    try {
      return await readFile(this.legacyHistoryPath(), 'utf8')
    } catch {
      return ''
    }
  }

  /** 返回按天历史文件内容，文件名字典序即时间序。 */
  async readDailyHistory(): Promise<string[]> {
    try {
      const names = (await readdir(this.historyDir())).filter((f) => f.endsWith('.jsonl')).sort()
      const result: string[] = []
      for (const name of names) {
        try {
          result.push(await readFile(join(this.historyDir(), name), 'utf8'))
        } catch { /* 忽略损坏文件 */ }
      }
      return result
    } catch {
      return []
    }
  }

  async readOutboxFiles(): Promise<Array<{ accountId: string; text: string }>> {
    try {
      const entries = await readdir(this.outboxDir())
      const result: Array<{ accountId: string; text: string }> = []
      for (const file of entries) {
        if (!file.endsWith('.jsonl')) continue
        const accountId = file.slice(0, -'.jsonl'.length)
        try {
          result.push({ accountId, text: await readFile(join(this.outboxDir(), file), 'utf8') })
        } catch { /* 忽略 */ }
      }
      return result
    } catch {
      return []
    }
  }

  async writeOutbox(accountId: string, lines: string[]): Promise<void> {
    await mkdir(this.outboxDir(), { recursive: true })
    await writeFile(this.outboxFile(accountId), lines.join('\n') + (lines.length > 0 ? '\n' : ''), 'utf8')
  }

  async readSharedIndex(): Promise<SharedFile[]> {
    try {
      const data = JSON.parse(await readFile(this.sharedIndexPath(), 'utf8')) as SharedFile[]
      return Array.isArray(data) ? data : []
    } catch {
      return []
    }
  }

  async writeSharedIndex(files: SharedFile[]): Promise<void> {
    await mkdir(this.dataDir(), { recursive: true })
    await writeFile(this.sharedIndexPath(), JSON.stringify(files, null, 2), 'utf8')
  }

  sharedUploadPath(file: SharedFile): string { return join(this.filesDir(), 'shared', `${file.id}-${sanitizeFilename(file.name)}`) }

  sharedCachePath(file: SharedFile): string { return join(this.filesDir(), 'cache', `${file.id}-${sanitizeFilename(file.name)}`) }
}
