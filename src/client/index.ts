/**
 * 局域网即时通信（lan-im）客户端入口 v5。
 * UI 与状态拆分：styles.ts / format.ts / components.ts，本文件只保留窗口状态编排；
 * 落位交给 Slot 系统（shell.overlay），不再自建 DOM 容器或往顶栏塞按钮。
 */
declare const __LANIM_VERSION__: string

import * as React from 'react'
import { createPortal } from 'react-dom'
import { API_ROUTE, CHUNK_SIZE, type Channel, type ChannelKind, type ChatMessage, type FileInfo, type Peer, type SelfInfo, type SharedFile, type TargetType } from '../protocol.ts'
import { CSS } from './styles.ts'
import { apiBase, currentApiHost, requestNotif, resolveApiHost, wsUrl } from './format.ts'
import { ChatWindow, Launcher } from './components.ts'
import { AgentPanel, type PublishInput } from './agent-panel.ts'
import type { AgentEntry, RemoteSessionRecord } from '../protocol.ts'

let wsFailureReports = 0
async function reportWsFailure(): Promise<void> {
  if (wsFailureReports >= 2) return
  wsFailureReports += 1
  try {
    await fetch(API_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'log',
        message: `客户端 WS 连接失败：${wsUrl()}（页面 ${window.location.href.slice(0, 80)}）`,
      }),
    })
  } catch { /* 上报也失败就算了 */ }
}

