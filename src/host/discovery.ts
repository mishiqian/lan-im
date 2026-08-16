import { createSocket, type Socket as UdpSocket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import Bonjour from 'bonjour-service'
import {
  ANNOUNCE_INTERVAL_MS, DISCOVERY_PORT, MDNS_TYPE, PROTOCOL_VERSION, UDP_MAGIC,
} from '../protocol.ts'
import type { HostRuntime } from './runtime.ts'
import { pskIdFor } from './util.ts'

/**
 * 节点发现：mDNS 主通道 + UDP 广播兜底通道。
 * 两者最终都归一为 PeerSeed 交给 PeerNetwork.upsertPeer。
 */
export class Discovery {
  private bonjour: any
  private browser: any
  private udp: UdpSocket | undefined
  private announceTimer: ReturnType<typeof setInterval> | undefined
  private broadcastWarned = false

  constructor(private readonly runtime: HostRuntime) {}

  start(): void {
    this.startMdns()
    this.startUdp()
  }

  stop(): void {
    if (this.announceTimer !== undefined) clearInterval(this.announceTimer)
    this.announceTimer = undefined
    try { this.browser?.stop() } catch { /* 忽略 */ }
    try { this.bonjour?.destroy() } catch { /* 忽略 */ }
    try { this.udp?.close() } catch { /* 忽略 */ }
    this.browser = undefined
    this.bonjour = undefined
    this.udp = undefined
  }

  /** 身份/PSK 变化后重新发布 mDNS 服务。 */
  republish(): void {
    try { this.bonjour?.unpublishAll(() => this.publishMdns()) } catch { /* 忽略 */ }
  }

  private publishMdns(): void {
    if (this.bonjour === undefined) return
    try {
      this.bonjour.publish({
        name: this.runtime.self.nodeId,
        type: MDNS_TYPE,
        protocol: 'tcp',
        port: this.runtime.self.wsPort,
        txt: {
          v: String(PROTOCOL_VERSION),
          nodeId: this.runtime.self.nodeId,
          accountId: this.runtime.self.accountId,
          name: this.runtime.self.name,
          pskId: pskIdFor(this.runtime.psk),
        },
      })
    } catch (err: any) {
      this.runtime.clients.logEvent(`mDNS 发布失败: ${err?.message ?? err}`)
    }
  }

  private startMdns(): void {
    try {
      this.bonjour = new Bonjour()
      this.publishMdns()
      this.browser = this.bonjour.find({ type: MDNS_TYPE, protocol: 'tcp' })
      this.browser.on('up', (service: any) => {
        const txt = service?.txt ?? {}
        this.runtime.peerNetwork.upsertPeer({
          nodeId: typeof txt.nodeId === 'string' ? txt.nodeId : String(service?.name ?? ''),
          accountId: typeof txt.accountId === 'string' ? txt.accountId : '',
          name: typeof txt.name === 'string' ? txt.name : '',
          ip: this.pickPeerIp(service),
          wsPort: Number(service?.port) || 0,
          pskId: typeof txt.pskId === 'string' ? txt.pskId : '',
        })
      })
      this.runtime.clients.logEvent(`mDNS 已广播服务 _${MDNS_TYPE}._tcp @ 端口 ${this.runtime.self.wsPort}`)
    } catch (err: any) {
      this.runtime.clients.logEvent(`mDNS 启动失败: ${err?.message ?? err}`)
    }
  }

  private pickPeerIp(service: any): string {
    const addrs: unknown[] = Array.isArray(service?.addresses) ? service.addresses : []
    for (const a of addrs) {
      if (typeof a === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(a) && !a.startsWith('127.')) return a
    }
    const ref = service?.referer?.address
    if (typeof ref === 'string' && ref !== '' && !ref.startsWith('127.')) return ref
    const first = addrs[0]
    return typeof first === 'string' ? first : (typeof ref === 'string' ? ref : '')
  }

  private broadcastAddresses(): string[] {
    const result = new Set<string>(['255.255.255.255'])
    const interfaces = networkInterfaces()
    for (const name of Object.keys(interfaces)) {
      for (const info of interfaces[name] ?? []) {
        if (info.family !== 'IPv4' || info.internal) continue
        const addr = info.address.split('.').map(Number)
        const mask = info.netmask.split('.').map(Number)
        result.add(addr.map((octet, i) => (octet | (~mask[i] & 255)) >>> 0).join('.'))
      }
    }
    return [...result]
  }

  private sendAnnounce(): void {
    if (this.udp === undefined || this.runtime.self.nodeId === '') return
    const pkt = Buffer.from(JSON.stringify({
      magic: UDP_MAGIC,
      v: PROTOCOL_VERSION,
      nodeId: this.runtime.self.nodeId,
      accountId: this.runtime.self.accountId,
      name: this.runtime.self.name,
      wsPort: this.runtime.self.wsPort,
      pskId: pskIdFor(this.runtime.psk),
      ts: Date.now(),
    }), 'utf8')
    for (const address of this.broadcastAddresses()) {
      this.udp.send(pkt, DISCOVERY_PORT, address, (err: any) => {
        if (err !== null && !this.broadcastWarned) {
          this.broadcastWarned = true
          this.runtime.clients.logEvent(`UDP 广播发送失败 (${address}): ${err?.code ?? err?.message ?? err}`)
        }
      })
    }
  }

  private startUdp(): void {
    const socket = createSocket({ type: 'udp4', reuseAddr: true })
    socket.on('error', (err: any) => {
      this.runtime.clients.logEvent(`UDP 兜底端口 ${DISCOVERY_PORT} 绑定失败: ${err?.code ?? err?.message ?? err}`)
    })
    socket.on('message', (buffer, rinfo) => {
      if (this.runtime.stopped) return
      let pkt: any
      try { pkt = JSON.parse(buffer.toString('utf8')) } catch { return }
      if (pkt.magic !== UDP_MAGIC || pkt.v !== PROTOCOL_VERSION) return
      this.runtime.peerNetwork.upsertPeer({
        nodeId: pkt.nodeId,
        accountId: pkt.accountId ?? '',
        name: pkt.name ?? '',
        ip: rinfo.address,
        wsPort: Number(pkt.wsPort) || 0,
        pskId: pkt.pskId ?? '',
      })
    })
    socket.bind(DISCOVERY_PORT, () => {
      try { socket.setBroadcast(true) } catch { /* 忽略 */ }
      this.udp = socket
      this.runtime.clients.logEvent(`UDP 兜底发现已监听端口 ${DISCOVERY_PORT}`)
      this.sendAnnounce()
    })
    this.announceTimer = setInterval(() => this.sendAnnounce(), ANNOUNCE_INTERVAL_MS)
  }
}
