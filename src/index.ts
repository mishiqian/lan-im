/**
 * 局域网即时通信（lan-im）宿主入口 v5。
 *
 * 该文件只做插件注册与生命周期接线，所有业务逻辑按领域拆分在 src/host/ 下：
 * - protocol.ts        共享协议、常量和类型
 * - host/runtime.ts    组合根 + 启动/停止编排
 * - host/storage.ts    数据目录 / 配置 / 历史 / outbox 落盘
 * - host/channel-registry.ts  频道模型
 * - host/message-store.ts     实时消息窗口 + 历史回放/搜索
 * - host/outbox.ts            私聊离线补发队列
 * - host/peer-network.ts      节点间 WebSocket 连接与 wire 协议
 * - host/discovery.ts         mDNS + UDP 节点发现
 * - host/messaging.ts         发送/撤回/编辑
 * - host/file-transfer.ts     消息附件分片传输
 * - host/shared-file-store.ts 频道共享文件索引 + 按需拉取/缓存
 * - host/client-bridge.ts     浏览器客户端 WS 桥
 * - host/http-gateway.ts      REST API + 文件下载 + WS 升级
 */
import { HostRuntime } from './host/runtime.ts'
import type { WebServer } from './host/http-gateway.ts'

export const inject = ['webServer']

export function apply(ctx: any): void {
  const runtime = new HostRuntime()

  ctx.effect(() => {
    runtime.stopped = false
    void runtime.start().catch((err: any) => runtime.clients.logEvent(`启动失败: ${err?.message ?? err}`))
    return () => {
      runtime.stopped = true
      runtime.stop()
    }
  }, 'lan-im: discovery + messaging')

  ctx.effect(() => {
    const webServer = ctx.get('webServer') as WebServer | undefined
    if (webServer === undefined) return
    const dispose = runtime.gateway.register(webServer)
    return () => dispose()
  }, 'lan-im: web routes')
}
