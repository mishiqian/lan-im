import { randomUUID } from 'node:crypto'
import type { Channel, ChannelKind } from '../protocol.ts'
import type { HostRuntime } from './runtime.ts'
import { legacyChannelId } from './util.ts'

/**
 * 频道注册表（v2）：
 * - '*' 内置公共频道；命名频道使用稳定 UUID，name 可重命名。
 * - 老版本 id===name 的频道迁移为确定性 UUID，并保留 name→id 别名映射。
 * - 私有频道按 accountId 成员过滤；公开频道可本地订阅/隐藏。
 * - 一致性模型：创建者权威，节点间信任 channelUpdate/channelDelete/成员变更广播。
 */
export class ChannelRegistry {
  private readonly channelSet = new Map<string, Channel>()
  private readonly aliases = new Map<string, string>()
  private readonly hiddenPublic = new Set<string>()

  constructor(private readonly runtime: HostRuntime) {}

  /** 载入持久化频道与本地隐藏列表。 */
  seed(channels: Channel[], hidden: string[]): void {
    for (const c of Array.isArray(channels) ? channels : []) {
      const migrated = this.normalize(c)
      if (migrated === null) continue
      this.channelSet.set(migrated.id, migrated)
      this.aliases.set(migrated.name, migrated.id)
    }
    for (const id of Array.isArray(hidden) ? hidden : []) {
      if (typeof id === 'string' && id !== '') this.hiddenPublic.add(id)
    }
  }

  persisted(): Channel[] {
    return [...this.channelSet.values()]
  }

  hiddenSnapshot(): string[] {
    return [...this.hiddenPublic]
  }

  private normalize(raw: any): Channel | null {
    if (!raw || typeof raw.id !== 'string' || raw.id === '' || raw.id === '*') return null
    const legacy = raw.kind !== 'public' && raw.kind !== 'private'
    const name = typeof raw.name === 'string' && raw.name !== '' ? raw.name : raw.id
    let id = raw.id
    if (legacy) id = legacyChannelId(name)
    const kind: ChannelKind = raw.kind === 'private' ? 'private' : 'public'
    const createdBy = typeof raw.createdBy === 'string' && raw.createdBy !== '' ? raw.createdBy : '*'
    const members = kind === 'private'
      ? Array.isArray(raw.members) ? raw.members.filter((m: any) => typeof m === 'string') : [createdBy === '*' ? '' : createdBy].filter((m: string) => m !== '')
      : undefined
    return {
      id,
      name,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      kind,
      createdBy,
      createdAt: Number(raw.createdAt) || Date.now(),
      members,
    }
  }

  get(id: string): Channel | undefined { return this.channelSet.get(id) }

  getByName(name: string): Channel | undefined {
    const id = this.aliases.get(name)
    return id !== undefined ? this.channelSet.get(id) : undefined
  }

  isMember(channel: Channel, accountId: string): boolean {
    if (channel.kind === 'public') return true
    const members = channel.members ?? []
    return members.includes(accountId) || channel.createdBy === accountId
  }

  /** 当前账号可见的频道列表。 */
  list(): Channel[] {
    const accountId = this.runtime.self.accountId
    const result: Channel[] = [{ id: '*', name: '公共频道', kind: 'public', createdBy: '*', createdAt: 0 }]
    for (const c of this.channelSet.values()) {
      if (c.kind === 'public' && this.hiddenPublic.has(c.id)) {
        result.push({ ...c, joined: false })
        continue
      }
      if (!this.visibleTo(c, accountId)) continue
      result.push(c)
    }
    return result
  }

  /** 给某个对端账号看的频道列表（hello/channelsSync 前过滤私有频道）。 */
  listForPeer(accountId: string): Channel[] {
    const result: Channel[] = [{ id: '*', name: '公共频道', kind: 'public', createdBy: '*', createdAt: 0 }]
    for (const c of this.channelSet.values()) {
      if (this.hiddenPublic.has(c.id)) continue
      if (!this.visibleTo(c, accountId)) continue
      result.push(c)
    }
    return result
  }

  private visibleTo(channel: Channel, accountId: string): boolean {
    if (channel.kind === 'public') return !this.hiddenPublic.has(channel.id)
    return this.isMember(channel, accountId)
  }

  canManage(channel: Channel): boolean {
    return channel.createdBy === '*' || channel.createdBy === this.runtime.self.accountId
  }

  notifyClients(): void {
    this.runtime.clients.channels(this.list())
  }

