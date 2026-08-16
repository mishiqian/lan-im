import type { WebSocket, WebSocketServer } from 'ws'
import type { HostRuntime } from './runtime.ts'

/**
 * 浏览器客户端 ↔ 宿主 WebSocket 协议桥。
 * 客户端连接后先收 snapshot，之后按 t 分发到各业务模块。
 */
export class ClientBridge {
  constructor(private readonly runtime: HostRuntime) {}

  attach(wss: WebSocketServer): void {
    wss.on('connection', (ws: WebSocket) => {
      this.runtime.clients.attach(ws)
      ws.on('close', () => this.runtime.clients.detach(ws))
      ws.on('error', () => this.runtime.clients.detach(ws))
      this.runtime.clients.send(ws, {
        t: 'snapshot',
        self: this.runtime.self,
        peers: this.runtime.peerNetwork.peersSnapshot(),
        channels: this.runtime.channelRegistry.list(),
        messages: this.runtime.messageStore.messages,
        files: [...this.runtime.messageStore.files.values()],
        sharedFiles: this.runtime.sharedFileStore.list(),
        log: this.runtime.clients.log,
      })

      ws.on('message', (data) => {
        let msg: any
        try { msg = JSON.parse(String(data)) } catch { return }
        if (msg.t === 'send') {
          try {
            this.runtime.messaging.sendMessage(
              String(msg.to ?? '*'),
              msg.toType === 'account' ? 'account' : 'channel',
              String(msg.body ?? ''),
            )
          } catch (err: any) {
            this.runtime.clients.error(ws, err?.message ?? String(err))
          }
        } else if (msg.t === 'setName') {
          void this.runtime.settings.setName(String(msg.name ?? ''))
        } else if (msg.t === 'setupAccount') {
          void this.runtime.settings.setupAccount(
            String(msg.username ?? ''),
            String(msg.displayName ?? ''),
            typeof msg.password === 'string' ? msg.password : undefined,
          ).catch((err: any) => this.runtime.clients.error(ws, err?.message ?? String(err)))
        } else if (msg.t === 'setupPsk') {
          void this.runtime.settings.setupPsk(String(msg.psk ?? ''))
        } else if (msg.t === 'setPassword') {
          void this.runtime.settings.setPassword(String(msg.password ?? '')).catch((err: any) => this.runtime.clients.error(ws, err?.message ?? String(err)))
        } else if (msg.t === 'search') {
          void this.runtime.messageStore.search(String(msg.keyword ?? '')).then((results) => {
            this.runtime.clients.searchResult(ws, msg.keyword, results)
          })
        } else if (msg.t === 'recall') {
          this.runtime.messaging.recallMessage(String(msg.id ?? ''))
        } else if (msg.t === 'edit') {
          this.runtime.messaging.editMessage(String(msg.id ?? ''), String(msg.body ?? ''))
        } else if (msg.t === 'createChannel') {
          try {
            this.runtime.channelRegistry.create(String(msg.name ?? ''), msg.kind === 'private' ? 'private' : 'public', typeof msg.description === 'string' ? msg.description : undefined)
          } catch (err: any) {
            this.runtime.clients.error(ws, err?.message ?? String(err))
          }
        } else if (msg.t === 'renameChannel') {
          try {
            this.runtime.channelRegistry.rename(String(msg.id ?? ''), String(msg.name ?? ''), typeof msg.description === 'string' ? msg.description : undefined)
          } catch (err: any) {
            this.runtime.clients.error(ws, err?.message ?? String(err))
          }
        } else if (msg.t === 'deleteChannel') {
          try {
            this.runtime.channelRegistry.remove(String(msg.id ?? ''))
          } catch (err: any) {
            this.runtime.clients.error(ws, err?.message ?? String(err))
          }
        } else if (msg.t === 'joinChannel') {
          try {
            this.runtime.channelRegistry.join(String(msg.id ?? ''))
          } catch (err: any) {
            this.runtime.clients.error(ws, err?.message ?? String(err))
          }
        } else if (msg.t === 'leaveChannel') {
          try {
            this.runtime.channelRegistry.leave(String(msg.id ?? ''))
          } catch (err: any) {
            this.runtime.clients.error(ws, err?.message ?? String(err))
          }
        } else if (msg.t === 'inviteChannelMember') {
          try {
            this.runtime.channelRegistry.invite(String(msg.channelId ?? ''), String(msg.accountId ?? ''))
          } catch (err: any) {
            this.runtime.clients.error(ws, err?.message ?? String(err))
          }
        } else if (msg.t === 'removeChannelMember') {
          try {
            this.runtime.channelRegistry.removeMember(String(msg.channelId ?? ''), String(msg.accountId ?? ''))
          } catch (err: any) {
            this.runtime.clients.error(ws, err?.message ?? String(err))
          }
        } else if (msg.t === 'removeSharedFile') {
          void this.runtime.sharedFileStore.remove(String(msg.id ?? '')).catch((err: any) => this.runtime.clients.error(ws, err?.message ?? String(err)))
        } else if (msg.t === 'fileStart') {
          this.runtime.fileTransfer.handleStart(ws, msg)
        } else if (msg.t === 'fileChunk') {
          this.runtime.fileTransfer.handleChunk(msg)
        } else if (msg.t === 'fileEnd') {
          void this.runtime.fileTransfer.handleEnd(ws, msg)
        }
      })
    })
  }
}
