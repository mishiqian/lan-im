import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { readFile } from 'node:fs/promises'
import { WebSocketServer } from 'ws'
import { API_ROUTE, HISTORY_LIMIT, WS_PATH } from '../protocol.ts'
import type { HostRuntime } from './runtime.ts'
import { json, readBody } from './util.ts'
import { ClientBridge } from './client-bridge.ts'
import { buildAgentPackage, listBasePresets } from './agent-build.ts'

/** 1.0.0 → 1.0.1；非 semver 时退回 1.0.0 */
function nextPatch(version: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  if (m === null) return '1.0.0'
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`
}

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
const corsPreflight = (req: IncomingMessage, res: ServerResponse): boolean => {
  if (req.method !== 'OPTIONS') return false
  res.writeHead(204, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
  })
  res.end()
  return true
}

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
              if (action === 'info') {
                // 客户端在 dsh-app:// 里拿不到 http origin，这里用请求的 Host 回推
                return json(res, 200, { ok: true, host: req.headers.host ?? '', action, version: this.runtime.pluginVersion })
              }
              if (action === 'agent.list') {
                return json(res, 200, { ok: true, agents: this.runtime.agents.list(), installed: this.runtime.agents.installedList() })
              }
              if (action === 'agent.bases') {
                return json(res, 200, { ok: true, bases: await listBasePresets(this.runtime.presetsRoot) })
              }
              if (action === 'agent.publish') {
                const editId = typeof body.id === 'string' && body.id !== '' ? body.id : undefined
                const existing = editId === undefined ? undefined : this.runtime.agents.myAgents().find((c) => c.id === editId)
                if (editId !== undefined && existing === undefined) {
                  return json(res, 200, { ok: false, errors: [{ field: 'id', message: '要编辑的 agent 不存在' }] })
                }
                const built = await buildAgentPackage({
                  presetsDir: this.runtime.presetsRoot,
                  base: String(body.base ?? ''),
                  accountId: this.runtime.self.accountId,
                  ...(existing === undefined ? {} : { id: existing.id, version: nextPatch(existing.version) }),
                  name: String(body.name ?? ''),
                  prompt: String(body.prompt ?? ''),
                  summary: typeof body.summary === 'string' ? body.summary : undefined,
                  tools: Array.isArray(body.tools) ? body.tools : [],
                  cloneable: body.cloneable !== false,
                  callable: body.callable === true,
                  sampleIn: typeof body.sampleIn === 'string' ? body.sampleIn : '',
                  sampleOut: typeof body.sampleOut === 'string' ? body.sampleOut : '',
                })
                if (!built.ok || built.card === undefined || built.files === undefined) {
                  return json(res, 200, { ok: false, errors: built.errors })
                }
                const result = await this.runtime.agents.publish(built.card, built.files)
                return json(res, 200, result.ok ? { ok: true, card: result.card } : { ok: false, errors: result.errors })
              }
              if (action === 'agent.unpublish') {
                return json(res, 200, { ok: await this.runtime.agents.unpublish(String(body.id ?? '')) })
              }
              if (action === 'agent.fetch') {
                const pkg = await this.runtime.fetchAgentPackage(String(body.account ?? ''), String(body.id ?? ''))
                return json(res, 200, pkg === undefined ? { ok: false, error: '对端不在线或没有这个包' } : { ok: true, pkg })
              }
              if (action === 'agent.install') {
                const result = await this.runtime.agentInstaller.install(body.pkg)
                return json(res, 200, result.ok
                  ? { ok: true, record: result.record, restartRequired: result.restartRequired === true }
                  : { ok: false, errors: result.errors })
              }
              if (action === 'agent.uninstall') {
                const done = await this.runtime.agentInstaller.uninstall(String(body.account ?? ''), String(body.id ?? ''))
                return json(res, 200, { ok: done })
              }
              if (action === 'agent.serve.open') {
                const r = await this.runtime.agentService.open({
                  callerId: String(body.caller ?? this.runtime.self.accountId),
                  agentKey: String(body.agent ?? ''),
                  preset: typeof body.preset === 'string' ? body.preset : undefined,
                  provider: typeof body.provider === 'string' ? body.provider : undefined,
                  model: typeof body.model === 'string' ? body.model : undefined,
                  prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
                  tools: Array.isArray(body.tools) ? body.tools : [],
                  budget: typeof body.budget === 'object' && body.budget !== null ? body.budget : undefined,
                })
                return json(res, 200, r)
              }
              if (action === 'agent.serve.send') {
                const r = await this.runtime.agentService.send(String(body.sessionId ?? ''), String(body.text ?? ''))
                return json(res, 200, r)
              }
              if (action === 'agent.serve.close') {
                return json(res, 200, { ok: await this.runtime.agentService.close(String(body.sessionId ?? '')) })
              }
              if (action === 'agent.remote.open') {
                return json(res, 200, await this.runtime.remoteAgentOpen(String(body.account ?? ''), String(body.agentId ?? '')))
              }
              if (action === 'agent.remote.send') {
                return json(res, 200, await this.runtime.remoteAgentSend(String(body.account ?? ''), String(body.sessionId ?? ''), String(body.text ?? '')))
              }
              if (action === 'agent.remote.close') {
                const owner = String(body.account ?? '')
                const peer = this.runtime.peerNetwork.peersSnapshot().find((p) => p.accountId === owner)
                if (peer === undefined) {
                  this.runtime.clients.logEvent(`关闭会话失败：@${owner} 不在线`)
                  return json(res, 200, { ok: false, error: `@${owner} 不在线` })
                }
                this.runtime.peerNetwork.sendWire(peer.nodeId, { t: 'agentClose', sessionId: String(body.sessionId ?? '') })
                return json(res, 200, { ok: true })
              }
              if (action === 'agent.serve.list') {
                return json(res, 200, { ok: true, sessions: this.runtime.agentService.list() })
              }
              if (action === 'log') {
                this.runtime.clients.logEvent(String(body.message ?? '').slice(0, 300))
                return json(res, 200, { ok: true })
              }
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
              agents: this.runtime.agents.list(),
              sessions: this.runtime.agentService.list().slice(-50),
              identity: { keyId: this.runtime.keyId, observed: this.runtime.identityObserved, pins: this.runtime.trust.list().length },
              host: { version: this.runtime.pluginVersion },
              clients: this.runtime.clients.count,
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
