import { WebSocket, WebSocketServer } from 'ws'
import {
  PEER_TIMEOUT_MS, SWEEP_INTERVAL_MS,
  type ChatMessage, type Peer, type PeerSeed, type PeerWireMessage,
} from '../protocol.ts'
import type { HostRuntime } from './runtime.ts'
import { pskIdFor } from './util.ts'

/**
 * 节点间 WebSocket 网格：
 * - 入站：peerWss（临时端口）接收 hello，校验 nodeId/PSK。
 * - 出站：nodeId 字典序较小的一端主动连接，避免双连。
 * - pending：连接建立前暂存的 wire 帧；outbox 负责离线私聊补发。
 */
export class PeerNetwork {
  private readonly peers = new Map<string, Peer>()
  private readonly connections = new Map<string, WebSocket>()
  private readonly pending = new Map<string, string[]>()
  private peerWss: WebSocketServer | undefined
  private reconnectTimer: ReturnType<typeof setInterval> | undefined

  constructor(private readonly runtime: HostRuntime) {}

  peersSnapshot(): Peer[] { return [...this.peers.values()] }

  getPeer(nodeId: string): Peer | undefined { return this.peers.get(nodeId) }

  openConnection(nodeId: string): WebSocket | undefined {
    const ws = this.connections.get(nodeId)
    return ws !== undefined && ws.readyState === WebSocket.OPEN ? ws : undefined
  }

  /** 发现通道上线上报：PSK 过滤 + nodeId 去重 + 触发确定性连接。 */
  upsertPeer(seed: PeerSeed): void {
    if (seed.nodeId === this.runtime.self.nodeId) return
    if (seed.accountId === '' || !seed.ip || !seed.wsPort) return
    if (this.runtime.psk !== '' && seed.pskId !== pskIdFor(this.runtime.psk)) return
    const isNew = !this.peers.has(seed.nodeId)
    this.peers.set(seed.nodeId, {
      accountId: seed.accountId, name: seed.name || seed.accountId,
      nodeId: seed.nodeId, ip: seed.ip, wsPort: seed.wsPort, lastSeen: Date.now(),
    })
    if (isNew) {
      this.runtime.messageStore.pushSystem(`${seed.name || seed.accountId} 已上线`)
      this.runtime.clients.logEvent(`发现节点 ${seed.name || seed.accountId} @ ${seed.ip}:${seed.wsPort}`)
      this.runtime.clients.peers(this.peersSnapshot())
    }
    this.ensurePeerConnection(seed.nodeId)
  }

  private messageToWire(m: ChatMessage): PeerWireMessage {
    return { t: 'msg', id: m.id, from: m.from, fromName: m.fromName, to: m.to, toType: m.toType, body: m.body, ts: m.ts }
  }

  broadcastWire(wire: PeerWireMessage): void {
    for (const nodeId of this.peers.keys()) this.sendWire(nodeId, wire)
  }

  /** 按账号定向广播；accountIds 含 '*' 时发给全部在线节点。 */
  broadcastWireToAccounts(wire: PeerWireMessage, accountIds: string[]): void {
    if (accountIds.includes('*')) {
      this.broadcastWire(wire)
      return
    }
    const wanted = new Set(accountIds)
    for (const peer of this.peers.values()) {
      if (!wanted.has(peer.accountId)) continue
      const sent = this.sendWire(peer.nodeId, wire)
      if (!sent) this.ensurePeerConnection(peer.nodeId)
    }
  }

  /** 把用户输入解析为真实 accountId：支持输入显示名或大小写不一致的账号。 */
  resolveAccount(input: string): string {
    const text = String(input ?? '').trim()
    if (text === '') return ''
    const lower = text.toLowerCase()
    const peers = [...this.peers.values()]
    const exact = peers.find((p) => p.accountId === text)
    if (exact !== undefined) return exact.accountId
    const byAccount = peers.find((p) => p.accountId.toLowerCase() === lower)
    if (byAccount !== undefined) return byAccount.accountId
    const byName = peers.find((p) => p.name.toLowerCase() === lower)
    if (byName !== undefined) return byName.accountId
    return text
  }

