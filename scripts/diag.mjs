/**
 * lan-im 网络诊断：扫描局域网上的 lan-im 节点（mDNS）。
 * 运行：node scripts/diag.mjs   （默认扫描 10 秒）
 *
 * 若一个节点都扫不到：
 *   1) 确认对方机器的插件在运行；
 *   2) 检查双方防火墙是否放行 UDP 5353（mDNS 组播，地址 224.0.0.251）；
 *   3) 确认两台机器在同一局域网/同一子网，且组播未被交换机/AP 隔离。
 */
import Bonjour from 'bonjour-service'

const bonjour = new Bonjour()
const seen = new Set()

const browser = bonjour.find({ type: 'lanim', protocol: 'tcp' })
browser.on('up', (service) => {
  const nodeId = service?.txt?.nodeId ?? String(service?.name ?? '')
  if (seen.has(nodeId)) return
  seen.add(nodeId)
  const name = service?.txt?.name ?? nodeId.slice(0, 6)
  const addr = service?.addresses?.[0] ?? service?.referer?.address ?? '?'
  console.log(`[发现] ${name}  nodeId=${nodeId.slice(0, 8)}  ${addr}:${service.port}`)
})

console.log('正在扫描 _lanim._tcp.local …（10 秒后退出）')
setTimeout(() => {
  console.log(seen.size === 0 ? '\n未发现任何节点' : `\n共发现 ${seen.size} 个节点`)
  try { browser.stop() } catch { /* 忽略 */ }
  try { bonjour.destroy() } catch { /* 忽略 */ }
  process.exit(0)
}, 10000)
