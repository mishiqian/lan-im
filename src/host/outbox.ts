import type { ChatMessage } from '../protocol.ts'
import type { HostRuntime } from './runtime.ts'

/**
 * 私聊离线 outbox：每个目标账号一个 FIFO 队列（上限 200 条）。
 */
export class Outbox {
  private readonly items = new Map<string, ChatMessage[]>()

  constructor(private readonly runtime: HostRuntime) {}

  async load(): Promise<void> {
    for (const file of await this.runtime.storage.readOutboxFiles()) {
      const list: ChatMessage[] = []
      for (const line of file.text.split('\n')) {
        if (line.trim() === '') continue
        try { list.push(JSON.parse(line) as ChatMessage) } catch { /* 跳过 */ }
      }
      if (list.length > 0) this.items.set(file.accountId, list)
    }
  }

  list(accountId: string): ChatMessage[] {
    return this.items.get(accountId) ?? []
  }

  add(message: ChatMessage): void {
    const list = this.items.get(message.to) ?? []
    list.push(message)
    if (list.length > 200) list.shift()
    this.items.set(message.to, list)
    void this.persist(message.to).catch(() => {})
  }

  remove(accountId: string, id: string): void {
    const list = this.items.get(accountId)
    if (list === undefined) return
    const idx = list.findIndex((m) => m.id === id)
    if (idx === -1) return
    list.splice(idx, 1)
    if (list.length === 0) this.items.delete(accountId)
    void this.persist(accountId).catch(() => {})
  }

  private async persist(accountId: string): Promise<void> {
    const list = this.items.get(accountId) ?? []
    await this.runtime.storage.writeOutbox(accountId, list.map((m) => JSON.stringify(m)))
  }
}