  sendWire(nodeId: string, wire: PeerWireMessage): boolean {
    const frame = JSON.stringify(wire)
    const ws = this.connections.get(nodeId)
    if (ws !== undefined && ws.readyState === WebSocket.OPEN) {
      ws.send(frame)
      return true
    }
    const q = this.pending.get(nodeId) ?? []
    q.push(frame)
    if (q.length > 200) q.shift()
    this.pending.set(nodeId, q)
    return false
  }

  /** 把 outbox 中发给 accountId 的私聊，投递给该账号当前在线的所有设备。 */
  deliverToAccount(accountId: string): void {
    const list = this.runtime.outbox.list(accountId)
    if (list.length === 0) return
    const targets = [...this.peers.values()].filter((p) => p.accountId === accountId)
    if (targets.length === 0) {
      this.runtime.clients.logEvent(`私聊 ${accountId}：目标不在线，已入待发队列`)
      return
    }
    for (const peer of targets) {
      const ws = this.connections.get(peer.nodeId)
      if (ws !== undefined && ws.readyState === WebSocket.OPEN) {
        for (const m of list) ws.send(JSON.stringify(this.messageToWire(m)))
      } else {
        this.ensurePeerConnection(peer.nodeId)
      }
    }
  }

  private flushConnection(peer: Peer, ws: WebSocket): void {
    const q = this.pending.get(peer.nodeId) ?? []
    this.pending.delete(peer.nodeId)
    for (const frame of q) {
      try { ws.send(frame) } catch { /* 忽略 */ }
    }
    for (const m of this.runtime.outbox.list(peer.accountId)) {
      try { ws.send(JSON.stringify(this.messageToWire(m))) } catch { /* 忽略 */ }
    }
  }

  ensurePeerConnection(nodeId: string): void {
    if (this.runtime.stopped) return
    const peer = this.peers.get(nodeId)
    if (peer === undefined || !peer.ip || !peer.wsPort) return
    if (this.runtime.self.nodeId >= peer.nodeId) return
    const existing = this.connections.get(nodeId)
    if (existing !== undefined && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) return
    try {
      const ws = new WebSocket(`ws://${peer.ip}:${peer.wsPort}`)
      this.connections.set(nodeId, ws)
      ws.on('open', () => {
        if (this.runtime.stopped) { ws.close(); return }
        ws.send(JSON.stringify({
          t: 'hello',
          accountId: this.runtime.self.accountId,
          nodeId: this.runtime.self.nodeId,
          name: this.runtime.self.name,
          pskId: pskIdFor(this.runtime.psk),
          channels: this.runtime.channelRegistry.listForPeer(peer.accountId),
          sharedFiles: this.runtime.sharedFileStore.listForPeer(peer.accountId),
        }))
        this.flushConnection(peer, ws)
        this.runtime.clients.logEvent(`已连接 ${peer.name} (${peer.ip}:${peer.wsPort})`)
      })
      ws.on('message', (data) => this.handlePeerMessage(nodeId, data))
      ws.on('close', () => { if (this.connections.get(nodeId) === ws) this.connections.delete(nodeId) })
      ws.on('error', () => {})
    } catch (err: any) {
      this.runtime.clients.logEvent(`连接 ${peer.name} 失败: ${err?.message ?? err}`)
    }
  }

