/**
 * 一键起枢纽：由插件托管一个本机 hub 子进程。
 *
 * 只做“把独立枢纽的启动过程自动化”——协议、数据、管理页与外部部署完全一致。
 * 随时可以把托管关掉，换成 docker/别处的枢纽，客户端只改地址。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createConnection, createServer } from 'node:net'
import { request } from 'node:http'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface ManagedHub {
  running: boolean
  url?: string
  invite?: string
  pid?: number
  error?: string
  /** 管理页地址（含令牌），方便用户直接打开 */
  adminUrl?: string
}

/** 从当前模块往上找 hub/bin（源码树、lib/types 产物、软链安装都能命中） */
function locateHubEntry(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, 'hub', 'bin', 'lanim-hub.mjs')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return ''
}

const HUB_ENTRY = locateHubEntry()

/** 先试连（有人监听就跳过），再试绑定（确保能占住）——只看绑定会被 127.0.0.1 上的服务骗过 */
async function freePort(start = 8787, end = 8799): Promise<number> {
  for (let port = start; port <= end; port += 1) {
    const inUse = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ port, host: '127.0.0.1' })
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => { socket.destroy(); resolve(false) })
      setTimeout(() => { socket.destroy(); resolve(false) }, 250)
    })
    if (inUse) continue
    const bindable = await new Promise<boolean>((resolve) => {
      const srv = createServer()
      srv.once('error', () => resolve(false))
      srv.listen(port, '0.0.0.0', () => srv.close(() => resolve(true)))
    })
    if (bindable) return port
  }
  throw new Error(`端口 ${start}-${end} 都被占用`)
}

/** 等到端口可连接（枢纽已开始监听） */
/** 用 /health 确认这个端口上跑的确实是我们的枢纽（别人占了 8787 时不能误判） */
async function confirmHub(port: number, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = request({ host: '127.0.0.1', port, path: '/health', timeout: 800 }, (res) => {
        let body = ''
        res.on('data', (chunk) => { body += String(chunk) })
        res.on('end', () => {
          try {
            const data = JSON.parse(body) as { hubId?: unknown; nodes?: unknown }
            resolve(data.hubId !== undefined && data.nodes !== undefined)
          } catch { resolve(false) }
        })
      })
      req.on('error', () => resolve(false))
      req.on('timeout', () => { req.destroy(); resolve(false) })
      req.end()
    })
    if (ok) return true
    await new Promise((r) => setTimeout(r, 150))
  }
  return false
}

/** 等到端口能连上（说明枢纽已经监听） */
async function waitPort(port: number, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const up = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ port, host: '127.0.0.1' })
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => { socket.destroy(); resolve(false) })
      setTimeout(() => { socket.destroy(); resolve(false) }, 300)
    })
    if (up) return true
    await new Promise((r) => setTimeout(r, 150))
  }
  return false
}

export class HubLauncher {
  private child: ChildProcess | undefined
  private info: ManagedHub = { running: false }

  status(): ManagedHub {
    return { ...this.info }
  }

  async start(dataRoot: string, lanIp: string): Promise<ManagedHub> {
    if (this.child !== undefined) return this.status()
    if (!existsSync(HUB_ENTRY)) {
      this.info = { running: false, error: `找不到枢纽入口：${HUB_ENTRY}` }
      return this.status()
    }
    const dataDir = join(dataRoot, 'hub')
    mkdirSync(dataDir, { recursive: true })
    let port: number
    try {
      port = await freePort()
    } catch (err: any) {
      this.info = { running: false, error: String(err?.message ?? err) }
      return this.status()
    }
    const invite = randomBytes(6).toString('base64url').toUpperCase().match(/.{1,4}/g)?.slice(0, 3).join('-') ?? ''
    // 托管枢纽的管理令牌由插件生成，方便把管理页地址直接写进日志
    const adminToken = randomBytes(16).toString('hex')
    const child = spawn(process.execPath, [
      HUB_ENTRY, '--port', String(port), '--host', '0.0.0.0', '--data', dataDir,
      ...(invite === '' ? [] : ['--invite', invite]),
      '--admin-token', adminToken,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })

    let stderr = ''
    child.stdout?.on('data', () => { /* 丢掉，避免管道写满阻塞 */ })
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    child.on('exit', (code) => {
      if (this.child !== child) return
      this.child = undefined
      this.info = { running: false, error: `枢纽已退出（code ${code}）${stderr.slice(0, 200)}` }
    })

    const up = await waitPort(port) && await confirmHub(port)
    if (!up) {
      try { child.kill() } catch { /* 忽略 */ }
      this.info = { running: false, error: '枢纽启动超时' }
      return this.status()
    }
    this.child = child
    this.info = {
      running: true,
      url: `ws://${lanIp}:${port}/hlp`,
      invite,
      pid: child.pid,
      adminUrl: `http://${lanIp}:${port}/admin?token=${adminToken}`,
    }
    return this.status()
  }

  stop(): void {
    if (this.child === undefined) return
    try { this.child.kill() } catch { /* 忽略 */ }
    this.child = undefined
    this.info = { running: false }
  }
}
