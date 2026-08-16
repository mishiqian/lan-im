import { randomUUID } from 'node:crypto'
import { RECALL_WINDOW_MS, type ChatMessage, type PeerWireMessage, type TargetType } from '../protocol.ts'
import type { HostRuntime } from './runtime.ts'

export function messageToWire(m: ChatMessage): PeerWireMessage {
  return { t: 'msg', id: m.id, from: m.from, fromName: m.fromName, to: m.to, toType: m.toType, body: m.body, ts: m.ts }
}

/**
 * 发送 / 撤回 / 编辑消息。
 * - 频道：本机落盘 + 尽力广播（不 ack）。
 * - 私聊：本机落盘 + outbox 至少一次投递 + ack 送达确认。
 */
export class Messaging {
  constructor(private readonly runtime: HostRuntime) {}

  sendMessage(to: string, toType: TargetType, body: string): ChatMessage {
    const text = String(body ?? '').trim()
    if (text === '') throw new Error('消息内容不能为空')
    const message: ChatMessage = {
      id: randomUUID(), from: this.runtime.self.accountId, fromName: this.runtime.self.name,
      to, toType, body: text, ts: Date.now(), kind: 'text', local: true,
    }
    if (toType === 'channel') {
      const channelId = this.runtime.channelRegistry.resolveTarget(to)
      if (!this.runtime.channelRegistry.canReceive(channelId)) throw new Error('无权向该频道发送消息')
      message.to = channelId
      this.runtime.messageStore.push(message)
      const audience = this.runtime.channelRegistry.audience(channelId)
      this.runtime.peerNetwork.broadcastWireToAccounts(messageToWire(message), audience)
      this.runtime.channelRegistry.notifyClients()
      this.runtime.clients.logEvent(`发送频道消息 → ${audience.includes('*') ? this.runtime.peerNetwork.peersSnapshot().length : audience.length} 个账号`)
    } else {
      message.status = 'sent'
      this.runtime.messageStore.push(message)
      this.runtime.outbox.add(message)
      this.runtime.peerNetwork.deliverToAccount(to)
    }
    return message
  }

  recallMessage(id: string): void {
    const m = this.runtime.messageStore.get(id)
    if (m === undefined || !m.local || m.from !== this.runtime.self.accountId || m.kind !== 'text') return
    if (m.recalled) return
    if (Date.now() - m.ts > RECALL_WINDOW_MS) {
      this.runtime.clients.logEvent('撤回超时（限 2 分钟）')
      return
    }
    m.recalled = true
    m.body = ''
    this.runtime.clients.message(m)
    this.runtime.messageStore.appendEvent({ event: 'recall', id })
    this.broadcastToMessageTarget(m, { t: 'recall', id, from: this.runtime.self.accountId })
    this.runtime.clients.logEvent('已撤回一条消息')
  }

  private broadcastToMessageTarget(m: ChatMessage, wire: PeerWireMessage): void {
    if (m.toType === 'account') {
      this.runtime.peerNetwork.broadcastWire(wire)
      return
    }
    const audience = this.runtime.channelRegistry.audience(m.to)
    this.runtime.peerNetwork.broadcastWireToAccounts(wire, audience)
  }

  editMessage(id: string, body: string): void {
    const text = String(body ?? '').trim()
    if (text === '') return
    const m = this.runtime.messageStore.get(id)
    if (m === undefined || !m.local || m.from !== this.runtime.self.accountId || m.kind !== 'text') return
    if (m.recalled) return
    m.body = text
    m.edited = true
    this.runtime.clients.message(m)
    this.runtime.messageStore.appendEvent({ event: 'edit', id, body: text })
    this.broadcastToMessageTarget(m, { t: 'edit', id, from: this.runtime.self.accountId, body: text, ts: Date.now() })
    this.runtime.clients.logEvent('已编辑一条消息')
  }
}
