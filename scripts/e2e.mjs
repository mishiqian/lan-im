/**
 * lan-im v5 端到端自测：账号 → 发现 → 频道/私聊 → 送达确认 → 撤回/编辑 → 搜索
 * → UUID 频道/重命名/解散 → 私有频道成员路由 → 文件传输 → 局域网网盘按需拉取
 * → 离线补发 → PSK → 落盘。
 * 运行：node scripts/e2e.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'

const NODE_PATH = fileURLToPath(new URL('./e2e-node.mjs', import.meta.url))
const WS_PATH = '/lan-im/ws'

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
  if (!ok) failures++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function start(name, dir, port) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [NODE_PATH], {
      env: { ...process.env, CONTROL_PORT: String(port), DATA_DIR: dir },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (d) => { if (String(d).includes('READY')) resolve(child) })
    child.stderr.on('data', (d) => process.stderr.write(`[${name}] ${String(d)}`))
    child.on('exit', (code) => { if (code !== 0) console.error(`[${name}] 退出码 ${code}`) })
  })
}
async function get(port) { const res = await fetch(`http://127.0.0.1:${port}/lan-im/api`); return res.json() }
async function post(port, body) {
  const res = await fetch(`http://127.0.0.1:${port}/lan-im/api`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return res.json()
}
async function waitFor(cond, ms, step = 200) {
  const end = Date.now() + ms
  while (Date.now() < end) { const v = await cond(); if (v) return v; await sleep(step) }
  return null
}
const findChannel = (state, name) => (state?.channels ?? []).find((c) => c.name === name)
function connectWs(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`)
  const queue = []
  const waiters = []
  ws.on('message', (d) => {
    const msg = JSON.parse(String(d))
    const idx = waiters.findIndex((w) => w.pred(msg))
    if (idx >= 0) { const w = waiters.splice(idx, 1)[0]; w.resolve(msg) } else queue.push(msg)
  })
  return {
    ws,
    send(obj) { ws.send(JSON.stringify(obj)) },
    async next(pred, ms = 5000) {
      const idx = queue.findIndex((m) => pred(m))
      if (idx >= 0) return queue.splice(idx, 1)[0]
      return new Promise((resolve, reject) => {
        const w = { pred, resolve }
        waiters.push(w)
        setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(new Error('等待超时')) } }, ms)
      })
    },
    close() { ws.close() },
  }
}

const base = mkdtempSync(join(tmpdir(), 'lan-im-v5-'))
const dirA = join(base, 'a')
const dirB = join(base, 'b')
const PORT_A = 31401
const PORT_B = 31402
const PORT_B2 = 31403

let a = await start('A', dirA, PORT_A)
let b = await start('B', dirB, PORT_B)
console.log('两实例已就绪')

// 1) 账号
await post(PORT_A, { action: 'setupAccount', username: 'alice', displayName: 'Alice' })
await post(PORT_B, { action: 'setupAccount', username: 'bob', displayName: 'Bob' })
const sa = await get(PORT_A)
check('A 账号设置', sa.self?.accountId === 'alice')
await post(PORT_A, { action: 'setPassword', password: 'local-pass-1' })
const saPwd = await get(PORT_A)
check('个人中心密码设置', saPwd.self?.hasPassword === true)

// 2) 发现
const discovered = await waitFor(async () => {
  const ra = await get(PORT_A)
  return ra.peers?.some((p) => p.accountId === 'bob') ? ra : null
}, 15000)
check('发现对端', !!discovered)

// 3) 公共频道消息
await post(PORT_A, { action: 'send', to: '*', toType: 'channel', body: 'hello group' })
const gotGroup = await waitFor(async () => (await get(PORT_B)).messages?.some((m) => m.body === 'hello group'), 5000)
check('公共频道消息到达 B', !!gotGroup)

// 4) 私聊 + 送达确认
const priv = await post(PORT_A, { action: 'send', to: 'bob', toType: 'account', body: 'hello private' })
const gotPriv = await waitFor(async () => (await get(PORT_B)).messages?.some((m) => m.body === 'hello private'), 5000)
check('私聊到达 B', !!gotPriv)
const delivered = await waitFor(async () => {
  const ra = await get(PORT_A)
  return ra.messages?.find((m) => m.id === priv.message.id)?.status === 'delivered'
}, 5000)
check('送达确认（已送达）', !!delivered)

// 5) 撤回
const r1 = await post(PORT_A, { action: 'send', to: 'bob', toType: 'account', body: 'to recall' })
await post(PORT_A, { action: 'recall', id: r1.message.id })
const recalledA = await waitFor(async () => (await get(PORT_A)).messages?.find((m) => m.id === r1.message.id)?.recalled === true, 5000)
const recalledB = await waitFor(async () => (await get(PORT_B)).messages?.find((m) => m.id === r1.message.id)?.recalled === true, 5000)
check('撤回同步（A 与 B）', !!recalledA && !!recalledB)

// 6) 编辑
const r2 = await post(PORT_A, { action: 'send', to: 'bob', toType: 'account', body: 'before' })
await post(PORT_A, { action: 'edit', id: r2.message.id, body: 'after edit' })
const editedB = await waitFor(async () => {
  const m = (await get(PORT_B)).messages?.find((x) => x.id === r2.message.id)
  return m?.body === 'after edit' && m?.edited === true
}, 5000)
check('编辑同步到 B', !!editedB)

// 7) 搜索
await post(PORT_A, { action: 'send', to: '*', toType: 'channel', body: 'unique-xyz-789' })
const sr = await waitFor(async () => {
  const r = await post(PORT_A, { action: 'search', keyword: 'unique-xyz' })
  return r.results?.length > 0 ? r : null
}, 5000)
check('搜索历史命中', !!sr && sr.results.some((m) => m.body.includes('unique-xyz')))

// 8) 旧式命名频道兼容：发消息自动补建 UUID 频道，名字仍为 ops
await post(PORT_A, { action: 'send', to: 'ops', toType: 'channel', body: 'ops channel' })
const chanSync = await waitFor(async () => {
  const ra = await get(PORT_A)
  const rb = await get(PORT_B)
  const ca = findChannel(ra, 'ops')
  const cb = findChannel(rb, 'ops')
  return ca && cb && ca.id === cb.id && !ca.id.includes('ops') && rb.messages?.some((m) => m.body === 'ops channel') ? { ca, cb } : null
}, 8000)
check('旧频道名迁移为 UUID 并同步', !!chanSync)

// 8b) 显式创建公开频道 + 同步 + 离开
const dev = await post(PORT_A, { action: 'createChannel', name: 'dev', kind: 'public', description: 'dev room' })
const devId = dev.channel?.id
check('创建公开频道返回 UUID', typeof devId === 'string' && devId !== 'dev')
const chanSync2 = await waitFor(async () => {
  const rb = await get(PORT_B)
  const c = rb.channels?.find((x) => x.id === devId)
  return c?.name === 'dev' && c.description === 'dev room'
}, 8000)
check('公开频道元数据同步到 B', !!chanSync2)
await post(PORT_A, { action: 'leaveChannel', id: devId })
const left = await waitFor(async () => {
  const ra = await get(PORT_A)
  const c = ra.channels?.find((x) => x.id === devId)
  return c?.joined === false
}, 3000)
check('离开公开频道（本地隐藏）', !!left)
await post(PORT_A, { action: 'joinChannel', id: devId })
const joined = await waitFor(async () => {
  const ra = await get(PORT_A)
  const c = ra.channels?.find((x) => x.id === devId)
  return c !== undefined && c.joined !== false
}, 3000)
check('重新加入公开频道', !!joined)

// 8c) 重命名 + 描述 + 解散（创建者权威）
const docs = await post(PORT_A, { action: 'createChannel', name: 'docs', kind: 'public' })
const docsId = docs.channel?.id
await post(PORT_A, { action: 'renameChannel', id: docsId, name: 'docs-v2', description: 'new desc' })
const renamed = await waitFor(async () => {
  const rb = await get(PORT_B)
  const c = rb.channels?.find((x) => x.id === docsId)
  return c?.name === 'docs-v2' && c.description === 'new desc'
}, 8000)
check('频道重命名/描述同步到 B', !!renamed)
await post(PORT_A, { action: 'deleteChannel', id: docsId })
const dissolved = await waitFor(async () => !(await get(PORT_B)).channels?.some((c) => c.id === docsId), 8000)
check('频道解散同步到 B', !!dissolved)

// 9) 普通文件传输（消息附件，仍保留）
const wa = connectWs(PORT_A)
const wb = connectWs(PORT_B)
await wa.next((m) => m.t === 'snapshot')
await wb.next((m) => m.t === 'snapshot')
const fileContent = 'hello file content'
wa.send({ t: 'fileStart', uploadId: 'f1', name: 'note.txt', size: fileContent.length, mime: 'text/plain', to: '*', toType: 'channel' })
wa.send({ t: 'fileChunk', uploadId: 'f1', seq: 0, data: Buffer.from(fileContent).toString('base64') })
wa.send({ t: 'fileEnd', uploadId: 'f1' })
const fileEvt = await wb.next((m) => m.t === 'file', 8000).catch(() => null)
check('消息附件到达 B', !!fileEvt && fileEvt.file?.name === 'note.txt')

// 9b) 经 ws 桥创建频道（浏览器路径）
wa.send({ t: 'createChannel', name: 'wschan', kind: 'public' })
const wsChan = await wa.next((m) => m.t === 'channels' && (m.channels ?? []).some((c) => c.name === 'wschan'), 5000).catch(() => null)
check('经 ws 桥创建频道', !!wsChan)

// 9c) 私有频道：仅成员可见，创建者邀请/移除成员，消息按成员路由
const secret = await post(PORT_A, { action: 'createChannel', name: 'secret', kind: 'private' })
const secretId = secret.channel?.id
check('创建私有频道返回 UUID 且仅含创建者', secret.channel?.kind === 'private' && secret.channel.members?.length === 1)
await sleep(800)
check('非成员看不到私有频道', !(await get(PORT_B)).channels?.some((c) => c.id === secretId))
await post(PORT_A, { action: 'inviteChannelMember', channelId: secretId, accountId: 'Bob' })
const invited = await waitFor(async () => {
  const rb = await get(PORT_B)
  const c = rb.channels?.find((x) => x.id === secretId)
  return c?.kind === 'private' && c.members?.includes('bob')
}, 8000)
check('私有频道邀请 bob', !!invited)
await post(PORT_A, { action: 'send', to: secretId, toType: 'channel', body: 'secret hello' })
const gotSecret = await waitFor(async () => (await get(PORT_B)).messages?.some((m) => m.body === 'secret hello' && m.to === secretId), 5000)
check('私有频道消息到达成员', !!gotSecret)
await post(PORT_A, { action: 'removeChannelMember', channelId: secretId, accountId: 'bob' })
const removed = await waitFor(async () => !(await get(PORT_B)).channels?.some((c) => c.id === secretId), 8000)
check('移除成员后 bob 本地频道消失', !!removed)
await post(PORT_A, { action: 'send', to: secretId, toType: 'channel', body: 'should not arrive' })
await sleep(1200)
const notArrived = !(await get(PORT_B)).messages?.some((m) => m.body === 'should not arrive')
check('非成员收不到私有频道消息', notArrived)
await post(PORT_A, { action: 'inviteChannelMember', channelId: secretId, accountId: 'bob' })
const reinvited = await waitFor(async () => (await get(PORT_B)).channels?.some((c) => c.id === secretId && c.members?.includes('bob')), 8000)
check('重新邀请后频道恢复', !!reinvited)
await post(PORT_A, { action: 'leaveChannel', id: secretId })
const ownershipMoved = await waitFor(async () => {
  const rb = await get(PORT_B)
  const c = rb.channels?.find((x) => x.id === secretId)
  return c?.createdBy === 'bob' && !c.members?.includes('alice')
}, 8000)
check('创建者退出私有频道并转移所有权', !!ownershipMoved)

// 9d) 局域网网盘：上传索引广播 → B 按需拉取 → 删除同步
const drive = await post(PORT_A, { action: 'createChannel', name: 'drive', kind: 'public' })
const driveId = drive.channel?.id
await waitFor(async () => (await get(PORT_B)).channels?.some((c) => c.id === driveId), 8000)
const sharedContent = 'shared drive content v5'
wa.send({ t: 'fileStart', uploadId: 's1', name: 'shared.txt', size: sharedContent.length, mime: 'text/plain', to: driveId, toType: 'channel', share: true })
wa.send({ t: 'fileChunk', uploadId: 's1', seq: 0, data: Buffer.from(sharedContent).toString('base64') })
wa.send({ t: 'fileEnd', uploadId: 's1' })
const sharedEvt = await wb.next((m) => m.t === 'sharedFiles' && (m.sharedFiles ?? []).some((f) => f.channelId === driveId && f.name === 'shared.txt'), 8000).catch(() => null)
const sharedId = sharedEvt?.sharedFiles?.find((f) => f.name === 'shared.txt')?.id
check('共享文件索引广播到 B', !!sharedId)
const dl = await waitFor(async () => {
  const res = await fetch(`http://127.0.0.1:${PORT_B}/lan-im/shared-files/${sharedId}`)
  if (!res.ok) return null
  return res.text()
}, 15000)
check('B 按需拉取共享文件', dl === sharedContent, dl === null ? '超时' : String(dl))
await post(PORT_A, { action: 'removeSharedFile', id: sharedId })
const sharedRemoved = await waitFor(async () => !(await get(PORT_B)).sharedFiles?.some((f) => f.id === sharedId), 8000)
check('共享文件删除同步到 B', !!sharedRemoved)

// 9e) 保留一个共享文件，验证 B 重启后索引持久化 + 重新按需拉取
const keepContent = 'keep across restart'
wa.send({ t: 'fileStart', uploadId: 's2', name: 'keep.txt', size: keepContent.length, mime: 'text/plain', to: driveId, toType: 'channel', share: true })
wa.send({ t: 'fileChunk', uploadId: 's2', seq: 0, data: Buffer.from(keepContent).toString('base64') })
wa.send({ t: 'fileEnd', uploadId: 's2' })
const keepEvt = await wb.next((m) => m.t === 'sharedFiles' && (m.sharedFiles ?? []).some((f) => f.name === 'keep.txt'), 8000).catch(() => null)
const keepId = keepEvt?.sharedFiles?.find((f) => f.name === 'keep.txt')?.id
check('保留共享文件已同步', !!keepId)
wa.close(); wb.close()

// 10) 离线补发 + 离线私有频道邀请（重启后经 hello 同步）
const offpriv = await post(PORT_A, { action: 'createChannel', name: 'offpriv', kind: 'private' })
const offprivId = offpriv.channel?.id
b.kill()
await sleep(2000)
await post(PORT_A, { action: 'inviteChannelMember', channelId: offprivId, accountId: 'bob' })
await post(PORT_A, { action: 'send', to: 'bob', toType: 'account', body: 'offline msg' })
console.log('… 重启 B 验证离线补发、私有频道 hello 同步与网盘索引 …')
b = await start('B2', dirB, PORT_B2)
const gotOffline = await waitFor(async () => (await get(PORT_B2)).messages?.some((m) => m.body === 'offline msg'), 20000)
check('离线消息补发', !!gotOffline)
const offlineInvite = await waitFor(async () => (await get(PORT_B2)).channels?.some((c) => c.id === offprivId && c.members?.includes('bob')), 12000)
check('离线私有频道邀请重启后同步', !!offlineInvite)
const indexRestored = await waitFor(async () => (await get(PORT_B2)).sharedFiles?.some((f) => f.id === keepId), 10000)
check('共享文件索引重启后保留', !!indexRestored)
const dl2 = await waitFor(async () => {
  const res = await fetch(`http://127.0.0.1:${PORT_B2}/lan-im/shared-files/${keepId}`)
  if (!res.ok) return null
  return res.text()
}, 20000)
check('重启后重新按需拉取共享文件', dl2 === keepContent, dl2 === null ? '超时' : String(dl2))

// 11) PSK：不一致互不可见，一致后可见
await post(PORT_A, { action: 'setupPsk', psk: 'keyA' })
await post(PORT_B2, { action: 'setupPsk', psk: 'keyB' })
await sleep(8000)
const isolated = await get(PORT_A)
check('PSK 不一致互不可见', !(Array.isArray(isolated.peers) && isolated.peers.some((p) => p.accountId === 'bob')))
await post(PORT_A, { action: 'setupPsk', psk: 'same' })
await post(PORT_B2, { action: 'setupPsk', psk: 'same' })
const reDiscover = await waitFor(async () => (await get(PORT_A)).peers?.some((p) => p.accountId === 'bob'), 15000)
check('PSK 一致后互相发现', !!reDiscover)

// 12) 落盘
const histDir = join(dirA, 'plugins-data', 'lan-im', 'history')
const histFiles = readdirSync(histDir).filter((f) => f.endsWith('.jsonl'))
const hist = histFiles.map((f) => readFileSync(join(histDir, f), 'utf8')).join('\n')
check('历史已落盘（按天）', histFiles.length > 0 && hist.includes('hello private'))
check('消息附件记录已持久化', hist.includes('"event":"file"') && hist.includes('note.txt'))
const sharedIndex = JSON.parse(readFileSync(join(dirA, 'plugins-data', 'lan-im', 'shared-files.json'), 'utf8'))
check('共享文件索引已持久化', sharedIndex.some((f) => f.id === keepId))

a.kill(); b.kill()
rmSync(base, { recursive: true, force: true })
console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`)
process.exit(failures === 0 ? 0 : 1)