  /** 兼容旧版：向一个旧频道名/未知频道发消息时，自动补建公开频道。 */
  resolveTarget(to: string): string {
    const target = String(to ?? '').trim()
    if (target === '' || target === '*') return '*'
    if (this.channelSet.has(target)) return target
    const aliasId = this.aliases.get(target)
    if (aliasId !== undefined && this.channelSet.has(aliasId)) return aliasId
    return this.ensureLegacyChannel(target)
  }

  /** 把历史消息中的旧频道名映射到 UUID（必要时补建）。 */
  migrateMessageTargets(messages: Array<{ to: string; toType: string }>): void {
    for (const m of messages) {
      if (m.toType !== 'channel' || m.to === '*' || m.to === '') continue
      const resolved = this.resolveTarget(m.to)
      if (resolved !== m.to) m.to = resolved
    }
  }

  private ensureLegacyChannel(name: string): string {
    const existing = this.getByName(name)
    if (existing !== undefined) return existing.id
    const id = legacyChannelId(name)
    if (this.channelSet.has(id)) return id
    const channel: Channel = {
      id, name, kind: 'public', createdBy: '*', createdAt: Date.now(),
    }
    this.channelSet.set(id, channel)
    this.aliases.set(name, id)
    void this.runtime.persistChannels()
    this.notifyClients()
    this.runtime.peerNetwork.broadcastWire({ t: 'channelAdd', channel })
    return id
  }

  create(name: string, kind: ChannelKind = 'public', description?: string): Channel {
    const trimmed = String(name ?? '').trim()
    if (trimmed === '' || trimmed === '*' || trimmed.length > 32) throw new Error('频道名不合法（1-32 字符，不能为 *）')
    if (this.runtime.self.accountId === '' && kind === 'private') throw new Error('请先设置账号，再创建私有频道')
    const channel: Channel = {
      id: randomUUID(),
      name: trimmed,
      description: String(description ?? '').trim() || undefined,
      kind,
      createdBy: this.runtime.self.accountId || '*',
      createdAt: Date.now(),
      members: kind === 'private' ? [this.runtime.self.accountId] : undefined,
    }
    this.channelSet.set(channel.id, channel)
    this.aliases.set(channel.name, channel.id)
    void this.runtime.persistChannels()
    this.broadcastChannel({ t: 'channelAdd', channel }, channel)
    this.notifyClients()
    this.runtime.clients.logEvent(`已创建${kind === 'private' ? '私有' : ''}频道 ${channel.name}`)
    return channel
  }

  rename(id: string, name: string, description?: string): Channel {
    const channel = this.requireManageable(id)
    const trimmed = String(name ?? '').trim()
    if (trimmed === '' || trimmed === '*' || trimmed.length > 32) throw new Error('频道名不合法（1-32 字符，不能为 *）')
    this.aliases.delete(channel.name)
    channel.name = trimmed
    channel.description = String(description ?? '').trim() || undefined
    this.aliases.set(channel.name, channel.id)
    void this.runtime.persistChannels()
    this.broadcastChannel({ t: 'channelUpdate', channel }, channel)
    this.notifyClients()
    this.runtime.clients.logEvent(`已重命名频道为 ${channel.name}`)
    return channel
  }

  remove(id: string): void {
    const channel = this.requireManageable(id)
    this.channelSet.delete(id)
    this.aliases.delete(channel.name)
    this.hiddenPublic.delete(id)
    void this.runtime.persistChannels()
    void this.runtime.sharedFileStore.removeByChannel(id).catch(() => {})
    if (channel.kind === 'public') this.runtime.peerNetwork.broadcastWire({ t: 'channelDelete', id })
    else this.runtime.peerNetwork.broadcastWireToAccounts({ t: 'channelDelete', id }, this.memberAccounts(channel))
    this.notifyClients()
    this.runtime.clients.logEvent(`已解散频道 ${channel.name}`)
  }

  join(id: string): void {
    const channel = this.channelSet.get(id)
    if (channel === undefined) throw new Error('频道不存在')
    if (channel.kind === 'private') throw new Error('私有频道需要成员邀请')
    this.hiddenPublic.delete(id)
    void this.runtime.persistChannels()
    this.notifyClients()
    this.runtime.clients.logEvent(`已加入频道 ${channel.name}`)
  }

