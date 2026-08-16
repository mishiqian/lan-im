import type { Account } from '../protocol.ts'
import type { HostRuntime } from './runtime.ts'
import { hashPassword } from './util.ts'

/**
 * 本机身份与安全设置：账号、显示名、共享密钥（PSK）。
 */
export class Settings {
  constructor(private readonly runtime: HostRuntime) {}

  async setupAccount(username: string, displayName: string, password?: string): Promise<void> {
    const u = String(username ?? '').trim()
    if (!/^[a-zA-Z0-9_.-]{1,32}$/.test(u)) throw new Error('账号仅允许字母/数字/._-，1-32 位')
    const self = this.runtime.self
    self.accountId = u
    self.name = (String(displayName ?? '').trim() || u).slice(0, 32)
    if (typeof password === 'string' && password !== '') {
      const { hash, salt } = hashPassword(password)
      await this.runtime.storage.writeConfig({
        nodeId: self.nodeId,
        account: { username: u, displayName: self.name, passwordHash: hash, salt },
        psk: this.runtime.psk || undefined,
        channels: this.runtime.channelRegistry.persisted(),
        hiddenChannels: this.runtime.channelRegistry.hiddenSnapshot(),
      })
    } else {
      await this.runtime.saveConfig()
    }
    this.runtime.discovery.republish()
    this.runtime.clients.self(self)
    this.runtime.self.hasPassword = typeof password === 'string' && password !== ''
    this.runtime.clients.logEvent(`账号已设置：${u}`)
  }

  async setPassword(password: string): Promise<void> {
    const self = this.runtime.self
    if (self.accountId === '') throw new Error('请先设置账号')
    const value = String(password ?? '')
    const account: Account = { username: self.accountId, displayName: self.name }
    if (value !== '') {
      const { hash, salt } = hashPassword(value)
      account.passwordHash = hash
      account.salt = salt
    }
    await this.runtime.storage.writeConfig({
      nodeId: self.nodeId,
      account,
      psk: this.runtime.psk || undefined,
      channels: this.runtime.channelRegistry.persisted(),
      hiddenChannels: this.runtime.channelRegistry.hiddenSnapshot(),
    })
    self.hasPassword = value !== ''
    this.runtime.clients.self(self)
    this.runtime.clients.logEvent(value === '' ? '已清除本机密码' : '已更新本机密码')
  }

  async setName(name: string): Promise<void> {
    const trimmed = String(name ?? '').trim().slice(0, 32)
    if (trimmed === '') return
    this.runtime.self.name = trimmed
    await this.runtime.saveConfig()
    this.runtime.discovery.republish()
    this.runtime.clients.self(this.runtime.self)
    this.runtime.clients.logEvent(`已改名为 ${trimmed}`)
  }

  async setupPsk(value: string): Promise<void> {
    this.runtime.psk = String(value ?? '')
    this.runtime.self.hasPsk = this.runtime.psk !== ''
    await this.runtime.saveConfig()
    this.runtime.peerNetwork.clearPeers()
    this.runtime.discovery.republish()
    this.runtime.clients.self(this.runtime.self)
    this.runtime.clients.peers(this.runtime.peerNetwork.peersSnapshot())
    this.runtime.clients.logEvent(this.runtime.psk === '' ? '已清除共享密钥（开放信任）' : '已设置共享密钥')
  }
}
