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
import { randomBytes } from 'node:crypto'
import { createHub } from '../src/server.mjs'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}

const port = Number(arg('port', '8787'))
const host = arg('host', '0.0.0.0')
const dataDir = arg('data', './hub-data')
const hubId = arg('id', 'localhost')

mkdirSync(dataDir, { recursive: true })

// 邀请码：首次生成并落盘，之后复用
const inviteFile = join(dataDir, 'invites.json')
let invites = []
if (existsSync(inviteFile)) {
  invites = JSON.parse(readFileSync(inviteFile, 'utf8'))
} else {
  const code = randomBytes(6).toString('base64url').toUpperCase().match(/.{1,4}/g).slice(0, 3).join('-')
  invites = [code]
  writeFileSync(inviteFile, JSON.stringify(invites, null, 2), { mode: 0o600 })
}

// 自签证书：没有就生成（局域网 wss 需要）
const certFile = join(dataDir, 'hub.crt')
const keyFile = join(dataDir, 'hub.key')
let tls = null
if (!existsSync(certFile)) {
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
} else {
  tls = { key: readFileSync(keyFile), cert: readFileSync(certFile) }
}

const hub = createHub({
  hubId,
  invites,
  ...(tls === null ? {} : { tls }),
  onLog: (line) => console.log(`[${new Date().toISOString()}] ${line}`),
})

hub.listen(port, host).then(({ port: actual }) => {
  console.log('')
  console.log('lan-im 枢纽已启动')
  console.log(`  地址      ${tls === null ? 'ws' : 'wss'}://${host === '0.0.0.0' ? '<本机IP>' : host}:${actual}`)
  console.log(`  健康检查  http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actual}/health`)
  console.log(`  管理接口  http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actual}/admin/nodes`)
  console.log(`  邀请码    ${invites.join(', ')}`)
  console.log(`  数据目录  ${dataDir}`)
  if (tls !== null) console.log('  证书      已生成（自签，生产建议前置反向代理套 TLS）')
  console.log('')
})
