import { WebSocket } from 'ws'
import type { Channel, ChatMessage, FileInfo, Peer, SelfInfo, SharedFile } from '../protocol.ts'

/**
 * 宿主 → 浏览器客户端的实时推送通道集合。
 * 只负责连接管理和事件广播，不解析任何业务协议。
 */
export class ClientHub {
  readonly log: string[] = []
  private readonly clients = new Set<WebSocket>()

  attach(ws: WebSocket): void {
    this.clients.add(ws)
  }

  detach(ws: WebSocket): void {
    this.clients.delete(ws)
  }

  send(ws: WebSocket, payload: unknown): void {
    try { ws.send(JSON.stringify(payload)) } catch { /* 忽略 */ }
  }

  error(ws: WebSocket, message: string): void {
    this.send(ws, { t: 'error', message })
  }

  private broadcast(payload: unknown): void {
    const data = JSON.stringify(payload)
    for (const c of this.clients) {
      if (c.readyState === WebSocket.OPEN) {
        try { c.send(data) } catch { /* 忽略 */ }
      }
    }
  }

  logEvent(text: string): void {
    const d = new Date()
    const p = (n: number): string => String(n).padStart(2, '0')
    this.log.push(`[${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}] ${text}`)
    while (this.log.length > 100) this.log.shift()
    this.broadcast({ t: 'log', log: this.log })
  }

  peers(peers: Peer[]): void { this.broadcast({ t: 'peers', peers }) }

  self(self: SelfInfo): void { this.broadcast({ t: 'self', self }) }

  message(message: ChatMessage): void { this.broadcast({ t: 'msg', message }) }

  channels(channels: Channel[]): void { this.broadcast({ t: 'channels', channels }) }

  file(file: FileInfo): void { this.broadcast({ t: 'file', file }) }

  sharedFiles(sharedFiles: SharedFile[]): void { this.broadcast({ t: 'sharedFiles', sharedFiles }) }

  searchResult(ws: WebSocket, keyword: unknown, results: ChatMessage[]): void {
    this.send(ws, { t: 'searchResult', keyword, results })
  }

  closeAll(): void {
    for (const c of this.clients) {
      try { c.close() } catch { /* 忽略 */ }
    }
    this.clients.clear()
  }
}