function App(): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [self, setSelf] = React.useState<SelfInfo | null>(null)
  const [peers, setPeers] = React.useState<Peer[]>([])
  const [channels, setChannels] = React.useState<Channel[]>([])
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [files, setFiles] = React.useState<FileInfo[]>([])
  const [sharedFiles, setSharedFiles] = React.useState<SharedFile[]>([])
  const [logs, setLogs] = React.useState<string[]>([])
  const [connected, setConnected] = React.useState(false)
  const [unread, setUnread] = React.useState<Record<string, number>>({})
  const [muted, setMuted] = React.useState<Set<string>>(new Set())
  const [active, setActive] = React.useState<string>('*')
  const [activeType, setActiveType] = React.useState<TargetType>('channel')
  const [searchResults, setSearchResults] = React.useState<ChatMessage[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [mode, setMode] = React.useState<'chat' | 'agents'>('chat')
  const [agents, setAgents] = React.useState<AgentEntry[]>([])
  const [sessions, setSessions] = React.useState<RemoteSessionRecord[]>([])
  const [agentError, setAgentError] = React.useState<string | null>(null)
  const [agentBusy, setAgentBusy] = React.useState(false)

  const wsRef = React.useRef<WebSocket | null>(null)
  const seenIds = React.useRef(new Set<string>())
  const openRef = React.useRef(false)
  const activeRef = React.useRef('*')
  const activeTypeRef = React.useRef<TargetType>('channel')
  const mutedRef = React.useRef<Set<string>>(new Set())
  const selfRef = React.useRef<SelfInfo | null>(null)

  React.useEffect(() => { openRef.current = open }, [open])
  React.useEffect(() => { activeRef.current = active; activeTypeRef.current = activeType }, [active, activeType])
  React.useEffect(() => { mutedRef.current = muted }, [muted])
  React.useEffect(() => { selfRef.current = self }, [self])
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault()
        requestNotif()
        setOpen((value) => !value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  React.useEffect(() => {
    let closed = false
    let delay = 1000
    let timer: number | undefined
    const connect = (): void => {
      const ws = new WebSocket(wsUrl())
      wsRef.current = ws
      ws.onopen = () => { setConnected(true); delay = 1000; void refreshAgents() }
      ws.onmessage = (ev: MessageEvent) => {
        let msg: any
        try { msg = JSON.parse(String(ev.data)) } catch { return }
        if (msg.t === 'agentsChanged') {
          setAgents(Array.isArray(msg.agents) ? (msg.agents as AgentEntry[]) : [])
          setSessions(Array.isArray(msg.sessions) ? (msg.sessions as RemoteSessionRecord[]) : [])
          return
        }
        if (msg.t === 'sessions') {
          setSessions(Array.isArray(msg.sessions) ? (msg.sessions as RemoteSessionRecord[]) : [])
          return
        }
        if (msg.t === 'snapshot') {
          // 界面是新 bundle、宿主要是旧进程，会出现「装了却没反应」的怪象；
          // 版本对不上就直说，别让人去猜
          const hostVersion = String(msg.host?.version ?? '')
          if (hostVersion !== '' && hostVersion !== '0.0.0' && hostVersion !== __LANIM_VERSION__) {
            setAgentError(`宿主加载的是 v${hostVersion}，界面是 v${__LANIM_VERSION__}：请 Cmd+Q 完全退出 DeepSeek Harness 再打开`)
          }
          setAgents(Array.isArray(msg.agents) ? (msg.agents as AgentEntry[]) : [])
          setSessions(Array.isArray(msg.sessions) ? (msg.sessions as RemoteSessionRecord[]) : [])
          setSelf(msg.self as SelfInfo)
          setPeers(Array.isArray(msg.peers) ? (msg.peers as Peer[]) : [])
          setChannels(Array.isArray(msg.channels) ? (msg.channels as Channel[]) : [])
          setLogs(Array.isArray(msg.log) ? (msg.log as string[]) : [])
          setFiles(Array.isArray(msg.files) ? (msg.files as FileInfo[]) : [])
          setSharedFiles(Array.isArray(msg.sharedFiles) ? (msg.sharedFiles as SharedFile[]) : [])
          seenIds.current = new Set()
          const list = Array.isArray(msg.messages) ? (msg.messages as ChatMessage[]) : []
          for (const m of list) seenIds.current.add(m.id)
          setMessages(list)
        } else if (msg.t === 'msg') {
          const m = msg.message as ChatMessage
          const isNew = !seenIds.current.has(m.id)
          if (isNew) {
            seenIds.current.add(m.id)
            setMessages((prev) => [...prev, m])
            if (!m.local && m.kind === 'text' && !mutedRef.current.has(m.toType === 'channel' ? m.to : m.from)) {
              const conv = m.toType === 'channel' ? m.to : m.from
              const viewing = openRef.current && activeRef.current === conv && activeTypeRef.current === m.toType && !document.hidden
              if (!viewing) {
                setUnread((u) => ({ ...u, [conv]: (u[conv] ?? 0) + 1 }))
                if ((!openRef.current || document.hidden) && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                  try { new Notification(m.toType === 'channel' ? `${m.fromName}（${m.to}）` : m.fromName, { body: m.body }) } catch { /* 忽略 */ }
                }
              }
            }
          } else {
            setMessages((prev) => {
              const idx = prev.findIndex((x) => x.id === m.id)
              if (idx === -1) return [...prev, m]
              const next = [...prev]
              next[idx] = m
              return next
            })
          }
        } else if (msg.t === 'peers') {
          setPeers(Array.isArray(msg.peers) ? (msg.peers as Peer[]) : [])
        } else if (msg.t === 'channels') {
          setChannels(Array.isArray(msg.channels) ? (msg.channels as Channel[]) : [])
        } else if (msg.t === 'self') {
          setSelf(msg.self as SelfInfo)
        } else if (msg.t === 'log') {
          setLogs(Array.isArray(msg.log) ? (msg.log as string[]) : [])
        } else if (msg.t === 'searchResult') {
          setSearchResults(msg.results as ChatMessage[])
        } else if (msg.t === 'file') {
          setFiles((prev) => { if (prev.some((f) => f.id === msg.file.id)) return prev; return [...prev, msg.file] })
        } else if (msg.t === 'sharedFiles') {
          setSharedFiles(Array.isArray(msg.sharedFiles) ? (msg.sharedFiles as SharedFile[]) : [])
        } else if (msg.t === 'error') {
          setError(typeof msg.message === 'string' ? msg.message : String(msg.message ?? '操作失败'))
        }
      }
      ws.onclose = () => {
        setConnected(false)
        if (!closed) { timer = window.setTimeout(connect, delay); delay = Math.min(delay * 2, 10000) }
      }
      ws.onerror = () => { void reportWsFailure() }
    }
    void (async () => {
      // 桌面端页面跑在 dsh-app://app 上，window.location.host 是 "app"；
      // resolveApiHost 会先读 __DSH_TRANSPORT__.streamBaseUrl 拿到真正的 HTTP origin。
      await resolveApiHost()
      if (!closed) connect()
    })()
    return () => { closed = true; if (timer !== undefined) window.clearTimeout(timer); try { wsRef.current?.close() } catch { /* 忽略 */ } }
  }, [])

  const send = (to: string, toType: TargetType, body: string): void => {
    const ws = wsRef.current
    if (ws !== null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'send', to, toType, body }))
  }
  const setName = (name: string): void => { const ws = wsRef.current; if (ws !== null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'setName', name })) }
  const restSetupAccount = async (username: string, displayName: string, password: string): Promise<void> => {
    try {
      const res = await fetch(API_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'setupAccount', username, displayName, password }),
      })
      const data = await res.json() as { ok?: boolean; self?: SelfInfo; error?: string }
      if (data.ok === true && data.self !== undefined) setSelf(data.self)
      else setError(data.error ?? '创建账号失败：宿主无响应')
    } catch (err) {
      setError(`创建账号失败：${String(err)}`)
    }
  }

  const apiPost = async (body: unknown): Promise<any> => {
    const res = await fetch(apiBase(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return await res.json()
  }

  const refreshAgents = async (): Promise<void> => {
    try {
      const r = await apiPost({ action: 'agent.list' })
      if (r?.ok === true && Array.isArray(r.agents)) setAgents(r.agents as AgentEntry[])
    } catch { /* 忽略：下次快照会带 */ }
  }

  const publishAgent = (input: PublishInput): void => {
    if ((selfRef.current?.accountId ?? '') === '') { setAgentError('先创建账号再发布'); return }
    setAgentBusy(true)
    setAgentError(null)
    void apiPost({
      action: 'agent.publish',
      ...(input.id === undefined ? {} : { id: input.id }),
      name: input.name,
      prompt: input.prompt,
      summary: input.summary,
      base: input.base,
      tools: input.tools,
      cloneable: input.cloneable,
      callable: input.callable,
      sampleIn: input.sampleIn,
      sampleOut: input.sampleOut,
    })
      .then((r: any) => {
        if (r?.ok !== true) setAgentError('发布失败：' + ((r?.errors ?? []).map((e: any) => `${e.field} ${e.message}`).join('；') || '未知错误'))
        else void refreshAgents()
      })
      .catch((e: any) => setAgentError('发布失败：' + String(e?.message ?? e)))
      .finally(() => setAgentBusy(false))
  }

  // 每个「对方 agent」复用一个远端会话，避免每次调用都新开
  const callSessions = React.useRef(new Map<string, string>())
  const callAgent = async (entry: AgentEntry, text: string): Promise<{ ok: boolean; text?: string; error?: string }> => {
    const account = entry.card.author.accountId
    const key = `${account}/${entry.card.id}`
    try {
      const openRemote = async (): Promise<string | undefined> => {
        const opened = await apiPost({ action: 'agent.remote.open', account, agentId: entry.card.id })
        if (opened?.ok !== true || typeof opened?.sessionId !== 'string') {
          setAgentError(String(opened?.error ?? '宿主没有返回会话（插件宿主可能还是旧版本，请 Cmd+Q 完全退出后重开）'))
          return undefined
        }
        callSessions.current.set(key, opened.sessionId)
        return opened.sessionId
      }
      let sessionId = callSessions.current.get(key) ?? (await openRemote())
      if (sessionId === undefined) return { ok: false, error: '开会话失败' }
      let sent = await apiPost({ action: 'agent.remote.send', account, sessionId, text })
      if (sent?.ok !== true) {
        callSessions.current.delete(key)
        const reopened = await openRemote()
        if (reopened === undefined) return { ok: false, error: String(sent?.error ?? '执行失败') }
        sent = await apiPost({ action: 'agent.remote.send', account, sessionId: reopened, text })
      }
      if (sent?.ok === true) return { ok: true, text: String(sent.text ?? '') }
      callSessions.current.delete(key)
      return { ok: false, error: String(sent?.error ?? '执行失败') }
    } catch (err: any) {
      callSessions.current.delete(key)
      return { ok: false, error: String(err?.message ?? err) }
    }
  }

  const closeSession = (remoteId: string): void => {
    // 作者侧断开：会话托管在本机，直接关本机的
    void apiPost({ action: 'agent.serve.close', sessionId: remoteId })
      .then(() => setSessions((prev) => prev.map((x) => (x.remoteId === remoteId ? { ...x, status: 'closed' as const } : x))))
      .catch((err: any) => setError('断开失败：' + String(err?.message ?? err)))
  }

  // 本机试跑：装到自己机器上的 agent 用本机模型直接跑，不依赖对方在线
  const localSessions = React.useRef(new Map<string, string>())
  const localCall = async (entry: AgentEntry, text: string): Promise<{ ok: boolean; text?: string; error?: string }> => {
    const key = `${entry.card.author.accountId}/${entry.card.id}`
    const openLocal = async (): Promise<string | undefined> => {
      const opened = await apiPost({ action: 'agent.local.open', account: entry.card.author.accountId, id: entry.card.id })
      if (opened?.ok !== true || typeof opened?.sessionId !== 'string') {
        // 宿主太旧时这个 action 不存在，可能回一份别的东西；宁可报清楚也别拿 undefined 去用
        setAgentError(String(opened?.error ?? '宿主没有返回会话（插件宿主可能还是旧版本，请 Cmd+Q 完全退出后重开）'))
        return undefined
      }
      localSessions.current.set(key, opened.sessionId)
      return opened.sessionId
    }
    try {
      let sessionId = localSessions.current.get(key) ?? (await openLocal())
      if (sessionId === undefined) return { ok: false, error: '本机开会话失败' }
      let sent = await apiPost({ action: 'agent.serve.send', sessionId, text })
      if (sent?.ok !== true) {
        // 宿主重启或会话被断开后，缓存里的 id 就失效了：自动重开一次再发
        localSessions.current.delete(key)
        const reopened = await openLocal()
        if (reopened === undefined) return { ok: false, error: String(sent?.error ?? '执行失败') }
        sessionId = reopened
        sent = await apiPost({ action: 'agent.serve.send', sessionId, text })
      }
      if (sent?.ok === true) return { ok: true, text: String(sent.text ?? '') }
      localSessions.current.delete(key)
      return { ok: false, error: String(sent?.error ?? '执行失败') }
    } catch (err: any) {
      localSessions.current.delete(key)
      return { ok: false, error: String(err?.message ?? err) }
    }
  }

  const loadBases = async (): Promise<string[]> => {
    try {
      let r: any
      try {
        r = await apiPost({ action: 'agent.bases' })
      } catch (first: any) {
        // 桌面端首次可能还没拿到宿主地址：重解析一次再试
        await resolveApiHost()
        try {
          r = await apiPost({ action: 'agent.bases' })
        } catch (second: any) {
          setAgentError(`读不到本机 preset（${apiBase()}）：${String(second?.message ?? second)}`)
          return []
        }
        void first
      }
      if (r?.ok !== true) {
        setAgentError('读不到本机 preset：' + String(r?.error ?? '未知原因'))
        return []
      }
      const names = Array.isArray(r.bases) ? r.bases.map((b: any) => String(b.name)) : []
      if (names.length === 0) setAgentError('本机 ~/.dsh/.agent-presets 下没有可用的 preset（需要有 agent.cordis.yml）')
      return names
    } catch (err: any) {
      setAgentError('读不到本机 preset：' + String(err?.message ?? err))
      return []
    }
  }

  const installAgent = (entry: AgentEntry): void => {
    setAgentBusy(true)
    setAgentError(null)
    void (async () => {
      const fetched = await apiPost({ action: 'agent.fetch', account: entry.card.author.accountId, id: entry.card.id })
      if (fetched?.ok !== true) { setAgentError('拉取失败：' + String(fetched?.error ?? '对端不在线')); return }
      const done = await apiPost({ action: 'agent.install', pkg: fetched.pkg })
      if (done?.ok !== true) setAgentError('安装失败：' + ((done?.errors ?? []).map((e: any) => e.message).join('；') || '未知错误'))
      else if (done?.restartRequired === true) setAgentError('已安装：详情页可以直接「试跑」，重启 dsh 后也会出现在 preset 列表里供新会话选择。')
      await refreshAgents()
    })().catch((e: any) => setAgentError('安装失败：' + String(e?.message ?? e))).finally(() => setAgentBusy(false))
  }

  const uninstallAgent = (entry: AgentEntry): void => {
    setAgentBusy(true)
    void apiPost({ action: 'agent.uninstall', account: entry.card.author.accountId, id: entry.card.id })
      .then((r: any) => { if (r?.ok !== true) setAgentError('卸载失败'); return refreshAgents() })
      .catch((e: any) => setAgentError('卸载失败：' + String(e?.message ?? e)))
      .finally(() => setAgentBusy(false))
  }

  const setupAccount = (username: string, displayName: string, password: string): void => {
    requestNotif()
    const ws = wsRef.current
    if (ws !== null && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: 'setupAccount', username, displayName, password }))
      // 半开连接时 send 不会报错但消息到不了；1.5s 内没等到 self 更新就走 REST 兜底
      window.setTimeout(() => {
        if ((selfRef.current?.accountId ?? '') === '') void restSetupAccount(username, displayName, password)
      }, 1500)
      return
    }
    void restSetupAccount(username, displayName, password)
  }

  const setupPsk = (psk: string): void => { const ws = wsRef.current; if (ws !== null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'setupPsk', psk })) }
  const setPassword = (password: string): void => { const ws = wsRef.current; if (ws !== null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'setPassword', password })) }
  const recall = (id: string): void => { const ws = wsRef.current; if (ws !== null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'recall', id })) }
  const edit = (id: string, body: string): void => { const ws = wsRef.current; if (ws !== null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'edit', id, body })) }
  const toggleMute = (id: string): void => { setMuted((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next }) }
  const selectConv = (id: string, type: TargetType): void => { setActive(id); setActiveType(type); setUnread((u) => ({ ...u, [id]: 0 })) }
  const createChannel = (name: string, kind: ChannelKind, description?: string): void => { const ws = wsRef.current; if (ws !== null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'createChannel', name, kind, description })) }
  const renameChannel = (id: string, name: string, description?: string): void => { const ws = wsRef.current; if (ws !== null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'renameChannel', id, name, description })) }
  const deleteChannel = (id: string): void => { const ws = wsRef.current; if (ws !== null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'deleteChannel', id })) }
  const joinChannel = (id: string): void => { const ws = wsRef.current; if (ws !== null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'joinChannel', id })) }
  const leaveChannel = (id: string): void => { const ws = wsRef.current; if (ws !== null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'leaveChannel', id })) }
  const inviteMember = (channelId: string, accountId: string): void => { const ws = wsRef.current; if (ws !== null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'inviteChannelMember', channelId, accountId })) }
  const removeMember = (channelId: string, accountId: string): void => { const ws = wsRef.current; if (ws !== null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'removeChannelMember', channelId, accountId })) }
  const removeSharedFile = (id: string): void => { const ws = wsRef.current; if (ws !== null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'removeSharedFile', id })) }

  const uploadChunks = async (ws: WebSocket, uploadId: string, file: File): Promise<void> => {
    const buf = await file.arrayBuffer()
    const total = Math.ceil(file.size / CHUNK_SIZE)
    for (let seq = 0; seq < total; seq++) {
      const bytes = new Uint8Array(buf, seq * CHUNK_SIZE, Math.min(CHUNK_SIZE, file.size - seq * CHUNK_SIZE))
      let bin = ''
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
      ws.send(JSON.stringify({ t: 'fileChunk', uploadId, seq, data: btoa(bin) }))
    }
    ws.send(JSON.stringify({ t: 'fileEnd', uploadId }))
  }

  const sendFile = async (file: File, to: string, toType: TargetType): Promise<void> => {
    const ws = wsRef.current
    if (ws === null || ws.readyState !== WebSocket.OPEN) return
    const uploadId = 'u' + Math.random().toString(36).slice(2)
    ws.send(JSON.stringify({ t: 'fileStart', uploadId, name: file.name, size: file.size, mime: file.type || 'application/octet-stream', to, toType }))
    await uploadChunks(ws, uploadId, file)
  }

  const sendSharedFile = async (file: File, channelId: string): Promise<void> => {
    const ws = wsRef.current
    if (ws === null || ws.readyState !== WebSocket.OPEN) return
    const uploadId = 'u' + Math.random().toString(36).slice(2)
    ws.send(JSON.stringify({ t: 'fileStart', uploadId, name: file.name, size: file.size, mime: file.type || 'application/octet-stream', to: channelId, toType: 'channel', share: true }))
    await uploadChunks(ws, uploadId, file)
  }

  const onSearch = (keyword: string): void => {
    const ws = wsRef.current
    if (ws === null || ws.readyState !== WebSocket.OPEN) return
    if (String(keyword).trim() === '') { setSearchResults(null); return }
    ws.send(JSON.stringify({ t: 'search', keyword }))
  }

  const totalUnread = Object.values(unread).reduce<number>((a, b) => a + (b as number), 0)

  const layer = React.createElement(React.Fragment, null,
    React.createElement('style', null, CSS),
    open ? React.createElement(ChatWindow, {
      mode,
      onModeChange: setMode,
      agentView: React.createElement(AgentPanel, {
        entries: agents,
        loadBases,
        sessions,
        onCloseSession: closeSession,
        error: agentError,
        onClearError: () => setAgentError(null),
        selfAccount: self?.accountId ?? '',
        busy: agentBusy,
        onPublish: publishAgent,
        onInstall: installAgent,
        onUninstall: uninstallAgent,
        onCall: callAgent,
        onLocalCall: localCall,
        onClose: () => setMode('chat'),
      }),
      self, peers, channels, messages, files, sharedFiles, logs, connected, unread, muted, active, activeType, searchResults,
      onSelect: selectConv, onSend: send, onSetName: setName, onSetupAccount: setupAccount, onSetupPsk: setupPsk,
      onSearch: onSearch, onRecall: recall, onEdit: edit, onSendFile: (f, to, toType) => { void sendFile(f, to, toType) },
      onSendSharedFile: (f, channelId) => { void sendSharedFile(f, channelId) },
      onSetupPassword: setPassword,
      onToggleMute: toggleMute, onCreateChannel: createChannel, onRenameChannel: renameChannel, onDeleteChannel: deleteChannel,
      onJoinChannel: joinChannel, onLeaveChannel: leaveChannel, onInviteMember: inviteMember, onRemoveMember: removeMember,
      onRemoveSharedFile: removeSharedFile,
      error,
      onDismissError: () => setError(null),
      onClose: () => { setOpen(false); setError(null) },
    }) : null,
    !open ? React.createElement(Launcher, { unread: totalUnread, onClick: () => { requestNotif(); setOpen(true) } }) : null,
  )

  /**
   * 挂到 body 而不是留在 shell.overlay 的容器里：
   * 宿主把 overlay 条目包进 `position:absolute; z-index:20` 的层，那层本身是
   * stacking context，条目内部再大的 z-index 也逃不出去，于是任何 modal mask
   * （引导弹窗、设置对话框）都能盖住悬浮按钮并吞掉点击。
   * createPortal 仍然由 React 管理生命周期，只是把 DOM 放到 body 下。
   */
  return createPortal(layer, document.body) as unknown as React.ReactElement
}

/**
 * Slot 落位：整窗挂在 shell.overlay（框架自带的悬浮层）上。
 * 不再自建 body 容器、不扫 [role=tablist]、不塞按钮——UI 结构由宿主决定。
 */
export const inject: string[] = ['slots']

export function apply(ctx: any): void {
  const slots = ctx.slots !== undefined
    ? ctx.slots
    : (typeof ctx.get === 'function' ? ctx.get('slots') : undefined)
  if (slots === undefined) {
    console.error('[lan-im] slots 不可用，聊天窗不会出现')
    return
  }

  const own = (factory: () => () => void): void => {
    const dispose = factory()
    if (typeof ctx.effect === 'function') ctx.effect(() => dispose)
  }

  own(() => slots.inject('shell.overlay', () => slots.register({
    name: 'shell.overlay',
    id: 'lan-im',
    order: 50,
    label: () => '局域网聊天',
  }, App)))
}
