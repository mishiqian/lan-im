/**
 * 传输层：取代原先的直连网络。
 *
 * 所有出站帧都经枢纽转发（LEP 信封加密），本模块只负责一件事——
 * 把「发给某个账号 / 广播 / 发给一组账号」翻译成若干次 sendViaHub。
 *
 * 保留旧 PeerNetwork 的方法名与签名，是为了让 channel-registry / file-transfer
 * 这些模块不用改逻辑；它们不知道底下已经没有直连了。
 */
import type { HostRuntime } from './runtime.ts'
import type { Peer } from '../protocol.ts'

export class Transport {
  constructor(private readonly runtime: HostRuntime) {}

  /** 已知对端（来自枢纽的 lookup / presence） */
  peersSnapshot(): Peer[] {
    return this.runtime.hubPeers()
  }

  /** 旧接口：按 nodeId 找到对端连接。枢纽模式下没有“连接”，返回 false */
  sendWire(_nodeId: string, _wire: unknown): boolean {
    return false
  }

  /** 旧接口：单发。保留给尚未改造的调用方，统一折成按账号发送 */
  deliverToAccount(account: string): void {
    if (this.runtime.hubStatus().state !== 'online') return
    this.runtime.hubMarkDelivered?.(account)
  }

  broadcastWire(wire: unknown): void {
    for (const peer of this.runtime.hubPeers()) {
      void this.runtime.sendViaHub(peer.accountId, 'channel', wire)
    }
  }

  broadcastWireToAccounts(wire: unknown, accounts: string[]): void {
    for (const account of accounts) {
      if (account === '*') { this.broadcastWire(wire); continue }
      if (account === this.runtime.self.accountId) continue
      void this.runtime.sendViaHub(account, 'channel', wire)
    }
  }

  /** 旧接口：账号解析（枢纽模式下只要是本机/已知账号就返回） */
  resolveAccount(accountId: string): string | undefined {
    const name = String(accountId ?? '')
    if (name === this.runtime.self.accountId) return name
    return this.runtime.hubPeers().some((p) => p.accountId === name) ? name : undefined
  }

  /** 旧接口：占位，无直连可建 */
  upsertPeer(): void { /* 无直连 */ }
  openConnection(): undefined { return undefined }
  ensurePeerConnection(): void { /* 无直连 */ }
  clearPeers(): void { /* 无直连 */ }
  stop(): void { /* 无直连 */ }

  /** 入站帧分发（msg 之外的频道/文件/回执/撤回/编辑） */
  dispatch(wire: any): void {
    if (wire === null || typeof wire !== 'object') return
    const runtime = this.runtime
    if (wire.t === 'msg') { runtime.receiveRemoteMessage(wire); return }
    if (wire.t === 'ack') {
      const peer = runtime.hubPeerByKeyId?.(String(wire.fromKeyId ?? ''))
      if (peer !== undefined) runtime.outbox.remove(peer.account, String(wire.id))
      runtime.messageStore.markDelivered(String(wire.id))
      return
    }
    if (wire.t === 'recall') {
      const m = runtime.messageStore.get(wire.id)
      if (m !== undefined && m.from === wire.from && !m.recalled) {
        m.recalled = true
        m.body = ''
        runtime.clients.message(m)
        runtime.messageStore.appendEvent({ event: 'recall', id: wire.id })
      }
      return
    }
    if (wire.t === 'edit') {
      const m = runtime.messageStore.get(wire.id)
      if (m !== undefined && m.from === wire.from) {
        m.body = wire.body
        m.edited = true
        runtime.clients.message(m)
        runtime.messageStore.appendEvent({ event: 'edit', id: wire.id, body: wire.body })
      }
      return
    }
    if (wire.t === 'file' || wire.t === 'chunk') {
      if (wire.t === 'file' && wire.toType === 'channel' && !runtime.channelRegistry.canReceive(String(wire.to ?? ''))) return
      runtime.fileTransfer.handleIncomingWire(wire)
      return
    }
    if (wire.t === 'channelAdd') {
      if (wire.channel && typeof wire.channel === 'object') runtime.channelRegistry.applyRemoteAdd(wire.channel)
      return
    }
    if (wire.t === 'channelUpdate') {
      if (wire.channel && typeof wire.channel === 'object') runtime.channelRegistry.applyRemoteUpdate(wire.channel)
      return
    }
    if (wire.t === 'channelDelete') { runtime.channelRegistry.applyRemoteDelete(String(wire.id ?? '')); return }
    if (wire.t === 'channelMemberAdd') { runtime.channelRegistry.applyRemoteMemberAdd(String(wire.channelId ?? ''), String(wire.accountId ?? '')); return }
    if (wire.t === 'channelMemberRemove') { runtime.channelRegistry.applyRemoteMemberRemove(String(wire.channelId ?? ''), String(wire.accountId ?? '')); return }
    if (wire.t === 'channelsSync') {
      if (runtime.channelRegistry.merge(wire.channels)) {
        void runtime.persistChannels()
        runtime.channelRegistry.notifyClients()
      }
      return
    }
    if (wire.t === 'sharedFilesSync') {
      if (runtime.sharedFileStore.merge(wire.files)) runtime.sharedFileStore.notifyClients()
      return
    }
    if (wire.t === 'fileAdd' || wire.t === 'fileRemove' || wire.t === 'fileFetch' || wire.t === 'fileData') {
      runtime.sharedFileStore.handleIncomingWire(wire)
    }
  }
}
