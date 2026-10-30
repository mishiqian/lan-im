/**
 * Agent 安装：把校验过的包写进 DSH 的 preset 目录。
 *
 * 目录约定：`~/.dsh/.agent-presets/<账号>-<id>/`
 * 包里的 `preset.yml` 落盘时改名为 `agent.cordis.yml`（DSH 认这个名字）。
 *
 * 只写盘，不负责下载、不负责校验之外的信任判断——调用方必须先 verifyPackage。
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { packagePathProblem, verifyPackage, type AgentPackage } from './agent-package.ts'
import type { AgentRegistry, InstalledRecord } from './agent-registry.ts'

export interface InstallOptions {
  /** DSH 的 preset 根目录，通常是 ~/.dsh/.agent-presets */
  presetsDir: string
  registry: AgentRegistry
}

export interface InstallResult {
  ok: boolean
  errors: Array<{ field: string; message: string }>
  record?: InstalledRecord
}

export class AgentInstaller {
  constructor(private readonly opts: InstallOptions) {}

  /** 安装：校验 → 覆盖写 → 记账 */
  async install(raw: unknown): Promise<InstallResult> {
    const verified = verifyPackage(raw)
    if (!verified.ok || verified.pkg === undefined) {
      return { ok: false, errors: verified.errors }
    }
    const pkg: AgentPackage = verified.pkg
    const card = pkg.card

    const preset = pkg.files.find((f) => f.path === 'preset.yml')
    if (preset === undefined) {
      return { ok: false, errors: [{ field: 'files', message: '包里缺少 preset.yml，装上去也不会出现在 preset 列表里' }] }
    }

    for (const file of pkg.files) {
      const problem = packagePathProblem(file.path)
      if (problem !== undefined) return { ok: false, errors: [{ field: `files.${file.path}`, message: problem }] }
    }

    const dirName = `${card.author.accountId}-${card.id}`
    const target = join(this.opts.presetsDir, dirName)
    await rm(target, { recursive: true, force: true })

    for (const file of pkg.files) {
      const rel = file.path === 'preset.yml' ? 'agent.cordis.yml' : file.path
      const abs = join(target, rel)
      await mkdir(dirname(abs), { recursive: true })
      const data = file.encoding === 'base64' ? Buffer.from(file.data, 'base64') : file.data
      await writeFile(abs, data)
    }

    const record: InstalledRecord = {
      account: card.author.accountId,
      id: card.id,
      version: card.version,
      name: card.name,
      dir: target,
      sha256: pkg.integrity.pkg,
      installedAt: Date.now(),
    }
    await this.opts.registry.markInstalled(record)
    return { ok: true, errors: [], record }
  }

  /** 卸载：删目录 + 去掉记账；不碰别人的东西 */
  async uninstall(account: string, id: string): Promise<boolean> {
    const record = this.opts.registry.installedRecord(account, id)
    if (record === undefined) return false
    await rm(record.dir, { recursive: true, force: true })
    await this.opts.registry.markUninstalled(account, id)
    return true
  }
}
