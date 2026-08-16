import { createHash, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'

export function lanIp(): string {
  const interfaces = networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const info of interfaces[name] ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue
      return info.address
    }
  }
  return '127.0.0.1'
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

export async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += value.length
    if (size > 1024 * 1024) throw new Error('request body is too large')
    chunks.push(value)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex')
}

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomUUID()
  return { hash: sha256(salt + password), salt }
}

export function pskIdFor(psk: string): string {
  return psk === '' ? '' : sha256(psk)
}

export function sanitizeFilename(name: string): string {
  return String(name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'file'
}

/** 由旧频道名生成稳定 UUID（迁移兼容：所有节点会得到相同 id）。 */
export function legacyChannelId(name: string): string {
  const hex = sha256(`lan-im:legacy-channel:${name}`)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${(parseInt(hex.slice(16, 17), 16) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
