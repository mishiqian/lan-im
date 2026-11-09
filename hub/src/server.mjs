/**
 * Hub：HLP 服务端最小实现（M1 骨架）。
 *
 * 职责边界（对应 PROTOCOL.md）：
 * - 认证：hello → challenge → auth，Ed25519 验签
 * - 目录：记录 keyId → 连接 / prekey / account
 * - 路由：relay 按 to 转发，离线入队
 * - 其它一律不做：不解析信封、不存明文、不搜索
 */
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto'
import { WebSocketServer } from 'ws'
import {
  ERR, HANDSHAKE_SKEW_MS, MAX_CONTROL_BYTES, MAX_FRAME_BYTES, PROTOCOL_VERSION,
  base32, errorFrame, handshakeTranscript, isKeyId, isNonce, parseFrame, prekeyTranscript,
} from './frames.mjs'

const DEFAULTS = {
  hubId: 'localhost',
  frameBytes: MAX_FRAME_BYTES,
  controlBytes: MAX_CONTROL_BYTES,
  queueBytes: 64 * 1024 * 1024,
  queueTtlMs: 7 * 24 * 3600 * 1000,
  msgPerSec: 50,
  pingMs: 20_000,
  timeoutMs: 60_000,
}

/** 原始 Ed25519 公钥 → keyId（base32(sha256)[:16]） */
export function keyIdOfRawPublicKey(raw) {
  return base32(createHash('sha256').update(raw).digest()).slice(0, 16)
}

function rawPublicKeyFromB64u(b64u) {
  const der = Buffer.from(b64u, 'base64url')
  const key = createPublicKey({ key: der, format: 'der', type: 'spki' })
  const out = key.export({ format: 'der', type: 'spki' })
  return out.subarray(out.length - 32)
}

