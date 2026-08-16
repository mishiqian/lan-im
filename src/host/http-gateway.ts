import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { readFile } from 'node:fs/promises'
import { WebSocketServer } from 'ws'
import { API_ROUTE, HISTORY_LIMIT, WS_PATH } from '../protocol.ts'
import type { HostRuntime } from './runtime.ts'
import { json, readBody } from './util.ts'
import { ClientBridge } from './client-bridge.ts'

export interface WebServer {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
  registerUpgrade?(route: {
    path: string
    handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
  }): () => void
}

/**
 * HTTP/WS 网关：客户端 WebSocket 升级、文件下载、REST API。
 */
export class HttpGateway {
  private readonly bridge: ClientBridge
  private clientWss: WebSocketServer | undefined

  constructor(private readonly runtime: HostRuntime) {
    this.bridge = new ClientBridge(runtime)
  }

  register(webServer: WebServer): () => void {
    const disposers: Array<() => void> = []
    if (typeof webServer.registerUpgrade === 'function') {
      this.clientWss = new WebSocketServer({ noServer: true })
      this.bridge.attach(this.clientWss)
      disposers.push(webServer.registerUpgrade({
        path: WS_PATH,
        handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => {
          this.clientWss?.handleUpgrade(req, socket, head, (ws) => this.clientWss?.emit('connection', ws, req))
        },
      }))
    }
    if (typeof webServer.register === 'function') {
      disposers.push(webServer.register({
        kind: 'prefix',
        path: '/lan-im/files',
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          const id = (req.url ?? '').split('/').filter(Boolean).pop() ?? ''
          const rec = this.runtime.messageStore.files.get(id)
          if (rec === undefined) { res.writeHead(404); res.end(); return }
          try {
            const buf = await readFile(rec.path ?? '')
            res.writeHead(200, {
              'content-type': rec.mime || 'application/octet-stream',
              'content-length': buf.length,
              'content-disposition': `attachment; filename="${encodeURIComponent(rec.name)}"`,
            })
            res.end(buf)
          } catch { res.writeHead(404); res.end() }
        },
      }))
      disposers.push(webServer.register({
        kind: 'prefix',
        path: '/lan-im/shared-files',
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          const id = (req.url ?? '').split('/').filter(Boolean).pop() ?? ''
          const file = this.runtime.sharedFileStore.get(id)
          if (file === undefined) { res.writeHead(404); res.end(); return }
          try {
            const path = await this.runtime.sharedFileStore.ensureLocal(id)
            const buf = await readFile(path)
            res.writeHead(200, {
              'content-type': file.mime || 'application/octet-stream',
              'content-length': buf.length,
              'content-disposition': `attachment; filename="${encodeURIComponent(file.name)}"`,
            })
            res.end(buf)
          } catch { res.writeHead(404); res.end() }
        },
      }))
      disposers.push(webServer.register({
        kind: 'exact',
        path: API_ROUTE,
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          try {
            if (req.method === 'POST') {
              const body = await readBody(req)
              const action = typeof body.action === 'string' ? body.action : 'state'
              if (action === 'send') {
                const message = this.runtime.messaging.sendMessage(
                  String(body.to ?? '*'),
                  body.toType === 'account' ? 'account' : 'channel',
                  String(body.body ?? ''),
                )
                return json(res, 200, { ok: true, message })
              }
              if (action === 'setName') {
                await this.runtime.settings.setName(String(body.name ?? ''))
                return json(res, 200, { ok: true, self: this.runtime.self })
              }
              if (action === 'setupAccount') {
                await this.runtime.settings.setupAccount(
                  String(body.username ?? ''),
                  String(body.displayName ?? ''),
                  typeof body.password === 'string' ? body.password : undefined,
                )
                return json(res, 200, { ok: true, self: this.runtime.self })
              }
              if (action === 'setupPsk') {
                await this.runtime.settings.setupPsk(String(body.psk ?? ''))
                return json(res, 200, { ok: true, self: this.runtime.self })
              }
              if (action === 'setPassword') {
                await this.runtime.settings.setPassword(String(body.password ?? ''))
                return json(res, 200, { ok: true, self: this.runtime.self })
              }
              if (action === 'search') {
                const results = await this.runtime.messageStore.search(String(body.keyword ?? ''))
                return json(res, 200, { ok: true, results })
              }
              if (action === 'recall') {
                this.runtime.messaging.recallMessage(String(body.id ?? ''))
                return json(res, 200, { ok: true })
              }
              if (action === 'edit') {
                this.runtime.messaging.editMessage(String(body.id ?? ''), String(body.body ?? ''))
                return json(res, 200, { ok: true })
              }
              if (action === 'createChannel') {
                const channel = this.runtime.channelRegistry.create(String(body.name ?? ''), body.kind === 'private' ? 'private' : 'public', typeof body.description === 'string' ? body.description : undefined)
                return json(res, 200, { ok: true, channel, channels: this.runtime.channelRegistry.list() })
              }
              if (action === 'renameChannel') {
                const channel = this.runtime.channelRegistry.rename(String(body.id ?? ''), String(body.name ?? ''), typeof body.description === 'string' ? body.description : undefined)
                return json(res, 200, { ok: true, channel, channels: this.runtime.channelRegistry.list() })
              }
              if (action === 'deleteChannel') {
                this.runtime.channelRegistry.remove(String(body.id ?? ''))
                return json(res, 200, { ok: true, channels: this.runtime.channelRegistry.list() })
              }
              if (action === 'joinChannel') {
                this.runtime.channelRegistry.join(String(body.id ?? ''))
                return json(res, 200, { ok: true, channels: this.runtime.channelRegistry.list() })
              }
              if (action === 'leaveChannel') {
                this.runtime.channelRegistry.leave(String(body.id ?? ''))
                return json(res, 200, { ok: true, channels: this.runtime.channelRegistry.list() })
              }
              if (action === 'inviteChannelMember') {
                this.runtime.channelRegistry.invite(String(body.channelId ?? ''), String(body.accountId ?? ''))
                return json(res, 200, { ok: true, channels: this.runtime.channelRegistry.list() })
              }
              if (action === 'removeChannelMember') {
                this.runtime.channelRegistry.removeMember(String(body.channelId ?? ''), String(body.accountId ?? ''))
                return json(res, 200, { ok: true, channels: this.runtime.channelRegistry.list() })
              }
              if (action === 'removeSharedFile') {
                await this.runtime.sharedFileStore.remove(String(body.id ?? ''))
                return json(res, 200, { ok: true, sharedFiles: this.runtime.sharedFileStore.list() })
              }
            }
            json(res, 200, {
              ok: true,
              self: this.runtime.self,
              peers: this.runtime.peerNetwork.peersSnapshot(),
              channels: this.runtime.channelRegistry.list(),
              messages: this.runtime.messageStore.messages.slice(-HISTORY_LIMIT),
              sharedFiles: this.runtime.sharedFileStore.list(),
              log: this.runtime.clients.log,
            })
          } catch (err: any) {
            json(res, 200, { ok: false, error: err?.message ?? String(err) })
          }
        },
      }))
    }
    return () => {
      for (const d of disposers) {
        try { d() } catch { /* 忽略 */ }
      }
    }
  }

  closeClients(): void {
    try { this.clientWss?.close() } catch { /* 忽略 */ }
    this.clientWss = undefined
  }
}
