#!/usr/bin/env node
/**
 * lanim-hub 命令行入口：一条命令起枢纽。
 *
 *   npx @mishijian/lanim-hub --port 8787 --data ./hub-data
 *
 * 首次启动会生成邀请码与自签证书，并打印接入信息。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { X509Certificate, randomBytes } from 'node:crypto'
import { hostname } from 'node:os'
import { createHub } from '../src/server.mjs'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}

const port = Number(arg('port', '8787'))
const host = arg('host', '0.0.0.0')
const dataDir = arg('data', './hub-data')
const hubId = arg('id', process.env.LANIM_HUB_ID ?? hostname() ?? 'localhost')

mkdirSync(dataDir, { recursive: true })

// 邀请码：首次生成并落盘，之后复用
const inviteFile = join(dataDir, 'invites.json')
const forcedInvite = arg('invite', '')
let invites = []
if (forcedInvite !== '') {
  // 显式指定时以它为准（调用方需要知道邀请码）
  invites = [forcedInvite]
  writeFileSync(inviteFile, JSON.stringify(invites, null, 2), { mode: 0o600 })
} else if (existsSync(inviteFile)) {
  invites = JSON.parse(readFileSync(inviteFile, 'utf8'))
} else {
  const code = randomBytes(6).toString('base64url').toUpperCase().match(/.{1,4}/g).slice(0, 3).join('-')
  invites = [code]
  writeFileSync(inviteFile, JSON.stringify(invites, null, 2), { mode: 0o600 })
}

// 自签证书：只有显式 --tls 时才生成/使用（默认明文，生产建议前置反向代理）
const wantTls = args.includes('--tls') || arg('tls-cert', '') !== ''
const certFile = arg('tls-cert', join(dataDir, 'hub.crt'))
const keyFile = arg('tls-key', join(dataDir, 'hub.key'))
let tls = null
let fingerprint = ''
if (wantTls && !existsSync(certFile)) {
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825',
      '-keyout', keyFile, '-out', certFile,
      '-subj', `/CN=${hubId}`, '-addext', `subjectAltName=DNS:${hubId},IP:127.0.0.1`,
    ], { stdio: 'ignore' })
    tls = { key: readFileSync(keyFile), cert: readFileSync(certFile) }
  } catch {
    console.warn('未找到 openssl，本次以明文 ws 启动（仅建议内网/本机使用）')
  }
} else if (wantTls) {
  tls = { key: readFileSync(keyFile), cert: readFileSync(certFile) }
}
if (tls !== null) {
  // 客户端要用它做指纹钉住（TOFU）
  const x509 = new X509Certificate(tls.cert)
  fingerprint = x509.fingerprint256.replace(/:/g, '').toLowerCase()
}

// 封禁名单：落盘在数据目录
const blockedFile = join(dataDir, 'blocked.json')
const blocked = existsSync(blockedFile) ? JSON.parse(readFileSync(blockedFile, 'utf8')) : []

// 管理令牌：显式指定或自动生成，启动时打印
const adminToken = arg('admin-token', randomBytes(16).toString('hex'))

const hub = createHub({
  hubId,
  invites,
  blocked,
  adminToken,
  msgPerSec: Number(arg('msg-per-sec', '50')),
  bytesPerSec: Number(arg('bytes-per-sec', String(4 * 1024 * 1024))),
  onBlockedChange: (list) => {
    try { writeFileSync(blockedFile, JSON.stringify(list, null, 2), { mode: 0o600 }) } catch { /* 忽略 */ }
  },
  ...(tls === null ? {} : { tls }),
  onLog: (line) => console.log(`[${new Date().toISOString()}] ${line}`),
})

hub.listen(port, host).then(({ port: actual }) => {
  console.log('')
  console.log('lan-im 枢纽已启动')
  console.log(`  地址      ${tls === null ? 'ws' : 'wss'}://${host === '0.0.0.0' ? '<本机IP>' : host}:${actual}`)
  console.log(`  健康检查  http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actual}/health`)
  console.log(`  管理页    http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actual}/admin?token=${adminToken}`)
  console.log(`  邀请码    ${invites.join(', ')}`)
  console.log(`  数据目录  ${dataDir}`)
  console.log(`  封禁节点  ${blocked.length} 个（POST /admin/block 添加）`)
  console.log(`  限流      每节点 ${arg('msg-per-sec', '50')} 条/秒，${Math.round(Number(arg('bytes-per-sec', String(4 * 1024 * 1024))) / 1024)} KB/秒`)
  if (tls !== null) {
    console.log('  传输      TLS（自签或指定证书）')
    console.log(`  证书指纹  ${fingerprint}`)
    console.log('            客户端首次连接会显示这个指纹，确认一次即可钉住')
  }
  else console.log('  传输      明文 ws（仅内网/本机；公网请用反向代理套 TLS）')
  console.log('')
})

process.on('unhandledRejection', (err) => {
  console.error(`枢纽启动失败：${err?.message ?? err}`)
  process.exit(1)
})
