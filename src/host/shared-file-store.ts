import { randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { CHUNK_SIZE, MAX_FILE_SIZE, type SharedFile } from '../protocol.ts'
import type { HostRuntime } from './runtime.ts'
import { sha256 } from './util.ts'

interface PendingFetch {
  file: SharedFile
  chunks: Map<number, string>
  promise?: Promise<string>
  resolve: (path: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * 频道共享文件空间（局域网网盘 v2）：
 * - owner 持有物理文件并广播 SharedFile 索引。
 * - 其他节点按需 fileFetch → fileData 分片拉取并缓存。
 * - 索引本地持久化，重启后不丢。
 */
export class SharedFileStore {
  private readonly files = new Map<string, SharedFile>()
  private readonly pending = new Map<string, PendingFetch>()

  constructor(private readonly runtime: HostRuntime) {}

  async load(): Promise<void> {
    const list = await this.runtime.storage.readSharedIndex()
    for (const raw of list) {
      const file = this.normalize(raw)
      if (file !== null && this.visibleToSelf(file)) this.files.set(file.id, file)
    }
  }

  private normalize(raw: any): SharedFile | null {
    if (!raw || typeof raw.id !== 'string' || typeof raw.ownerNodeId !== 'string' || typeof raw.channelId !== 'string') return null
    return {
      id: raw.id,
      name: typeof raw.name === 'string' ? raw.name : 'file',
      size: Number(raw.size) || 0,
      mime: typeof raw.mime === 'string' ? raw.mime : 'application/octet-stream',
      ownerNodeId: raw.ownerNodeId,
      ownerAccount: typeof raw.ownerAccount === 'string' ? raw.ownerAccount : '',
      channelId: raw.channelId,
      uploadedAt: Number(raw.uploadedAt) || Date.now(),
      sha256: typeof raw.sha256 === 'string' ? raw.sha256 : '',
    }
  }

  private visibleToSelf(file: SharedFile): boolean {
    return this.runtime.channelRegistry.canReceive(file.channelId)
  }

  /** 当前账号可见的全部索引。 */
  list(): SharedFile[] {
    return [...this.files.values()].filter((f) => this.visibleToSelf(f)).sort((a, b) => a.uploadedAt - b.uploadedAt)
  }

  listForChannel(channelId: string): SharedFile[] {
    return this.list().filter((f) => f.channelId === channelId)
  }

  listForPeer(accountId: string): SharedFile[] {
    return [...this.files.values()]
      .filter((f) => this.visibleToSelf(f))
      .filter((f) => this.runtime.channelRegistry.isVisibleToAccount(f.channelId, accountId))
      .sort((a, b) => a.uploadedAt - b.uploadedAt)
  }

  get(id: string): SharedFile | undefined { return this.files.get(id) }

  private async persist(): Promise<void> {
    await this.runtime.storage.writeSharedIndex([...this.files.values()])
  }

  notifyClients(): void {
    this.runtime.clients.sharedFiles(this.list())
  }

  /** 上传完成：写入 owner 物理文件、创建索引并广播。 */
  async addOwned(input: {
    name: string
    size: number
    mime: string
    channelId: string
  }, buf: Buffer): Promise<SharedFile> {
    if (buf.length === 0 || buf.length > MAX_FILE_SIZE) throw new Error('文件大小超出限制（≤ 20MB）')
    if (this.runtime.self.accountId === '') throw new Error('请先设置账号，再上传共享文件')
    if (!this.runtime.channelRegistry.canReceive(input.channelId)) throw new Error('无权向该频道上传文件')
    const file: SharedFile = {
      id: randomUUID(),
      name: input.name,
      size: buf.length,
      mime: input.mime,
      ownerNodeId: this.runtime.self.nodeId,
      ownerAccount: this.runtime.self.accountId,
      channelId: input.channelId,
      uploadedAt: Date.now(),
      sha256: sha256(buf),
    }
    const path = this.runtime.storage.sharedUploadPath(file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, buf)
    this.files.set(file.id, file)
    await this.persist()
    this.notifyClients()
    this.broadcast({ t: 'fileAdd', file }, file)
    this.runtime.clients.logEvent(`已上传共享文件 ${file.name} (${(file.size / 1024).toFixed(0)}KB)`)
    return file
  }

  /** 上传者删除：删索引 + 广播，所有节点清本地缓存。 */
  async remove(id: string): Promise<void> {
    const file = this.files.get(id)
    if (file === undefined) throw new Error('文件不存在')
    if (file.ownerAccount !== this.runtime.self.accountId && file.ownerNodeId !== this.runtime.self.nodeId) {
      throw new Error('只有上传者可以删除共享文件')
    }
    this.deleteLocalCopy(file)
    this.files.delete(id)
    await this.persist()
    this.notifyClients()
    this.broadcast({ t: 'fileRemove', id, channelId: file.channelId }, file)
    this.runtime.clients.logEvent(`已删除共享文件 ${file.name}`)
  }

  /** 频道解散后清理该频道索引与本地副本。 */
  async removeByChannel(channelId: string): Promise<void> {
    const targets = [...this.files.values()].filter((f) => f.channelId === channelId)
    for (const file of targets) {
      this.deleteLocalCopy(file)
      this.files.delete(file.id)
    }
    if (targets.length > 0) {
      await this.persist()
      this.notifyClients()
    }
  }

  private async deleteLocalCopy(file: SharedFile): Promise<void> {
    for (const path of [this.runtime.storage.sharedUploadPath(file), this.runtime.storage.sharedCachePath(file)]) {
      try { await unlink(path) } catch { /* 不存在 */ }
    }
  }

  private broadcast(wire: any, file: SharedFile): void {
    const audience = this.runtime.channelRegistry.audience(file.channelId)
    if (audience.length === 0) return
    this.runtime.peerNetwork.broadcastWireToAccounts(wire, audience)
  }

  // ── 节点间索引/拉取协议 ────────────────────────────────────────────────────

  merge(files: SharedFile[]): boolean {
    let changed = false
    for (const raw of Array.isArray(files) ? files : []) {
      const incoming = this.normalize(raw)
      if (incoming === null || !this.visibleToSelf(incoming)) continue
      const existing = this.files.get(incoming.id)
      if (existing === undefined) {
        this.files.set(incoming.id, incoming)
        changed = true
      } else if (JSON.stringify(existing) !== JSON.stringify(incoming)) {
        this.files.set(incoming.id, incoming)
        changed = true
      }
    }
    if (changed) {
      void this.persist().catch(() => {})
      this.notifyClients()
    }
    return changed
  }

  handleIncomingWire(wire: any): void {
    if (wire.t === 'fileAdd') {
      this.merge([wire.file])
    } else if (wire.t === 'fileRemove') {
      const file = this.files.get(wire.id)
      if (file === undefined) return
      void this.deleteLocalCopy(file)
      this.files.delete(wire.id)
      void this.persist().catch(() => {})
      this.notifyClients()
    } else if (wire.t === 'fileFetch') {
      void this.serveFetch(wire)
    } else if (wire.t === 'fileData') {
      this.receiveChunk(wire)
    }
  }

  private async serveFetch(wire: any): Promise<void> {
    const file = this.files.get(wire.id)
    if (file === undefined || file.ownerNodeId !== this.runtime.self.nodeId) return
    if (!this.runtime.channelRegistry.isVisibleToAccount(file.channelId, wire.requesterAccountId)) return
    try {
      const buf = await readFile(this.runtime.storage.sharedUploadPath(file))
      const totalChunks = Math.ceil(buf.length / CHUNK_SIZE)
      for (let seq = 0; seq < totalChunks; seq++) {
        const slice = buf.subarray(seq * CHUNK_SIZE, (seq + 1) * CHUNK_SIZE)
        this.runtime.peerNetwork.sendWire(wire.requesterNodeId, {
          t: 'fileData', id: file.id, name: file.name, mime: file.mime, size: file.size,
          sha256: file.sha256, totalChunks, seq, data: slice.toString('base64'),
        })
      }
      this.runtime.clients.logEvent(`已向 ${wire.requesterAccountId || wire.requesterNodeId} 提供共享文件 ${file.name}`)
    } catch (err: any) {
      this.runtime.clients.logEvent(`共享文件提供失败: ${err?.message ?? err}`)
    }
  }

  /** 按需拉取并返回本地路径（owner 直接返回 owner 路径，其他节点优先缓存）。 */
  async ensureLocal(id: string, timeoutMs = 30000): Promise<string> {
    const file = this.files.get(id)
    if (file === undefined) throw new Error('共享文件不存在')
    if (file.ownerNodeId === this.runtime.self.nodeId) {
      const path = this.runtime.storage.sharedUploadPath(file)
      await this.assertExists(path)
      return path
    }
    const cachePath = this.runtime.storage.sharedCachePath(file)
    try {
      await stat(cachePath)
      return cachePath
    } catch { /* 需要拉取 */ }
    const existing = this.pending.get(id)
    if (existing !== undefined) return existing.promise

    const chunks = new Map<number, string>()
    let entry!: PendingFetch
    const promise = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`拉取共享文件 ${file.name} 超时（owner 可能离线）`))
      }, timeoutMs)
      entry = { file, chunks, resolve, reject, timer }
      this.pending.set(id, entry)
      this.triggerFetch(file, id)
    })
    entry.promise = promise
    return promise
  }

  private triggerFetch(file: SharedFile, id: string): void {
    const target = this.runtime.peerNetwork.openConnection(file.ownerNodeId)
    if (target !== undefined) {
      this.sendFetch(id)
      return
    }
    this.runtime.peerNetwork.ensurePeerConnection(file.ownerNodeId)
    const waitUntil = Date.now() + 8000
    const iv = setInterval(() => {
      const ws = this.runtime.peerNetwork.openConnection(file.ownerNodeId)
      if (ws !== undefined) {
        clearInterval(iv)
        this.sendFetch(id)
      } else if (Date.now() > waitUntil) {
        clearInterval(iv)
        this.failFetch(id, new Error(`共享文件 owner 离线：${file.ownerAccount || file.ownerNodeId}`))
      }
    }, 250)
  }

  private sendFetch(id: string): void {
    const rec = this.pending.get(id)
    if (rec === undefined) return
    const file = rec.file
    this.runtime.peerNetwork.sendWire(file.ownerNodeId, {
      t: 'fileFetch', id,
      requesterAccountId: this.runtime.self.accountId,
      requesterNodeId: this.runtime.self.nodeId,
    })
  }

  private receiveChunk(wire: any): void {
    const rec = this.pending.get(wire.id)
    if (rec === undefined) return
    rec.chunks.set(Number(wire.seq) || 0, String(wire.data ?? ''))
    if (rec.chunks.size < Number(wire.totalChunks) || 0) return
    void this.finishFetch(rec, wire).catch((err: any) => this.failFetch(wire.id, err))
  }

  private async finishFetch(rec: PendingFetch, wire: any): Promise<void> {
    clearTimeout(rec.timer)
    this.pending.delete(wire.id)
    const buf = Buffer.concat([...rec.chunks.entries()].sort((a, b) => a[0] - b[0]).map(([, d]) => Buffer.from(d, 'base64')))
    if (buf.length !== rec.file.size || sha256(buf) !== rec.file.sha256) {
      rec.reject(new Error(`共享文件 ${rec.file.name} 校验失败`))
      return
    }
    const path = this.runtime.storage.sharedCachePath(rec.file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, buf)
    rec.resolve(path)
  }

  private failFetch(id: string, err: Error): void {
    const rec = this.pending.get(id)
    if (rec === undefined) return
    clearTimeout(rec.timer)
    this.pending.delete(id)
    rec.reject(err)
  }

  private async assertExists(path: string): Promise<void> {
    await stat(path)
  }
}
