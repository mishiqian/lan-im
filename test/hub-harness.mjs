/**
 * 测试用的枢纽进程管理：起一个真实 hub（同一份实现），拿到端口，测完关掉。
 */
import { createServer } from 'node:net'

export async function freePort() {
  return await new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

export async function startHub(port) {
  const { createHub } = await import('../hub/src/server.mjs')
  const hub = createHub({ hubId: 'test-hub' })
  await hub.listen(port, '127.0.0.1')
  return {
    hub,
    async stop() {
      await hub.close()
    },
  }
}

export async function waitFor(predicate, timeoutMs = 5000, stepMs = 25) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((r) => setTimeout(r, stepMs))
  }
  throw new Error('等待超时')
}