export function createHub(options = {}) {
  const opts = { ...DEFAULTS, ...options }
  const nodes = new Map() // keyId → { account, nodeId, prekey, ws, seen }
  const queue = new Map() // keyId → [{ from, env, at }]
  const invites = new Map() // code → { remaining }
  for (const code of options.invites ?? []) invites.set(code, { remaining: 0x7fffffff })

  const log = []
  const record = (line) => {
    log.push({ at: Date.now(), line })
    if (log.length > 500) log.shift()
    options.onLog?.(line)
  }

  const send = (ws, obj) => {
    if (ws === undefined || ws.readyState !== 1) return
    try { ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)) } catch { /* 忽略 */ }
  }

  const queueBytes = () => [...queue.values()].flat().reduce((n, item) => n + item.env.length, 0)

  const enqueue = (to, item) => {
    const now = Date.now()
    const list = (queue.get(to) ?? []).filter((x) => now - x.at < opts.queueTtlMs)
    list.push(item)
    while (list.length > 0 && queueBytes() > opts.queueBytes) list.shift()
    queue.set(to, list)
  }

  const flushQueue = (keyId) => {
    const list = queue.get(keyId)
    if (list === undefined || list.length === 0) return
    const ws = nodes.get(keyId)?.ws
    if (ws === undefined) return
    for (const item of list) send(ws, { t: 'relay', v: 1, to: keyId, env: item.env, from: item.from })
    queue.delete(keyId)
  }

  const handleRelay = (ws, session, frame) => {
    if (typeof frame.env !== 'string' || frame.env === '') {
      send(ws, errorFrame(ERR.UNKNOWN_FRAME, 'relay 缺少 env'))
      return
    }
    if (Buffer.byteLength(frame.env, 'utf8') > opts.frameBytes) {
      send(ws, errorFrame(ERR.PAYLOAD_TOO_LARGE, '帧过大'))
      return
    }
    if (!isKeyId(frame.to)) {
      send(ws, errorFrame(ERR.UNKNOWN_FRAME, 'relay.to 不是合法 keyId'))
      return
    }
    const target = nodes.get(frame.to)
    if (target?.ws !== undefined && target.ws.readyState === 1) {
      send(target.ws, { t: 'relay', v: 1, to: frame.to, env: frame.env, from: session.keyId })
      send(ws, { t: 'relay/receipt', v: 1, ids: [], status: 'delivered' })
      return
    }
    enqueue(frame.to, { from: session.keyId, env: frame.env, at: Date.now() })
    send(ws, { t: 'relay/receipt', v: 1, ids: [], status: 'queued' })
  }

  const handleLookup = (ws, frame) => {
    if (!isKeyId(frame.keyId)) {
      send(ws, errorFrame(ERR.UNKNOWN_FRAME, 'lookup.keyId 非法'))
      return
    }
    const node = nodes.get(frame.keyId)
    if (node === undefined || node.prekey === undefined) {
      send(ws, { t: 'lookup/result', v: 1, keyId: frame.keyId, found: false })
      return
    }
    send(ws, {
      t: 'lookup/result', v: 1, keyId: frame.keyId, found: true,
      account: node.account, prekey: node.prekey, prekeySig: node.prekeySig,
      hubId: opts.hubId, online: node.ws?.readyState === 1,
    })
  }

  const handleAuth = (ws, session, frame) => {
    if (session.hubNonce === undefined) {
      send(ws, errorFrame(ERR.BAD_SIGNATURE, '没有待验证的挑战'))
      return ws.close(1008, 'auth without challenge')
    }
    if (!Number.isFinite(frame.ts) || Math.abs(Date.now() - frame.ts) > HANDSHAKE_SKEW_MS) {
      send(ws, errorFrame(ERR.BAD_SIGNATURE, '时间戳越界'))
      return ws.close(1008, 'stale ts')
    }
    let pubRaw
    try {
      pubRaw = rawPublicKeyFromB64u(session.pubkeyB64u)
    } catch {
      return ws.close(1008, 'bad key')
    }
    const transcript = handshakeTranscript({
      hubId: opts.hubId,
      nodeId: session.nodeId,
      keyId: session.keyId,
      clientNonce: session.clientNonce,
      hubNonce: session.hubNonce,
      ts: frame.ts,
    })
    let ok = false
    try {
      ok = verify(null, transcript, createPublicKey({
        key: Buffer.from(session.pubkeyB64u, 'base64url'), format: 'der', type: 'spki',
      }), Buffer.from(String(frame.sig ?? ''), 'base64url'))
    } catch { ok = false }
    if (!ok) {
      send(ws, errorFrame(ERR.BAD_SIGNATURE, '签名无效'))
      return ws.close(1008, 'bad signature')
    }
    if (keyIdOfRawPublicKey(pubRaw) !== session.keyId) {
      send(ws, errorFrame(ERR.BAD_SIGNATURE, 'keyId 与公钥不匹配'))
      return ws.close(1008, 'keyId mismatch')
    }

    const existing = nodes.get(session.keyId)
    if (existing !== undefined && existing.account !== session.account) {
      send(ws, errorFrame(ERR.BLOCKED, '该 keyId 已被其它账号占用'))
      return ws.close(1008, 'keyId takeover')
    }

    session.authed = true
    nodes.set(session.keyId, {
      account: session.account,
      nodeId: session.nodeId,
      prekey: session.prekey,
      prekeySig: session.prekeySig,
      ws,
      seen: Date.now(),
    })
    send(ws, {
      t: 'ready', v: PROTOCOL_VERSION, hubId: opts.hubId, version: PROTOCOL_VERSION,
      features: ['text', 'presence', 'queue', 'lookup'],
      serverTime: Date.now(),
      limits: { frameBytes: opts.frameBytes, msgPerSec: opts.msgPerSec, queueBytes: opts.queueBytes },
    })
    record(`+ ${session.account} (${session.keyId})`)
    flushQueue(session.keyId)
  }

  const handleHello = (ws, session, frame) => {
    if (session.helloSeen) {
      send(ws, errorFrame(ERR.UNKNOWN_FRAME, '重复 hello'))
      return
    }
    if (frame.caps === undefined || !Number.isInteger(frame.caps?.min) || !Number.isInteger(frame.caps?.max)) {
      send(ws, errorFrame(ERR.UNSUPPORTED_VERSION, 'hello 缺少 caps'))
      return
    }
    if (Math.max(frame.caps.min, PROTOCOL_VERSION) > Math.min(frame.caps.max, PROTOCOL_VERSION)) {
      send(ws, errorFrame(ERR.UNSUPPORTED_VERSION, '版本不兼容'))
      return ws.close(1008, 'version')
    }
    if (!isKeyId(frame.keyId) || typeof frame.account !== 'string' || frame.account === '') {
      send(ws, errorFrame(ERR.UNKNOWN_FRAME, 'hello 字段非法'))
      return
    }
    if (invites.size > 0 && !nodes.has(frame.keyId)) {
      const code = String(frame.invite ?? '')
      const slot = invites.get(code)
      if (slot === undefined || slot.remaining <= 0) {
        send(ws, errorFrame(ERR.INVITE_INVALID, '邀请码无效'))
        return ws.close(1008, 'invite')
      }
      slot.remaining -= 1
    }
    if (frame.pubkey === undefined || String(frame.pubkey) === '') {
      send(ws, errorFrame(ERR.UNKNOWN_FRAME, 'hello 缺少 pubkey'))
      return
    }
    let pubRaw
    try {
      pubRaw = rawPublicKeyFromB64u(String(frame.pubkey))
    } catch {
      send(ws, errorFrame(ERR.UNKNOWN_FRAME, 'pubkey 非法'))
      return
    }
    if (keyIdOfRawPublicKey(pubRaw) !== frame.keyId) {
      send(ws, errorFrame(ERR.BAD_SIGNATURE, 'keyId 与公钥不匹配'))
      return
    }
    if (frame.prekey !== undefined) {
      const prekey = String(frame.prekey)
      const sig = Buffer.from(String(frame.prekeySig ?? ''), 'base64url')
      let ok = false
      try {
        ok = verify(null, prekeyTranscript({ keyId: frame.keyId, prekey }), createPublicKey({
          key: Buffer.from(String(frame.pubkey), 'base64url'), format: 'der', type: 'spki',
        }), sig)
      } catch { ok = false }
      if (!ok) {
        send(ws, errorFrame(ERR.BAD_SIGNATURE, 'prekey 签名无效'))
        return
      }
    }
    session.helloSeen = true
    session.keyId = frame.keyId
    session.account = String(frame.account)
    session.nodeId = String(frame.nodeId ?? '')
    session.clientNonce = String(frame.nonce ?? '')
    // 公钥随 hello 一起给（规范里 keyId 就是它的指纹）
    session.pubkeyB64u = String(frame.pubkey)
    session.prekey = frame.prekey === undefined ? undefined : String(frame.prekey)
    session.prekeySig = frame.prekeySig === undefined ? undefined : String(frame.prekeySig)
    if (!isNonce(session.clientNonce) || session.pubkeyB64u === '') {
      send(ws, errorFrame(ERR.UNKNOWN_FRAME, 'hello 缺少 nonce 或 pubkey'))
      return
    }
    session.hubNonce = randomBytes(4).toString('hex')
    send(ws, { t: 'challenge', v: PROTOCOL_VERSION, hubNonce: session.hubNonce, ts: Date.now() })
  }

  const onConnection = (ws) => {
    const session = { authed: false }
    ws.on('message', (raw) => {
      const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)
      if (Buffer.byteLength(text, 'utf8') > opts.frameBytes) {
        send(ws, errorFrame(ERR.PAYLOAD_TOO_LARGE, '帧过大'))
        return
      }
      const parsed = parseFrame(text)
      if (!parsed.ok) {
        send(ws, errorFrame(parsed.code, parsed.reason))
        return
      }
      const frame = parsed.frame
      if (frame.v !== PROTOCOL_VERSION) {
        send(ws, errorFrame(ERR.UNSUPPORTED_VERSION, `不支持的版本 ${frame.v}`))
        return
      }
      if (frame.t === 'hello') return handleHello(ws, session, frame)
      if (frame.t === 'auth') return handleAuth(ws, session, frame)
      if (!session.authed) {
        send(ws, errorFrame(ERR.UNAUTHENTICATED, '未认证'))
        return
      }
      if (frame.t === 'ping') return send(ws, { t: 'pong', v: PROTOCOL_VERSION, ts: Date.now() })
      if (frame.t === 'relay') return handleRelay(ws, session, frame)
      if (frame.t === 'lookup') return handleLookup(ws, frame)
      if (frame.t === 'presence') {
        const node = nodes.get(session.keyId)
        if (node !== undefined) node.seen = Date.now()
        for (const [keyId, other] of nodes) {
          if (keyId === session.keyId) continue
          send(other.ws, { t: 'presence', v: PROTOCOL_VERSION, keyId: session.keyId, status: frame.status ?? 'online', lastSeen: Date.now() })
        }
        return
      }
      send(ws, errorFrame(ERR.UNKNOWN_FRAME, `未知帧 ${frame.t}`))
    })
    ws.on('close', () => {
      if (session.keyId === undefined) return
      const node = nodes.get(session.keyId)
      if (node !== undefined && node.ws === ws) {
        node.ws = undefined
        nodes.set(session.keyId, node)
        record(`- ${session.account} (${session.keyId})`)
        for (const [keyId, other] of nodes) {
          if (keyId === session.keyId) continue
          send(other.ws, { t: 'presence', v: PROTOCOL_VERSION, keyId: session.keyId, status: 'offline', lastSeen: Date.now() })
        }
      }
    })
    ws.on('error', () => { /* 忽略，close 会处理 */ })
  }

  const handler = (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, hubId: opts.hubId, nodes: nodes.size, queueBytes: queueBytes() }))
      return
    }
    if (req.url === '/admin/nodes') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify([...nodes.entries()].map(([keyId, n]) => ({ keyId, account: n.account, online: n.ws?.readyState === 1, seen: n.seen }))))
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('lan-im hub')
  }
  // 有证书就走 https（局域网 wss），否则明文（仅本机/内网）
  const server = opts.tls === undefined ? createHttpServer(handler) : createHttpsServer(opts.tls, handler)

  const wss = new WebSocketServer({ server, path: '/hlp', maxPayload: opts.frameBytes })
  wss.on('connection', onConnection)

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.readyState === 1) send(ws, { t: 'ping', v: PROTOCOL_VERSION, ts: Date.now() })
    }
  }, opts.pingMs)
  heartbeat.unref?.()

  return {
    server,
    wss,
    hubId: opts.hubId,
    nodes,
    queue,
    invites,
    log,
    listen(port = 0, host = '127.0.0.1') {
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => {
          const addr = server.address()
          resolve({ port: addr.port, host })
        })
      })
    },
    async close() {
      clearInterval(heartbeat)
      // 直接掐断：close() 要等对端回帧，测试里会挂住
      for (const ws of wss.clients) { try { ws.terminate() } catch { /* 忽略 */ } }
      // 回调可能因为半开的 upgrade 连接永不触发：加个兜底超时，别让 close 变成死等
      await Promise.race([new Promise((r) => wss.close(() => r())), new Promise((r) => setTimeout(r, 300))])
      server.closeAllConnections?.()
      await Promise.race([new Promise((r) => server.close(() => r())), new Promise((r) => setTimeout(r, 300))])
    },
  }
}
