import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CHUNK_SIZE, MAX_FILE_SIZE, type FileInfo, type TargetType } from '../protocol.ts'
import type { HostRuntime } from './runtime.ts'
import { sanitizeFilename, sha256 } from './util.ts'
import type { WebSocket } from 'ws'

interface Upload {
  name: string
  size: number
  mime: string
  to: string
  toType: TargetType
  share: boolean
  chunks: Map<number, string>
}

interface IncomingFile {
  meta: any
  chunks: Map<number, string>
}

/**
 * 文件传输：客户端分片上传 → 本机落盘 + 节点间 base64 分片转发 → 接收校验落盘。
 */
export class FileTransfer {
  private readonly uploads = new Map<string, Upload>()
  private readonly incomingFiles = new Map<string, IncomingFile>()

  constructor(private readonly runtime: HostRuntime) {}

  handleStart(ws: WebSocket, msg: any): void {
    const size = Number(msg.size) || 0
    if (size <= 0 || size > MAX_FILE_SIZE) {
      this.runtime.clients.error(ws, '文件大小超出限制（≤ 20MB）')
      return
    }
    this.uploads.set(msg.uploadId, {
      name: String(msg.name ?? 'file'),
      size,
      mime: String(msg.mime ?? 'application/octet-stream'),
      to: String(msg.to ?? '*'),
      toType: msg.toType === 'account' ? 'account' : 'channel',
      share: msg.share === true,
      chunks: new Map(),
    })
  }

  handleChunk(msg: any): void {
    const up = this.uploads.get(msg.uploadId)
    if (up !== undefined) up.chunks.set(Number(msg.seq) || 0, String(msg.data ?? ''))
  }

  async handleEnd(ws: WebSocket, msg: any): Promise<void> {
    const up = this.uploads.get(msg.uploadId)
    if (up === undefined) return
    this.uploads.delete(msg.uploadId)
    try {
      const buf = Buffer.concat([...up.chunks.entries()].sort((a, b) => a[0] - b[0]).map(([, d]) => Buffer.from(d, 'base64')))
      if (up.share) {
        const channelId = this.runtime.channelRegistry.resolveTarget(up.to)
        await this.runtime.sharedFileStore.addOwned({
          name: up.name, size: buf.length, mime: up.mime, channelId,
        }, buf)
        return
      }
      const digest = sha256(buf)
      const id = randomUUID()
      const totalChunks = Math.ceil(buf.length / CHUNK_SIZE)
      const dir = this.runtime.storage.filesDir()
      await mkdir(dir, { recursive: true })
      const path = join(dir, `${id}-${sanitizeFilename(up.name)}`)
      await writeFile(path, buf)
      let channelId = up.to
      if (up.toType === 'channel') {
        channelId = this.runtime.channelRegistry.resolveTarget(up.to)
        if (!this.runtime.channelRegistry.canReceive(channelId)) throw new Error('无权向该频道发送文件')
      }
      const file: FileInfo = {
        id, from: this.runtime.self.accountId, fromName: this.runtime.self.name,
        to: channelId, toType: up.toType, name: up.name, size: buf.length, mime: up.mime,
        ts: Date.now(), path,
      }
      this.runtime.messageStore.addFile(file)
      void this.runtime.storage.appendHistory(file.ts, JSON.stringify({ event: 'file', ...file }) + '\n').catch(() => {})
      this.runtime.clients.file(file)
      const meta: any = {
        t: 'file', id, from: this.runtime.self.accountId, fromName: this.runtime.self.name,
        to: channelId, toType: up.toType, name: up.name, size: buf.length, mime: up.mime,
        sha256: digest, ts: file.ts, totalChunks,
      }
      const targets = up.toType === 'channel'
        ? this.peersForChannel(channelId)
        : this.runtime.peerNetwork.peersSnapshot().filter((p) => p.accountId === up.to)
      for (const peer of targets) {
        const ws = this.runtime.peerNetwork.openConnection(peer.nodeId)
        if (ws === undefined) {
          this.runtime.peerNetwork.ensurePeerConnection(peer.nodeId)
          continue
        }
        try { ws.send(JSON.stringify(meta)) } catch { /* 忽略 */ }
        for (let seq = 0; seq < totalChunks; seq++) {
          const slice = buf.subarray(seq * CHUNK_SIZE, (seq + 1) * CHUNK_SIZE)
          try { ws.send(JSON.stringify({ t: 'chunk', id, seq, data: slice.toString('base64') })) } catch { /* 忽略 */ }
        }
      }
      this.runtime.clients.logEvent(`已发送文件 ${up.name} (${(buf.length / 1024).toFixed(0)}KB)`)
    } catch (err: any) {
      this.runtime.clients.logEvent(`文件发送失败: ${err?.message ?? err}`)
    }
  }

  private peersForChannel(channelId: string): import('../protocol.ts').Peer[] {
    const audience = this.runtime.channelRegistry.audience(channelId)
    if (audience.includes('*')) return this.runtime.peerNetwork.peersSnapshot()
    const wanted = new Set(audience)
    return this.runtime.peerNetwork.peersSnapshot().filter((p) => wanted.has(p.accountId))
  }

  /** 节点间文件帧入口（由 PeerNetwork 分发）。 */
  handleIncomingWire(wire: any): void {
    if (wire.t === 'file') {
      this.incomingFiles.set(wire.id, { meta: wire, chunks: new Map() })
    } else if (wire.t === 'chunk') {
      const rec = this.incomingFiles.get(wire.id)
      if (rec !== undefined) rec.chunks.set(wire.seq, wire.data)
      if (rec !== undefined && rec.chunks.size >= rec.meta.totalChunks) void this.finishIncomingFile(wire.id)
    }
  }

  private async finishIncomingFile(id: string): Promise<void> {
    const rec = this.incomingFiles.get(id)
    if (rec === undefined) return
    this.incomingFiles.delete(id)
    try {
      const buf = Buffer.concat([...rec.chunks.entries()].sort((a, b) => a[0] - b[0]).map(([, d]) => Buffer.from(d, 'base64')))
      if (sha256(buf) !== rec.meta.sha256) {
        this.runtime.clients.logEvent(`文件 ${rec.meta.name} 校验失败`)
        return
      }
      const dir = this.runtime.storage.filesDir()
      await mkdir(dir, { recursive: true })
      const path = join(dir, `${id}-${sanitizeFilename(rec.meta.name)}`)
      await writeFile(path, buf)
      const file: FileInfo = {
        id, from: rec.meta.from, fromName: rec.meta.fromName,
        to: rec.meta.to, toType: rec.meta.toType,
        name: rec.meta.name, size: buf.length, mime: rec.meta.mime, ts: rec.meta.ts, path,
      }
      this.runtime.messageStore.addFile(file)
      void this.runtime.storage.appendHistory(file.ts, JSON.stringify({ event: 'file', ...file }) + '\n').catch(() => {})
      this.runtime.clients.file(file)
      this.runtime.clients.logEvent(`已接收文件 ${rec.meta.name}`)
    } catch (err: any) {
      this.runtime.clients.logEvent(`文件接收失败: ${err?.message ?? err}`)
    }
  }
}