  leave(id: string): void {
    if (id === '*') return
    const channel = this.channelSet.get(id)
    if (channel === undefined) return
    if (channel.kind === 'public') {
      this.hiddenPublic.add(id)
      void this.runtime.persistChannels()
      this.notifyClients()
      this.runtime.clients.logEvent(`已离开频道 ${channel.name}`)
      return
    }
    const selfId = this.runtime.self.accountId
    if (!this.isMember(channel, selfId)) return
    this.applyMemberRemove(channel, selfId)
    const remaining = this.memberAccounts(channel)
    if (channel.createdBy === selfId && remaining.length > 0) {
      // 创建者离开时把所有权转给剩余最早成员，保持频道可管理。
      channel.createdBy = remaining[0]
      void this.runtime.persistChannels()
      this.channelSet.delete(id)
      this.aliases.delete(channel.name)
      this.broadcastToAccounts(channel, remaining, { t: 'channelUpdate', channel })
      this.broadcastToAccounts(channel, remaining, { t: 'channelMemberRemove', channelId: id, accountId: selfId })
      this.notifyClients()
      this.runtime.clients.logEvent(`已退出私有频道 ${channel.name}（创建者已转移给 ${remaining[0]}）`)
      return
    }
    if (channel.createdBy === selfId) {
      // 创建者是唯一成员：退出即解散。
      this.channelSet.delete(id)
      this.aliases.delete(channel.name)
      void this.runtime.persistChannels()
      this.notifyClients()
      this.runtime.clients.logEvent(`已退出并解散私有频道 ${channel.name}`)
      return
    }
    this.channelSet.delete(id)
    this.aliases.delete(channel.name)
    void this.runtime.persistChannels()
    this.broadcastToAccounts(channel, remaining, { t: 'channelMemberRemove', channelId: id, accountId: selfId })
    this.notifyClients()
    this.runtime.clients.logEvent(`已退出私有频道 ${channel.name}`)
  }

  invite(channelId: string, accountId: string): void {
    const channel = this.requireManageable(channelId)
    if (channel.kind !== 'private') throw new Error('仅私有频道支持成员邀请')
    const target = this.runtime.peerNetwork.resolveAccount(String(accountId ?? ''))
    if (!/^[a-zA-Z0-9_.-]{1,32}$/.test(target)) throw new Error('账号格式不合法')
    const members = new Set(channel.members ?? [])
    if (members.has(target)) return
    const existing = [...members]
    members.add(target)
    channel.members = [...members]
    void this.runtime.persistChannels()
    // 老成员只更新成员列表；新成员必须收到完整 channel 元数据。
    this.broadcastToAccounts(channel, existing, { t: 'channelMemberAdd', channelId, accountId: target })
    this.runtime.peerNetwork.broadcastWireToAccounts({ t: 'channelAdd', channel }, [target])
    const channelFiles = this.runtime.sharedFileStore.listForChannel(channelId)
    if (channelFiles.length > 0) this.runtime.peerNetwork.broadcastWireToAccounts({ t: 'sharedFilesSync', files: channelFiles }, [target])
    this.notifyClients()
    this.runtime.clients.logEvent(`已邀请 ${target} 加入 ${channel.name}`)
  }

  removeMember(channelId: string, accountId: string): void {
    const channel = this.requireManageable(channelId)
    if (channel.kind !== 'private') throw new Error('仅私有频道支持成员移除')
    const target = String(accountId ?? '').trim()
    if (target === channel.createdBy) throw new Error('不能移除频道创建者')
    if (!(channel.members ?? []).includes(target)) return
    this.applyMemberRemove(channel, target)
    void this.runtime.persistChannels()
    const audience = new Set<string>(this.memberAccounts(channel))
    audience.add(target)
    this.broadcastToAccounts(channel, [...audience], { t: 'channelMemberRemove', channelId, accountId: target })
    this.notifyClients()
    this.runtime.clients.logEvent(`已将 ${target} 移出 ${channel.name}`)
  }

  /** 某个 accountId 是否可以查看该频道（用于 hello/索引过滤）。 */
  isVisibleToAccount(channelId: string, accountId: string): boolean {
    if (channelId === '*') return true
    const channel = this.channelSet.get(channelId)
    if (channel === undefined) return false
    if (channel.kind === 'public') return true
    return this.isMember(channel, accountId)
  }

  /** 接收端是否可以查看/接收发给该频道的消息。 */
  canReceive(to: string): boolean {
    if (to === '*') return !this.hiddenPublic.has('*')
    const channel = this.channelSet.get(to)
    if (channel === undefined) return false
    if (channel.kind === 'public') return !this.hiddenPublic.has(channel.id)
    return this.isMember(channel, this.runtime.self.accountId)
  }

  /** 发送端：频道消息/文件应该路由给哪些 accountId（'*' 表示全部在线）。 */
  audience(channelId: string): string[] {
    if (channelId === '*') return ['*']
    const channel = this.channelSet.get(channelId)
    if (channel === undefined) return []
    if (channel.kind === 'public') return ['*']
    return this.memberAccounts(channel)
  }

