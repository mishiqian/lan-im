import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { sanitizeFilename } from './util.ts'
import type { Account, Channel, SharedFile } from '../protocol.ts'

export interface StoredConfig {
  nodeId?: string
  account?: Account
  psk?: string
  channels?: Channel[]
  hiddenChannels?: string[]
}

/**
 * lan-im 数据目录与磁盘 IO。
 * 所有持久化统一收敛到这里：配置、按天历史、outbox、接收文件目录。
 */
export class Storage {
  private base(): string {
    const base = process.env.DSH_HOME && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
    return join(base, 'plugins-data', 'lan-im')
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
    await writeFile(this.configPath(), JSON.stringify(config, null, 2), 'utf8')
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
