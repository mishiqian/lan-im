/**
 * lan-im v2 端到端自测的子进程 runner：独立 DSH_HOME，起一个宿主实例，
 * 把 HTTP 调试端点与 WebSocket 升级桥接到真实 HTTP 端口供协调器访问。
 * 由 scripts/e2e.mjs 拉起，不单独运行。
 */
import { createServer } from 'node:http'

process.env.DSH_HOME = process.env.DATA_DIR
const CONTROL_PORT = Number(process.env.CONTROL_PORT)
const WS_PATH = '/lan-im/ws'

const { apply } = await import('../lib/index.js')

const routes = []
let upgradeHandler = null
const ctx = {
  get(name) {
    if (name === 'webServer') {
      return {
        register(route) { routes.push(route); return () => { const i = routes.indexOf(route); if (i >= 0) routes.splice(i, 1) } },
        registerUpgrade(route) { upgradeHandler = route.handler; return () => {} },
      }
    }
    return undefined
  },
  effect(cb) { cb() },
}
apply(ctx)

const server = createServer(async (req, res) => {
  const pathname = (req.url ?? '/').split('?')[0]
  const route = routes.find((r) => r.kind === 'exact' && pathname === r.path)
    ?? routes.find((r) => r.kind === 'prefix' && pathname.startsWith(r.path))
  if (route === undefined) { res.writeHead(404); res.end('no route'); return }
  const chunks = []
  for await (const c of req) chunks.push(c)
  const body = Buffer.concat(chunks)
  const wrapped = {
    method: req.method,
    url: req.url,
    async *[Symbol.asyncIterator]() { if (body.length > 0) yield body },
  }
  const wrappedRes = {
    writeHead(s, h) { res.writeHead(s, h) },
    end(b) { res.end(b) },
  }
  try {
    await route.handler(wrapped, wrappedRes)
  } catch (err) {
    if (!res.headersSent) { res.writeHead(500); res.end(String(err)) }
  }
})

server.on('upgrade', (req, socket, head) => {
  if (upgradeHandler !== null && (req.url ?? '').startsWith(WS_PATH)) {
    upgradeHandler(req, socket, head)
  } else {
    socket.destroy()
  }
})

server.listen(CONTROL_PORT, () => console.log('READY'))