  memberAccounts(channel: Channel): string[] {
    const members = channel.members ?? []
    return members.length > 0 ? members : channel.createdBy !== '*' ? [channel.createdBy] : []
  }

  private applyMemberRemove(channel: Channel, accountId: string): void {
    channel.members = (channel.members ?? []).filter((m) => m !== accountId)
  }

  private requireManageable(id: string): Channel {
    const channel = this.channelSet.get(id)
    if (channel === undefined) throw new Error('频道不存在')
    if (!this.canManage(channel)) throw new Error('只有频道创建者可以执行此操作')
    return channel
  }

  // ── 节点间同步 ────────────────────────────────────────────────────────────

  /** 合并对端列表；只接受自己可见的私有频道，公开频道隐藏状态优先。 */
  merge(list: Channel[]): boolean {
    let changed = false
    for (const raw of Array.isArray(list) ? list : []) {
      const incoming = this.normalize(raw)
      if (incoming === null) continue
      const existing = this.channelSet.get(incoming.id)
      if (existing === undefined) {
        if (!this.visibleTo(incoming, this.runtime.self.accountId)) continue
        if (incoming.kind === 'public' && this.hiddenPublic.has(incoming.id)) continue
        this.channelSet.set(incoming.id, incoming)
        this.aliases.set(incoming.name, incoming.id)
        changed = true
        continue
      }
      // 已存在时信任创建者广播的元数据/成员变更。
      const before = JSON.stringify(existing)
      existing.name = incoming.name
      existing.description = incoming.description
      existing.kind = incoming.kind
      existing.createdBy = incoming.createdBy
      existing.createdAt = incoming.createdAt
      existing.members = incoming.members
      this.aliases.set(existing.name, existing.id)
      if (JSON.stringify(existing) !== before) changed = true
    }
    return changed
  }

  applyRemoteAdd(channel: Channel): boolean {
    const incoming = this.normalize(channel)
    if (incoming === null) return false
    if (!this.visibleTo(incoming, this.runtime.self.accountId)) return false
    if (incoming.kind === 'public' && this.hiddenPublic.has(incoming.id)) return false
    const changed = this.merge([incoming])
    if (changed) {
      void this.runtime.persistChannels()
      this.notifyClients()
    }
    return changed
  }

  applyRemoteUpdate(channel: Channel): boolean {
    const changed = this.merge([channel])
    if (changed) {
      void this.runtime.persistChannels()
      this.notifyClients()
    }
    return changed
  }

  applyRemoteDelete(id: string): void {
    const channel = this.channelSet.get(id)
    if (channel === undefined) return
    this.channelSet.delete(id)
    this.aliases.delete(channel.name)
    this.hiddenPublic.delete(id)
    void this.runtime.persistChannels()
    void this.runtime.sharedFileStore.removeByChannel(id).catch(() => {})
    this.notifyClients()
  }

  applyRemoteMemberAdd(channelId: string, accountId: string): void {
    const channel = this.channelSet.get(channelId)
    if (channel === undefined) return
    const members = new Set(channel.members ?? [])
    if (!members.has(accountId)) {
      members.add(accountId)
      channel.members = [...members]
      void this.runtime.persistChannels()
      this.notifyClients()
    }
  }

  applyRemoteMemberRemove(channelId: string, accountId: string): void {
    const channel = this.channelSet.get(channelId)
    if (channel === undefined) return
    this.applyMemberRemove(channel, accountId)
    if (accountId === this.runtime.self.accountId && !this.isMember(channel, this.runtime.self.accountId)) {
      this.channelSet.delete(channelId)
      this.aliases.delete(channel.name)
      this.hiddenPublic.delete(channelId)
      void this.runtime.sharedFileStore.removeByChannel(channelId).catch(() => {})
    }
    void this.runtime.persistChannels()
    this.notifyClients()
  }

  private broadcastChannel(wire: { t: 'channelAdd'; channel: Channel } | { t: 'channelUpdate'; channel: Channel }, channel: Channel): void {
    if (channel.kind === 'public') {
      this.runtime.peerNetwork.broadcastWire(wire)
    } else {
      const audience = this.memberAccounts(channel)
      this.broadcastToAccounts(channel, audience, wire)
    }
  }

  private broadcastToAccounts(channel: Channel, accountIds: string[], wire: any): void {
    if (channel.kind === 'public') this.runtime.peerNetwork.broadcastWire(wire)
    else this.runtime.peerNetwork.broadcastWireToAccounts(wire, accountIds)
  }
}
