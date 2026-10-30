/**
 * Agent 目录：我发布的 + 局域网里发现的。
 *
 * 职责边界：
 * - 只做「存 / 查 / 去重 / 落盘 / 打包」，不碰 DSH 服务，也不主动发网络帧；
 *   广播与请求由 runtime 通过回调接出去（便于单测）。
 * - 去重键 = `作者账号/id`；同 key 保留高版本，低版本忽略。
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { verifyCard, type AgentCard } from './agent-card.ts'
import { createPackage, verifyPackage, type AgentPackage } from './agent-package.ts'
import type { AgentEntry } from '../protocol.ts'

/** semver 粗略比较：主次修订 + 预发布低于正式版 */
export function compareVersion(a: string, b: string): number {
  const [coreA, preA] = a.split('-', 2)
  const [coreB, preB] = b.split('-', 2)
  const pa = coreA.split('.').map((n) => Number(n) || 0)
  const pb = coreB.split('.').map((n) => Number(n) || 0)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  if (preA !== undefined && preB === undefined) return -1
  if (preA === undefined && preB !== undefined) return 1
  return 0
}

export interface InstalledRecord {
  account: string
  id: string
  version: string
  name: string
  dir: string
  sha256: string
  installedAt: number
}

export interface RegistryOptions {
  dir: string
  selfAccount: () => string
  /** 新发布时通知外部（runtime 负责广播） */
  onPublish?: (card: AgentCard) => void
}

const keyOf = (account: string, id: string): string => `${account}/${id}`

export class AgentRegistry {
  /** 我发布的：id → 卡片 */
  private readonly mine = new Map<string, AgentCard>()
  /** 别人的：`account/id` → 卡片 */
  private readonly remote = new Map<string, AgentCard>()
  private readonly installed = new Map<string, InstalledRecord>()
  private readonly packages = new Map<string, AgentPackage>()

  constructor(private readonly opts: RegistryOptions) {}

  private publishedDir(): string { return join(this.opts.dir, 'published') }
  private peersDir(): string { return join(this.opts.dir, 'peers') }
  private installedPath(): string { return join(this.opts.dir, 'installed.json') }

  async load(): Promise<void> {
    await mkdir(this.publishedDir(), { recursive: true })
    await mkdir(this.peersDir(), { recursive: true })

    for (const id of await this.listDirs(this.publishedDir())) {
      const card = await this.readJson<AgentCard>(join(this.publishedDir(), id, 'agent.json'))
      if (card && verifyCard(card)) this.mine.set(card.id, card)
    }
    for (const account of await this.listDirs(this.peersDir())) {
      for (const file of await this.listFiles(join(this.peersDir(), account))) {
        if (!file.endsWith('.json')) continue
        const card = await this.readJson<AgentCard>(join(this.peersDir(), account, file))
        if (card && verifyCard(card)) this.remote.set(keyOf(card.author.accountId, card.id), card)
      }
    }
    const records = await this.readJson<InstalledRecord[]>(this.installedPath())
    for (const record of records ?? []) this.installed.set(keyOf(record.account, record.id), record)
  }

