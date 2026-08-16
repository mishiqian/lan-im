import { randomUUID } from 'node:crypto'
import { HISTORY_LIMIT, type ChatMessage, type FileInfo } from '../protocol.ts'
import type { HostRuntime } from './runtime.ts'

/**
 * 实时消息窗口与本地历史索引。
 * 内存保留最近 HISTORY_LIMIT 条；全量历史按天落盘，搜索时回放全量文件。
 */
export class MessageStore {
  readonly messages: ChatMessage[] = []
  readonly files = new Map<string, FileInfo>()

  constructor(private readonly runtime: HostRuntime) {}

  async load(): Promise<void> {
    const byId = new Map<string, ChatMessage>()
    const legacy = await this.runtime.storage.readLegacyHistory()
    if (legacy !== '') this.replayLines(legacy, byId)
    for (const text of await this.runtime.storage.readDailyHistory()) {
      this.replayLines(text, byId)
    }
    this.messages.push(...byId.values())
    while (this.messages.length > HISTORY_LIMIT) this.messages.shift()
  }

  /** 回放 jsonl；recall/edit/file 事件会修改目标 map（file 同时进入 files）。 */
  replayLines(text: string, target: Map<string, ChatMessage>): void {
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      let rec: any
      try { rec = JSON.parse(line) } catch { continue }
      if (rec?.event === 'recall') {
        const m = target.get(rec.id)
        if (m) { m.recalled = true; m.body = '' }
      } else if (rec?.event === 'edit') {
        const m = target.get(rec.id)
        if (m) { m.body = rec.body; m.edited = true }
      } else if (rec?.event === 'file' && typeof rec.id === 'string') {
        const file: FileInfo = {
          id: rec.id, from: rec.from, fromName: rec.fromName,
          to: rec.to, toType: rec.toType === 'account' ? 'account' : 'channel',
          name: rec.name, size: rec.size, mime: rec.mime, ts: rec.ts, path: rec.path,
        }
        this.files.set(rec.id, file)
      } else if (rec && typeof rec.id === 'string' && (rec.kind === 'text' || rec.kind === 'system')) {
        target.set(rec.id, rec)
      }
    }
  }

  push(message: ChatMessage): void {
    this.messages.push(message)
    while (this.messages.length > HISTORY_LIMIT) this.messages.shift()
    void this.runtime.storage.appendHistory(message.ts, JSON.stringify(message) + '\n').catch(() => {})
    this.runtime.clients.message(message)
  }

  appendEvent(event: unknown): void {
    const ts = (event as any)?.ts ?? Date.now()
    void this.runtime.storage.appendHistory(ts, JSON.stringify(event) + '\n').catch(() => {})
  }

  pushSystem(body: string): void {
    const self = this.runtime.self
    this.push({
      id: randomUUID(), from: self.accountId, fromName: self.name,
      to: '*', toType: 'channel', body, ts: Date.now(), kind: 'system', local: true,
    })
  }

  get(id: string): ChatMessage | undefined {
    return this.messages.find((x) => x.id === id)
  }

  has(id: string): boolean {
    return this.messages.some((m) => m.id === id)
  }

  markDelivered(id: string): void {
    const m = this.get(id)
    if (m !== undefined && m.status !== 'delivered') {
      m.status = 'delivered'
      this.runtime.clients.message(m)
    }
  }

  addFile(file: FileInfo): void {
    this.files.set(file.id, file)
  }

  async search(keyword: string): Promise<ChatMessage[]> {
    const kw = String(keyword ?? '').toLowerCase().trim()
    if (kw === '') return []
    try {
      const byId = new Map<string, ChatMessage>()
      const legacy = await this.runtime.storage.readLegacyHistory()
      if (legacy !== '') this.replayLines(legacy, byId)
      for (const text of await this.runtime.storage.readDailyHistory()) {
        this.replayLines(text, byId)
      }
      const results: ChatMessage[] = []
      for (const m of byId.values()) {
        if (m.kind !== 'text') continue
        if ((m.body ?? '').toLowerCase().includes(kw) || (m.fromName ?? '').toLowerCase().includes(kw)) results.push(m)
      }
      return results.slice(-100).reverse()
    } catch {
      return []
    }
  }
}
