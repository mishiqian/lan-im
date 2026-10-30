/**
 * 局域网即时通信（lan-im）客户端入口 v5。
 * UI 与状态拆分：styles.ts / format.ts / components.ts，本文件只保留窗口状态编排；
 * 落位交给 Slot 系统（shell.overlay），不再自建 DOM 容器或往顶栏塞按钮。
 */
import * as React from 'react'
import { CHUNK_SIZE, type Channel, type ChannelKind, type ChatMessage, type FileInfo, type Peer, type SelfInfo, type SharedFile, type TargetType } from '../protocol.ts'
import { CSS } from './styles.ts'
import { requestNotif, wsUrl } from './format.ts'
import { ChatWindow, Launcher } from './components.ts'

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

  const wsRef = React.useRef<WebSocket | null>(null)
  const seenIds = React.useRef(new Set<string>())
  const openRef = React.useRef(false)
  const activeRef = React.useRef('*')
  const activeTypeRef = React.useRef<TargetType>('channel')
  const mutedRef = React.useRef<Set<string>>(new Set())

  React.useEffect(() => { openRef.current = open }, [open])
  React.useEffect(() => { activeRef.current = active; activeTypeRef.current = activeType }, [active, activeType])
  React.useEffect(() => { mutedRef.current = muted }, [muted])
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
      ws.onopen = () => { setConnected(true); delay = 1000 }
      ws.onmessage = (ev: MessageEvent) => {
        let msg: any
        try { msg = JSON.parse(String(ev.data)) } catch { return }
        if (msg.t === 'snapshot') {
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
      ws.onerror = () => {}
    }
    connect()
    return () => { closed = true; if (timer !== undefined) window.clearTimeout(timer); try { wsRef.current?.close() } catch { /* 忽略 */ } }
  }, [])

  const send = (to: string, toType: TargetType, body: string): void => {
    const ws = wsRef.current
    if (ws !== null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'send', to, toType, body }))
  }
  const setName = (name: string): void => { const ws = wsRef.current; if (ws !== null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'setName', name })) }
  const setupAccount = (username: string, displayName: string, password: string): void => { const ws = wsRef.current; if (ws !== null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'setupAccount', username, displayName, password })); requestNotif() }
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

  return React.createElement(React.Fragment, null,
    React.createElement('style', null, CSS),
    open ? React.createElement(ChatWindow, {
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