  startPeerServer(): Promise<number> {
    return new Promise((resolve) => {
      this.peerWss = new WebSocketServer({ host: '0.0.0.0', port: 0 })
      this.peerWss.on('listening', () => {
        const addr = this.peerWss?.address()
        resolve(typeof addr === 'object' && addr !== null ? addr.port : 0)
      })
      this.peerWss.on('error', (err: any) => {
        this.runtime.clients.logEvent(`对端 ws 服务错误: ${err?.code ?? err?.message ?? err}`)
        resolve(0)
      })
      this.peerWss.on('connection', (ws: WebSocket) => {
        let bound = false
        ws.once('message', (data) => {
          if (bound) return
          let hello: any
          try { hello = JSON.parse(String(data)) } catch { /* 忽略 */ }
          if (hello?.t !== 'hello' || typeof hello.nodeId !== 'string') { ws.close(); return }
          bound = true
          const nodeId = hello.nodeId
          if (nodeId === this.runtime.self.nodeId) { ws.close(); return }
          if (this.runtime.psk !== '' && hello.pskId !== pskIdFor(this.runtime.psk)) {
            ws.close()
            this.runtime.clients.logEvent('拒绝连接：PSK 不匹配')
            return
          }
          this.connections.set(nodeId, ws)
          const peer = this.peers.get(nodeId)
          if (peer !== undefined) {
            peer.lastSeen = Date.now()
            if (typeof hello.accountId === 'string' && hello.accountId !== '') peer.accountId = hello.accountId
            if (typeof hello.name === 'string' && hello.name !== '') peer.name = hello.name
            this.runtime.clients.peers(this.peersSnapshot())
            this.flushConnection(peer, ws)
          }
          if (this.runtime.channelRegistry.merge(hello.channels)) {
            void this.runtime.persistChannels()
            this.runtime.channelRegistry.notifyClients()
          }
          if (this.runtime.sharedFileStore.merge(hello.sharedFiles)) {
            this.runtime.sharedFileStore.notifyClients()
          }
          const peerAccount = typeof hello.accountId === 'string' ? hello.accountId : ''
          try {
            ws.send(JSON.stringify({
              t: 'channelsSync',
              channels: this.runtime.channelRegistry.listForPeer(peerAccount),
            }))
            ws.send(JSON.stringify({
              t: 'sharedFilesSync',
              files: this.runtime.sharedFileStore.listForPeer(peerAccount),
            }))
          } catch { /* 忽略 */ }
          ws.on('message', (d) => this.handlePeerMessage(nodeId, d))
          ws.on('close', () => { if (this.connections.get(nodeId) === ws) this.connections.delete(nodeId) })
          ws.on('error', () => {})
        })
        ws.on('error', () => {})
      })
    })
  }