  /** 我发布的 agent（用于「我的」列表） */
  myAgents(): AgentCard[] {
    return [...this.mine.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  /** 当前可见的全部条目：我的 + 别人的 */
  list(): AgentEntry[] {
    const self = this.opts.selfAccount()
    const rows: AgentEntry[] = []
    for (const card of this.mine.values()) {
      rows.push({ card, source: 'mine', installed: true, installedVersion: card.version })
    }
    for (const card of this.remote.values()) {
      if (card.author.accountId === self) continue
      const rec = this.installed.get(keyOf(card.author.accountId, card.id))
      rows.push({ card, source: 'peer', installed: rec !== undefined, ...(rec !== undefined ? { installedVersion: rec.version } : {}) })
    }
    return rows.sort((a, b) => {
      if (a.source !== b.source) return a.source === 'mine' ? -1 : 1
      return b.card.version.localeCompare(a.card.version)
    })
  }

  /** 发布：校验 → 封存 → 落盘包与卡片 → 回调广播 */
  async publish(rawCard: unknown, files: Array<{ path: string; encoding: 'utf8' | 'base64'; data: string }>): Promise<{ ok: boolean; errors: Array<{ field: string; message: string }>; card?: AgentCard }> {
    const pkgResult = createPackage(rawCard, files)
    if (!pkgResult.ok) return { ok: false, errors: pkgResult.errors }
    const pkg = pkgResult.pkg
    const card = pkg.card

    const dir = join(this.publishedDir(), card.id)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'agent.json'), `${JSON.stringify(card, null, 2)}\n`, 'utf8')
    await writeFile(join(dir, 'package.agentpkg.json'), `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')

    this.mine.set(card.id, card)
    this.packages.set(card.id, pkg)
    this.opts.onPublish?.(card)
    return { ok: true, errors: [], card }
  }

  async unpublish(id: string): Promise<boolean> {
    if (!this.mine.delete(id)) return false
    this.packages.delete(id)
    await rm(join(this.publishedDir(), id), { recursive: true, force: true })
    return true
  }

  /** 收到别人的卡片：验哈希、按版本去重 */
  upsertRemote(raw: unknown): boolean {
    const card = raw as AgentCard
    if (!verifyCard(card)) return false
    if (card.author.accountId === this.opts.selfAccount()) return false
    const key = keyOf(card.author.accountId, card.id)
    const existing = this.remote.get(key)
    if (existing !== undefined && compareVersion(card.version, existing.version) <= 0) return false
    this.remote.set(key, card)
    void this.persistRemote(card)
    return true
  }

  /** 我发布的包（用于响应别人的拉取请求） */
  packageFor(id: string): AgentPackage | undefined {
    return this.packages.get(id)
  }

  async loadPackage(id: string): Promise<AgentPackage | undefined> {
    const cached = this.packages.get(id)
    if (cached !== undefined) return cached
    const raw = await this.readJson<unknown>(join(this.publishedDir(), id, 'package.agentpkg.json'))
    if (raw === undefined) return undefined
    const result = verifyPackage(raw)
    if (!result.ok || result.pkg === undefined) return undefined
    this.packages.set(id, result.pkg)
    return result.pkg
  }

  /** 别人发布、我可见的卡片（用于请求包） */
  remoteCard(account: string, id: string): AgentCard | undefined {
    return this.remote.get(keyOf(account, id))
  }

  installedRecord(account: string, id: string): InstalledRecord | undefined {
    return this.installed.get(keyOf(account, id))
  }

  installedList(): InstalledRecord[] {
    return [...this.installed.values()]
  }

  async markInstalled(record: InstalledRecord): Promise<void> {
    await mkdir(this.opts.dir, { recursive: true })
    this.installed.set(keyOf(record.account, record.id), record)
    await writeFile(this.installedPath(), `${JSON.stringify([...this.installed.values()], null, 2)}\n`, 'utf8')
  }

  async markUninstalled(account: string, id: string): Promise<void> {
    this.installed.delete(keyOf(account, id))
    await writeFile(this.installedPath(), `${JSON.stringify([...this.installed.values()], null, 2)}\n`, 'utf8')
  }

  private async persistRemote(card: AgentCard): Promise<void> {
    const dir = join(this.peersDir(), card.author.accountId)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${card.id}.json`), `${JSON.stringify(card, null, 2)}\n`, 'utf8')
  }

  private async listDirs(dir: string): Promise<string[]> {
    if (!existsSync(dir)) return []
    const items = await readdir(dir, { withFileTypes: true })
    return items.filter((d) => d.isDirectory()).map((d) => d.name)
  }

  private async listFiles(dir: string): Promise<string[]> {
    if (!existsSync(dir)) return []
    const items = await readdir(dir, { withFileTypes: true })
    return items.filter((d) => d.isFile()).map((d) => d.name)
  }

  private async readJson<T>(path: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as T
    } catch {
      return undefined
    }
  }
}