  startSweep(): void {
    this.reconnectTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS)
  }

  stopSweep(): void {
    if (this.reconnectTimer !== undefined) clearInterval(this.reconnectTimer)
    this.reconnectTimer = undefined
  }

  sweep(): void {
    const now = Date.now()
    for (const [nodeId, peer] of this.peers) {
      const ws = this.connections.get(nodeId)
      if (ws !== undefined && ws.readyState === WebSocket.OPEN) {
        peer.lastSeen = now
        continue
      }
      if (now - peer.lastSeen > PEER_TIMEOUT_MS) {
        this.peers.delete(nodeId)
        try { ws?.close() } catch { /* 忽略 */ }
        this.connections.delete(nodeId)
        this.pending.delete(nodeId)
        this.runtime.messageStore.pushSystem(`${peer.name} 已离线`)
        this.runtime.clients.logEvent(`节点 ${peer.name} 已离线（连接丢失超过 ${Math.round(PEER_TIMEOUT_MS / 1000)}s）`)
        this.runtime.clients.peers(this.peersSnapshot())
        continue
      }
      this.ensurePeerConnection(nodeId)
    }
  }

  private handlePeerMessage(nodeId: string, data: unknown): void {
    let wire: any
    try { wire = JSON.parse(String(data)) } catch { return }
    if (wire.t === 'msg') {
      if (wire.from === this.runtime.self.accountId) return
      if (wire.toType === 'account' && wire.to !== this.runtime.self.accountId) return
      if (wire.toType === 'channel' && !this.runtime.channelRegistry.canReceive(String(wire.to ?? ''))) return
      if (wire.toType === 'account') {
        const conn = this.connections.get(nodeId)
        if (conn !== undefined && conn.readyState === WebSocket.OPEN) {
          try { conn.send(JSON.stringify({ t: 'ack', id: wire.id })) } catch { /* 忽略 */ }
        }
      }
      if (this.runtime.messageStore.has(wire.id)) return
      this.runtime.messageStore.push({
        id: wire.id, from: wire.from, fromName: wire.fromName,
        to: wire.to, toType: wire.toType === 'account' ? 'account' : 'channel',
        body: wire.body, ts: wire.ts, kind: 'text', local: false,
      })
      const peer = this.peers.get(nodeId)
      if (peer !== undefined) peer.lastSeen = Date.now()
      this.runtime.clients.logEvent(`收到 ${wire.fromName} 的${wire.toType === 'account' ? '私' : '频道'}消息`)
    } else if (wire.t === 'ack') {
      const peer = this.peers.get(nodeId)
      if (peer === undefined) return
      this.runtime.outbox.remove(peer.accountId, String(wire.id))
      this.runtime.messageStore.markDelivered(String(wire.id))
    } else if (wire.t === 'recall') {
      const m = this.runtime.messageStore.get(wire.id)
      if (m !== undefined && m.from === wire.from && !m.recalled) {
        m.recalled = true
        m.body = ''
        this.runtime.clients.message(m)
        this.runtime.messageStore.appendEvent({ event: 'recall', id: wire.id })
      }
    } else if (wire.t === 'edit') {
      const m = this.runtime.messageStore.get(wire.id)
      if (m !== undefined && m.from === wire.from) {
        m.body = wire.body
        m.edited = true
        this.runtime.clients.message(m)
        this.runtime.messageStore.appendEvent({ event: 'edit', id: wire.id, body: wire.body })
      }
    } else if (wire.t === 'file' || wire.t === 'chunk') {
      if (wire.t === 'file' && wire.toType === 'channel' && !this.runtime.channelRegistry.canReceive(String(wire.to ?? ''))) return
      this.runtime.fileTransfer.handleIncomingWire(wire)
    } else if (wire.t === 'channelAdd') {
      if (wire.channel && typeof wire.channel === 'object') this.runtime.channelRegistry.applyRemoteAdd(wire.channel)
      else if (typeof wire.id === 'string') this.runtime.channelRegistry.applyRemoteAdd({
        id: wire.id, name: String(wire.name ?? wire.id),
      } as any)
    } else if (wire.t === 'channelUpdate') {
      if (wire.channel && typeof wire.channel === 'object') this.runtime.channelRegistry.applyRemoteUpdate(wire.channel)
    } else if (wire.t === 'channelDelete') {
      this.runtime.channelRegistry.applyRemoteDelete(String(wire.id ?? ''))
    } else if (wire.t === 'channelMemberAdd') {
      this.runtime.channelRegistry.applyRemoteMemberAdd(String(wire.channelId ?? ''), String(wire.accountId ?? ''))
    } else if (wire.t === 'channelMemberRemove') {
      this.runtime.channelRegistry.applyRemoteMemberRemove(String(wire.channelId ?? ''), String(wire.accountId ?? ''))
    } else if (wire.t === 'channelsSync') {
      if (this.runtime.channelRegistry.merge(wire.channels)) {
        void this.runtime.persistChannels()
        this.runtime.channelRegistry.notifyClients()
      }
    } else if (wire.t === 'sharedFilesSync') {
      if (this.runtime.sharedFileStore.merge(wire.files)) this.runtime.sharedFileStore.notifyClients()
    } else if (wire.t === 'fileAdd' || wire.t === 'fileRemove' || wire.t === 'fileFetch' || wire.t === 'fileData') {
      this.runtime.sharedFileStore.handleIncomingWire(wire)
    }
  }

  /** setupPsk 等身份/安全配置变更后重置网格（pending 保留，原行为）。 */
  clearPeers(): void {
    this.peers.clear()
    for (const ws of this.connections.values()) {
      try { ws.close() } catch { /* 忽略 */ }
    }
    this.connections.clear()
  }

  stop(): void {
    this.stopSweep()
    try { this.peerWss?.close() } catch { /* 忽略 */ }
    this.peerWss = undefined
    for (const ws of this.connections.values()) {
      try { ws.close() } catch { /* 忽略 */ }
    }
    this.connections.clear()
    this.pending.clear()
  }
}
