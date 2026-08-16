/**
 * 客户端 UI 组件：联系人/消息/文件气泡、悬浮球、账号设置、聊天主窗口。
 */
import * as React from 'react'
import type { Channel, ChannelKind, ChatMessage, FileInfo, Peer, SelfInfo, SharedFile, TargetType } from '../protocol.ts'
import { formatSize, formatTime, isDark } from './format.ts'

export function ContactItem(props: { icon: string; name: string; active: boolean; unread: number; muted: boolean; onClick: () => void; onLeave?: () => void; onManage?: () => void }): React.ReactElement {
  return React.createElement('div',
    { className: 'lim-contact' + (props.active ? ' on' : ''), onClick: props.onClick },
    React.createElement('span', { className: props.icon === 'dot' ? 'lim-cdot' : 'lim-cicon' }, props.icon === 'dot' ? '' : props.icon),
    React.createElement('span', { className: 'lim-contact-name', title: props.name }, props.name),
    props.muted ? React.createElement('span', { className: 'lim-contact-mute' }, '🔕') : null,
    props.unread > 0 ? React.createElement('span', { className: 'lim-contact-badge' }, props.unread > 99 ? '99+' : String(props.unread)) : null,
    props.onManage !== undefined ? React.createElement('span', { className: 'lim-channel-act', title: '频道管理', onClick: (e: any) => { e.stopPropagation(); props.onManage?.() } }, '⚙') : null,
    props.onLeave !== undefined ? React.createElement('span', { className: 'lim-channel-x', title: '离开频道', onClick: (e: any) => { e.stopPropagation(); props.onLeave?.() } }, '✕') : null,
  )
}

export function MessageBubble(props: { message: ChatMessage; selfAccountId: string; onRecall: (id: string) => void; onEdit: (id: string) => void }): React.ReactElement {
  const message = props.message
  if (message.kind === 'system') {
    return React.createElement('div', { className: 'lim-sys' }, message.body)
  }
  const mine = message.local || message.from === props.selfAccountId
  if (message.recalled) {
    return React.createElement('div', { className: 'lim-msg' + (mine ? ' mine' : '') },
      React.createElement('div', { className: 'lim-msg-meta' }, `${message.fromName} · ${formatTime(message.ts)}`),
      React.createElement('div', { className: 'lim-bubble recalled' }, mine ? '你撤回了一条消息' : '对方撤回了一条消息'),
    )
  }
  const statusText = message.status === 'delivered' ? '已送达' : ''
  return React.createElement('div', { className: 'lim-msg' + (mine ? ' mine' : '') },
    React.createElement('div', { className: 'lim-msg-meta' },
      React.createElement('span', null, `${message.fromName} · ${formatTime(message.ts)}${message.edited ? ' · 已编辑' : ''}`),
      mine && message.toType === 'account' && statusText !== '' ? React.createElement('span', null, statusText) : null,
      mine && !message.recalled ? React.createElement('span', { className: 'lim-msg-act', onClick: () => props.onRecall(message.id) }, '撤回') : null,
      mine && !message.recalled ? React.createElement('span', { className: 'lim-msg-act', onClick: () => props.onEdit(message.id) }, '编辑') : null,
    ),
    React.createElement('div', { className: 'lim-bubble' }, message.body),
  )
}

export function FileBubble(props: { file: FileInfo; selfAccountId: string }): React.ReactElement {
  const mine = props.file.from === props.selfAccountId
  const url = `/lan-im/files/${props.file.id}`
  const isImage = (props.file.mime ?? '').startsWith('image/')
  return React.createElement('div', { className: 'lim-file' + (mine ? ' mine' : '') },
    isImage
      ? React.createElement('div', { className: 'lim-file-body' },
          React.createElement('img', { className: 'lim-file-img', src: url, alt: props.file.name }),
          React.createElement('div', { className: 'lim-file-caption' }, `${props.file.name} · ${formatSize(props.file.size)} · `,
            React.createElement('a', { className: 'lim-file-dl', href: url, download: props.file.name, title: '下载' }, '下载'),
          ),
        )
      : React.createElement(React.Fragment, null,
          React.createElement('span', { className: 'lim-file-icon' }, '📄'),
          React.createElement('div', { className: 'lim-file-meta' },
            React.createElement('div', { className: 'lim-file-name' }, props.file.name),
            React.createElement('div', { className: 'lim-file-size' }, `${props.file.fromName} · ${formatSize(props.file.size)}`),
          ),
          React.createElement('a', { className: 'lim-file-dl', href: url, download: props.file.name, title: '下载' }, '⬇'),
        ),
  )
}

export function Launcher(props: { unread: number; onClick: () => void }): React.ReactElement {
  return React.createElement('button', { className: 'lim-launcher', 'data-lanim-trigger': '1', title: '局域网聊天（Ctrl+Shift+L）', onClick: props.onClick },
    '💬',
    props.unread > 0 ? React.createElement('span', { className: 'lim-badge' }, props.unread > 99 ? '99+' : String(props.unread)) : null,
  )
}

export function AccountSetup(props: { onSetup: (username: string, displayName: string, password: string) => void }): React.ReactElement {
  const [username, setUsername] = React.useState('')
  const [displayName, setDisplayName] = React.useState('')
  const [password, setPassword] = React.useState('')
  const submit = (): void => { const u = username.trim(); if (u === '') return; props.onSetup(u, displayName.trim(), password) }
  const initials = (displayName.trim() || username.trim() || '?').slice(0, 2).toUpperCase()
  return React.createElement('div', { className: 'lim-setup' },
    React.createElement('div', { className: 'lim-profile-head' },
      React.createElement('div', { className: 'lim-avatar' }, initials),
      React.createElement('div', { className: 'lim-profile-id' },
        React.createElement('div', { className: 'lim-setup-title' }, '创建你的账号'),
        React.createElement('div', { className: 'lim-setup-hint' }, '账号是你在局域网内的稳定身份；密码只用于本机。'),
      ),
    ),
    React.createElement('div', { className: 'lim-field' },
      React.createElement('label', null, '账号 ID（字母/数字/._-）'),
      React.createElement('input', { className: 'lim-input', value: username, placeholder: '如 alice', autoFocus: true, maxLength: 32, onChange: (e: any) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_.-]/g, '')), onKeyDown: (e: any) => { if (e.key === 'Enter') submit() } }),
    ),
    React.createElement('div', { className: 'lim-field' },
      React.createElement('label', null, '显示名'),
      React.createElement('input', { className: 'lim-input', value: displayName, placeholder: '如 张三', maxLength: 32, onChange: (e: any) => setDisplayName(e.target.value), onKeyDown: (e: any) => { if (e.key === 'Enter') submit() } }),
    ),
    React.createElement('div', { className: 'lim-field' },
      React.createElement('label', null, '密码（可选）'),
      React.createElement('input', { className: 'lim-input', type: 'password', value: password, placeholder: '留空则不设密码', onChange: (e: any) => setPassword(e.target.value), onKeyDown: (e: any) => { if (e.key === 'Enter') submit() } }),
    ),
    React.createElement('button', { className: 'lim-send lim-cta', onClick: submit }, '创建账号'),
  )
}

export function ProfileCenter(props: { self: SelfInfo; peersCount: number; channelsCount: number; connected: boolean; onSetName: (name: string) => void; onSetupPsk: (psk: string) => void; onSetupPassword: (password: string) => void; onClose: () => void }): React.ReactElement {
  const self = props.self
  const [nameDraft, setNameDraft] = React.useState(self.name)
  const [pskDraft, setPskDraft] = React.useState('')
  const [showPsk, setShowPsk] = React.useState(false)
  const [passwordDraft, setPasswordDraft] = React.useState('')
  const [showPassword, setShowPassword] = React.useState(false)
  const [copied, setCopied] = React.useState<string | null>(null)

  React.useEffect(() => { setNameDraft(self.name) }, [self.name])

  const copy = async (kind: 'account' | 'node', text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      window.setTimeout(() => setCopied((v) => v === kind ? null : v), 1200)
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        document.body.append(ta)
        ta.select()
        document.execCommand('copy')
        ta.remove()
        setCopied(kind)
        window.setTimeout(() => setCopied((v) => v === kind ? null : v), 1200)
      } catch { /* 忽略 */ }
    }
  }

  const initials = (self.name || self.accountId || '?').trim().slice(0, 2).toUpperCase()
  const shortNode = self.nodeId.length > 12 ? `${self.nodeId.slice(0, 6)}…${self.nodeId.slice(-4)}` : self.nodeId

  return React.createElement('div', { className: 'lim-modal' },
    React.createElement('div', { className: 'lim-modal-box lim-profile' },
      React.createElement('div', { className: 'lim-profile-head' },
        React.createElement('div', { className: 'lim-avatar' }, initials),
        React.createElement('div', { className: 'lim-profile-id' },
          React.createElement('div', { className: 'lim-profile-name' }, self.name || self.accountId || '未设置'),
          React.createElement('div', { className: 'lim-profile-account' }, `@${self.accountId || '未设置账号'}`),
        ),
        React.createElement('button', { className: 'lim-iconbtn', title: '关闭', onClick: props.onClose }, '✕'),
      ),

      React.createElement('div', { className: 'lim-profile-status' },
        React.createElement('span', { className: 'lim-pill' + (props.connected ? ' on' : '') }, props.connected ? '● 宿主已连接' : '○ 宿主重连中'),
        React.createElement('span', { className: 'lim-pill' + (self.hasPsk ? ' on' : '') }, self.hasPsk ? '🔐 共享密钥已启用' : '🔓 共享密钥未启用'),
        React.createElement('span', { className: 'lim-pill' + (self.hasPassword ? ' on' : '') }, self.hasPassword ? '🔑 本机密码已设置' : '🔓 本机密码未设置'),
      ),

      React.createElement('div', { className: 'lim-profile-stats' },
        React.createElement('div', { className: 'lim-stat' }, React.createElement('b', null, String(props.peersCount)), React.createElement('span', null, '在线账号')),
        React.createElement('div', { className: 'lim-stat' }, React.createElement('b', null, String(props.channelsCount)), React.createElement('span', null, '已加入频道')),
        React.createElement('div', { className: 'lim-stat' }, React.createElement('b', null, self.wsPort > 0 ? `${self.ip}:${self.wsPort}` : self.ip), React.createElement('span', null, '本机地址')),
      ),

      React.createElement('div', { className: 'lim-field' },
        React.createElement('label', null, '显示名'),
        React.createElement('div', { className: 'lim-row' },
          React.createElement('input', { className: 'lim-input', value: nameDraft, maxLength: 32, placeholder: '输入显示名', onChange: (e: any) => setNameDraft(e.target.value), onKeyDown: (e: any) => { if (e.key === 'Enter') props.onSetName(nameDraft.trim() || self.accountId) } }),
          React.createElement('button', { className: 'lim-send', onClick: () => props.onSetName(nameDraft.trim() || self.accountId) }, '保存'),
        ),
      ),

      React.createElement('div', { className: 'lim-field' },
        React.createElement('label', null, '账号 ID'),
        React.createElement('div', { className: 'lim-row' },
          React.createElement('input', { className: 'lim-input', value: self.accountId, readOnly: true }),
          React.createElement('button', { className: 'lim-mini', onClick: () => { void copy('account', self.accountId) } }, copied === 'account' ? '已复制' : '复制'),
        ),
      ),

      React.createElement('div', { className: 'lim-field' },
        React.createElement('label', null, '节点 ID'),
        React.createElement('div', { className: 'lim-row' },
          React.createElement('input', { className: 'lim-input', value: self.nodeId, readOnly: true, title: self.nodeId }),
          React.createElement('button', { className: 'lim-mini', onClick: () => { void copy('node', self.nodeId) } }, copied === 'node' ? '已复制' : '复制'),
        ),
      ),

      React.createElement('div', { className: 'lim-field' },
        React.createElement('label', null, '本机密码'),
        React.createElement('div', { className: 'lim-row' },
          React.createElement('input', {
            className: 'lim-input', type: showPassword ? 'text' : 'password', value: passwordDraft,
            placeholder: self.hasPassword ? '输入新密码覆盖，留空清除密码' : '设置本机密码（可选）',
            onChange: (e: any) => setPasswordDraft(e.target.value),
            onKeyDown: (e: any) => { if (e.key === 'Enter') { props.onSetupPassword(passwordDraft); setPasswordDraft('') } },
          }),
          React.createElement('button', { className: 'lim-mini', onClick: () => setShowPassword((v) => !v) }, showPassword ? '隐藏' : '显示'),
          React.createElement('button', { className: 'lim-send', onClick: () => { props.onSetupPassword(passwordDraft); setPasswordDraft('') } }, '保存'),
        ),
      ),

      React.createElement('div', { className: 'lim-field' },
        React.createElement('label', null, '共享密钥（PSK）'),
        React.createElement('div', { className: 'lim-row' },
          React.createElement('input', {
            className: 'lim-input', type: showPsk ? 'text' : 'password', value: pskDraft,
            placeholder: self.hasPsk ? '已设置（输入新值覆盖，留空清除）' : '设置后仅同密钥节点可互联',
            onChange: (e: any) => setPskDraft(e.target.value),
            onKeyDown: (e: any) => { if (e.key === 'Enter') { props.onSetupPsk(pskDraft); setPskDraft('') } },
          }),
          React.createElement('button', { className: 'lim-mini', onClick: () => setShowPsk((v) => !v) }, showPsk ? '隐藏' : '显示'),
          React.createElement('button', { className: 'lim-send', onClick: () => { props.onSetupPsk(pskDraft); setPskDraft('') } }, '保存'),
        ),
        React.createElement('div', { className: 'lim-profile-hint' }, 'PSK 只影响节点间信任；账号密码仅用于本机。'),
      ),

      React.createElement('div', { className: 'lim-modal-actions' },
        React.createElement('button', { className: 'lim-send', onClick: props.onClose }, '完成'),
      ),
    ),
  )
}

export interface ChatWindowProps {
  self: SelfInfo | null
  peers: Peer[]
  channels: Channel[]
  messages: ChatMessage[]
  files: FileInfo[]
  sharedFiles: SharedFile[]
  logs: string[]
  connected: boolean
  unread: Record<string, number>
  muted: Set<string>
  active: string
  activeType: TargetType
  searchResults: ChatMessage[] | null
  onSelect: (id: string, type: TargetType) => void
  onSend: (to: string, toType: TargetType, body: string) => void
  onSetName: (name: string) => void
  onSetupAccount: (username: string, displayName: string, password: string) => void
  onSetupPsk: (psk: string) => void
  onSetupPassword: (password: string) => void
  onSearch: (keyword: string) => void
  onRecall: (id: string) => void
  onEdit: (id: string, body: string) => void
  onSendFile: (file: File, to: string, toType: TargetType) => void
  onSendSharedFile: (file: File, channelId: string) => void
  onToggleMute: (id: string) => void
  onCreateChannel: (name: string, kind: ChannelKind, description?: string) => void
  onRenameChannel: (id: string, name: string, description?: string) => void
  onDeleteChannel: (id: string) => void
  onJoinChannel: (id: string) => void
  onLeaveChannel: (id: string) => void
  onInviteMember: (channelId: string, accountId: string) => void
  onRemoveMember: (channelId: string, accountId: string) => void
  onRemoveSharedFile: (id: string) => void
  error: string | null
  onDismissError: () => void
  onClose: () => void
}

export function SharedFileBubble(props: { file: SharedFile; self: SelfInfo | null; onRemove: (id: string) => void }): React.ReactElement {
  const f = props.file
  const self = props.self
  const mine = self !== null && (f.ownerNodeId === self.nodeId || f.ownerAccount === self.accountId)
  const url = `/lan-im/shared-files/${f.id}`
  const isImage = (f.mime ?? '').startsWith('image/')
  return React.createElement('div', { className: 'lim-shared-file' },
    isImage
      ? React.createElement('img', { className: 'lim-shared-img', src: url, alt: f.name })
      : React.createElement('span', { className: 'lim-shared-icon' }, '📄'),
    React.createElement('div', { className: 'lim-shared-meta' },
      React.createElement('div', { className: 'lim-shared-name', title: f.name }, f.name),
      React.createElement('div', { className: 'lim-shared-sub' }, `${f.ownerAccount || '?'} · ${formatSize(f.size)}${mine ? ' · 上传者' : ' · 缓存/按需拉取'}`),
    ),
    React.createElement('a', { className: 'lim-shared-act', href: url, title: isImage ? '打开' : '下载', download: isImage ? undefined : f.name, target: isImage ? '_blank' : undefined }, isImage ? '打开' : '下载'),
    mine ? React.createElement('button', { className: 'lim-shared-act danger', onClick: () => props.onRemove(f.id) }, '删除') : null,
  )
}

export function ChatWindow(props: ChatWindowProps): React.ReactElement {
  const { self, peers, channels, messages, files, sharedFiles, logs, connected, unread, muted, active, activeType, searchResults } = props
  const [draft, setDraft] = React.useState('')
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [dark, setDark] = React.useState<boolean>(isDark)
  const [showLog, setShowLog] = React.useState(false)
  const [showProfile, setShowProfile] = React.useState(false)
  const [showSearch, setShowSearch] = React.useState(false)
  const [searchKeyword, setSearchKeyword] = React.useState('')
  const [activeTab, setActiveTab] = React.useState<'messages' | 'files'>('messages')
  const [showChannelModal, setShowChannelModal] = React.useState(false)
  const [newChannelName, setNewChannelName] = React.useState('')
  const [newChannelKind, setNewChannelKind] = React.useState<ChannelKind>('public')
  const [newChannelDesc, setNewChannelDesc] = React.useState('')
  const [showManageModal, setShowManageModal] = React.useState(false)
  const [manageName, setManageName] = React.useState('')
  const [manageDesc, setManageDesc] = React.useState('')
  const [memberDraft, setMemberDraft] = React.useState('')
  const [pos, setPos] = React.useState(() => ({ x: Math.max(8, window.innerWidth - 480), y: Math.max(8, window.innerHeight - 640) }))
  const [size, setSize] = React.useState({ w: 480, h: 640 })
  const dragRef = React.useRef<{ dx: number; dy: number } | null>(null)
  const resizeRef = React.useRef<{ sx: number; sy: number; sw: number; sh: number } | null>(null)
  const threadRef = React.useRef<HTMLDivElement | null>(null)
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const fileRef = React.useRef<HTMLInputElement | null>(null)
  const sharedFileRef = React.useRef<HTMLInputElement | null>(null)
  const composingRef = React.useRef(false)
  const channelInputRef = React.useRef<HTMLInputElement | null>(null)
  const memberInputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => { setActiveTab('messages'); setShowSearch(false); setSearchKeyword(''); props.onSearch('') }, [active, activeType])

  React.useEffect(() => {
    if (showChannelModal) channelInputRef.current?.focus()
  }, [showChannelModal])

  React.useEffect(() => {
    if (showManageModal) {
      const c = activeChannel
      setManageName(c?.name ?? '')
      setManageDesc(c?.description ?? '')
      setMemberDraft('')
      memberInputRef.current?.focus()
    }
  }, [showManageModal, active, activeType])

  React.useEffect(() => {
    const update = (): void => setDark(isDark())
    const observer = new MutationObserver(update)
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', update)
    return () => { observer.disconnect(); if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', update) }
  }, [])

  React.useEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, files, sharedFiles, active, activeTab, searchResults])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (showChannelModal) { setShowChannelModal(false); setNewChannelName('') }
        else if (showManageModal) setShowManageModal(false)
        else if (showProfile || showSearch) { setShowProfile(false); setShowSearch(false) }
        else props.onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.onClose, showProfile, showSearch, showChannelModal, showManageModal])

  React.useEffect(() => {
    const onDocDown = (e: PointerEvent): void => {
      const target = e.target as Element | null
      if (target === null) return
      if (typeof target.closest === 'function' && target.closest('[data-lanim-trigger]') !== null) return
      const root = rootRef.current
      if (root !== null && !root.contains(target)) props.onClose()
    }
    let added = false
    const timer = window.setTimeout(() => { added = true; document.addEventListener('pointerdown', onDocDown) }, 0)
    return () => { window.clearTimeout(timer); if (added) document.removeEventListener('pointerdown', onDocDown) }
  }, [props.onClose])

  const send = (): void => {
    const text = draft.trim()
    if (text === '') return
    if (editingId !== null) {
      props.onEdit(editingId, text)
      setEditingId(null)
    } else {
      props.onSend(active, activeType, text)
    }
    setDraft('')
  }

  const onHeaderPointerDown = (e: React.PointerEvent): void => {
    const target = e.target as HTMLElement | null
    if (target !== null && target.closest('button, input, textarea, select, a') !== null) return
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onHeaderPointerMove = (e: React.PointerEvent): void => {
    if (dragRef.current === null) return
    setPos({ x: e.clientX - dragRef.current.dx, y: e.clientY - dragRef.current.dy })
  }
  const onHeaderPointerUp = (): void => { dragRef.current = null }

  const startResize = (mode: 'e' | 's' | 'se') => (e: React.PointerEvent): void => {
    e.stopPropagation()
    resizeRef.current = { sx: e.clientX, sy: e.clientY, sw: size.w, sh: size.h, mode }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onResizePointerMove = (e: React.PointerEvent): void => {
    const r = resizeRef.current
    if (r === null) return
    let w = r.sw
    let h = r.sh
    if (r.mode === 'e' || r.mode === 'se') w = r.sw + (e.clientX - r.sx)
    if (r.mode === 's' || r.mode === 'se') h = r.sh + (e.clientY - r.sy)
    setSize({ w: Math.min(Math.max(360, w), window.innerWidth - 16), h: Math.min(Math.max(440, h), window.innerHeight - 16) })
  }
  const onResizePointerUp = (): void => { resizeRef.current = null }
  const resizeHandleProps = {
    onPointerMove: onResizePointerMove,
    onPointerUp: onResizePointerUp,
    onPointerCancel: onResizePointerUp,
  }

  const createChannelSubmit = (): void => {
    const n = newChannelName.trim()
    if (n !== '') props.onCreateChannel(n, newChannelKind, newChannelDesc.trim() || undefined)
    setNewChannelName(''); setNewChannelDesc(''); setShowChannelModal(false)
  }

  const needSetup = self === null || self.accountId === ''

  const accountMap = new Map<string, Peer>()
  for (const p of peers) {
    const existing = accountMap.get(p.accountId)
    if (existing === undefined || p.lastSeen > existing.lastSeen) accountMap.set(p.accountId, p)
  }
  const accounts = [...accountMap.values()]

  const activeChannel = activeType === 'channel' && active !== '*'
    ? channels.find((c) => c.id === active)
    : active === '*' && activeType === 'channel'
      ? { id: '*', name: '公共频道', kind: 'public' as const, createdBy: '*', createdAt: 0 }
      : undefined
  const canManageActive = activeChannel !== undefined && activeChannel.id !== '*' && (activeChannel.createdBy === '*' || activeChannel.createdBy === self?.accountId)

  const convFilter = (to: string, toType: TargetType, from: string): boolean => {
    if (activeType === 'channel') return toType === 'channel' && to === active
    return toType === 'account' && ((from === active && to === (self?.accountId ?? '')) || (from === (self?.accountId ?? '') && to === active))
  }

  const visible = messages.filter((m) => {
    if (m.kind === 'system') return active === '*' && activeType === 'channel'
    return convFilter(m.to, m.toType, m.from)
  })
  const visibleFiles = files.filter((f) => convFilter(f.to, f.toType, f.from))
  type MergedItem = { _file: false; m: ChatMessage; ts: number } | { _file: true; f: FileInfo; ts: number }
  const merged: MergedItem[] = [
    ...visible.map((m): MergedItem => ({ _file: false, m, ts: m.ts })),
    ...visibleFiles.map((f): MergedItem => ({ _file: true, f, ts: f.ts })),
  ].sort((a, b) => a.ts - b.ts)

  const channelShared = activeType === 'channel' ? sharedFiles.filter((f) => f.channelId === active) : []

  const searchInput = showSearch
    ? React.createElement('div', { className: 'lim-searchbar' },
        React.createElement('input', {
          className: 'lim-input', value: searchKeyword, placeholder: '搜索历史消息…', autoFocus: true,
          onChange: (e: any) => { setSearchKeyword(e.target.value); props.onSearch(e.target.value) },
        }),
        React.createElement('button', { className: 'lim-iconbtn', onClick: () => { setShowSearch(false); setSearchKeyword(''); props.onSearch('') } }, '✕'),
      )
    : null

  const messageList = showSearch && searchResults !== null
    ? (searchResults.length === 0
        ? React.createElement('div', { className: 'lim-empty' }, '无匹配消息')
        : searchResults.map((m) => React.createElement(MessageBubble, { key: m.id, message: m, selfAccountId: self?.accountId ?? '', onRecall: props.onRecall, onEdit: (id) => { setEditingId(id); setDraft(m.body) } })))
    : (merged.length === 0
        ? React.createElement('div', { className: 'lim-empty' }, activeType === 'channel' ? '还没有消息' : '还没有私聊消息')
        : merged.map((item) => {
            if (item._file === true) {
              return React.createElement(FileBubble, { key: item.f.id, file: item.f, selfAccountId: self?.accountId ?? '' })
            }
            return React.createElement(MessageBubble, { key: item.m.id, message: item.m, selfAccountId: self?.accountId ?? '', onRecall: props.onRecall, onEdit: (id) => { setEditingId(id); setDraft(item.m.body) } })
          }))

  const fileList = activeType !== 'channel' || channelShared.length === 0
    ? React.createElement('div', { className: 'lim-empty' }, activeType === 'channel' ? '频道还没有共享文件' : '私聊没有共享文件空间')
    : React.createElement('div', { className: 'lim-shared-list' },
        channelShared.map((f) => React.createElement(SharedFileBubble, { key: f.id, file: f, self, onRemove: props.onRemoveSharedFile })),
      )

  const inputBar = needSetup || activeTab === 'files' ? null : React.createElement('div', { className: 'lim-inputbar' },
    React.createElement('label', { className: 'lim-attach', title: '发送文件' },
      '📎',
      React.createElement('input', { ref: fileRef, type: 'file', style: { display: 'none' }, onChange: (e: any) => { const f = e.target.files?.[0]; if (f) props.onSendFile(f, active, activeType); e.target.value = '' } }),
    ),
    React.createElement('input', {
      className: 'lim-input', value: draft,
      placeholder: editingId !== null ? '编辑消息…（回车保存）' : activeType === 'channel' ? (active === '*' ? '发送到公共频道…' : `发送到 ${activeChannel?.name ?? active}…`) : '发送私聊…',
      onChange: (e: any) => setDraft(e.target.value),
      onCompositionStart: () => { composingRef.current = true },
      onCompositionEnd: () => { composingRef.current = false },
      onKeyDown: (e: any) => { if (e.key === 'Enter' && !composingRef.current && !(e.nativeEvent && e.nativeEvent.isComposing)) send() },
    }),
    React.createElement('button', { className: 'lim-send', onClick: send }, editingId !== null ? '保存' : '发送'),
  )

  const fileToolbar = needSetup || activeTab !== 'files' ? null : React.createElement('div', { className: 'lim-inputbar' },
    React.createElement('label', { className: 'lim-attach', title: '上传到频道共享空间' },
      '📤',
      React.createElement('input', { ref: sharedFileRef, type: 'file', style: { display: 'none' }, onChange: (e: any) => { const f = e.target.files?.[0]; if (f && activeType === 'channel') props.onSendSharedFile(f, active); e.target.value = '' } }),
    ),
    React.createElement('div', { className: 'lim-shared-hint' }, activeType === 'channel' ? `上传到「${activeChannel?.name ?? active}」共享空间` : ''),
  )

  const tabBar = activeType === 'channel' ? React.createElement('div', { className: 'lim-tabs' },
    React.createElement('button', { className: 'lim-tab' + (activeTab === 'messages' ? ' on' : ''), onClick: () => setActiveTab('messages') }, '消息'),
    React.createElement('button', { className: 'lim-tab' + (activeTab === 'files' ? ' on' : ''), onClick: () => setActiveTab('files') }, '文件'),
  ) : null

  const manageModal = showManageModal && activeChannel !== undefined
    ? React.createElement('div', { className: 'lim-modal' },
        React.createElement('div', { className: 'lim-modal-box wide' },
          React.createElement('div', { className: 'lim-setup-title' }, `管理频道：${activeChannel.name}`),
          canManageActive ? React.createElement(React.Fragment, null,
            React.createElement('input', { className: 'lim-input', value: manageName, placeholder: '频道名', onChange: (e: any) => setManageName(e.target.value) }),
            React.createElement('input', { className: 'lim-input', value: manageDesc, placeholder: '描述（可选）', onChange: (e: any) => setManageDesc(e.target.value) }),
            React.createElement('button', { className: 'lim-send', onClick: () => { if (manageName.trim() !== '') props.onRenameChannel(activeChannel.id, manageName.trim(), manageDesc.trim() || undefined); setShowManageModal(false) } }, '保存名称/描述'),
          ) : null,
          activeChannel.kind === 'private' && canManageActive ? React.createElement(React.Fragment, null,
            React.createElement('div', { className: 'lim-row' },
              React.createElement(React.Fragment, null,
                React.createElement('input', {
                  ref: memberInputRef, className: 'lim-input', list: `lim-members-${activeChannel.id}`,
                  value: memberDraft, placeholder: '输入账号或选择在线成员',
                  onChange: (e: any) => setMemberDraft(e.target.value),
                  onKeyDown: (e: any) => { if (e.key === 'Enter' && memberDraft.trim() !== '') { props.onInviteMember(activeChannel.id, memberDraft.trim()); setMemberDraft('') } },
                }),
                React.createElement('datalist', { id: `lim-members-${activeChannel.id}` },
                  accounts.filter((a) => !(activeChannel.members ?? []).includes(a.accountId)).map((a) => React.createElement('option', { key: a.accountId, value: a.accountId }, `${a.name || a.accountId}`)),
                ),
              ),
              React.createElement('button', { className: 'lim-send', onClick: () => { if (memberDraft.trim() !== '') { props.onInviteMember(activeChannel.id, memberDraft.trim()); setMemberDraft('') } } }, '邀请'),
            ),
            React.createElement('div', { className: 'lim-member-list' },
              (activeChannel.members ?? []).map((m) => React.createElement('div', { className: 'lim-member', key: m },
                React.createElement('span', null, m),
                m !== activeChannel.createdBy ? React.createElement('button', { className: 'lim-iconbtn', title: '移除成员', onClick: () => props.onRemoveMember(activeChannel.id, m) }, '✕') : React.createElement('span', { className: 'lim-member-owner' }, '创建者'),
              )),
            ),
          ) : null,
          canManageActive ? React.createElement('button', { className: 'lim-send danger', onClick: () => { props.onDeleteChannel(activeChannel.id); setShowManageModal(false); if (active === activeChannel.id) props.onSelect('*', 'channel') } }, '解散频道') : null,
          activeChannel.kind === 'private' ? React.createElement('button', { className: 'lim-send danger', onClick: () => { props.onLeaveChannel(activeChannel.id); setShowManageModal(false); props.onSelect('*', 'channel') } }, canManageActive ? '退出（转移所有权/解散）' : '退出私有频道') : null,
          React.createElement('button', { className: 'lim-send', style: { background: 'transparent', color: 'var(--lim-muted)', border: '1px solid var(--lim-border)' }, onClick: () => setShowManageModal(false) }, '关闭'),
        ),
      )
    : null

  const profileModal = showProfile && !needSetup && self !== null
    ? React.createElement(ProfileCenter, {
        self,
        peersCount: accounts.length,
        channelsCount: channels.filter((c) => c.joined !== false).length,
        connected,
        onSetName: props.onSetName,
        onSetupPsk: props.onSetupPsk,
        onSetupPassword: props.onSetupPassword,
        onClose: () => setShowProfile(false),
      })
    : null

  const channelModal = showChannelModal
    ? React.createElement('div', { className: 'lim-modal' },
        React.createElement('div', { className: 'lim-modal-box wide' },
          React.createElement('div', { className: 'lim-setup-title' }, '新建频道'),
          React.createElement('input', { ref: channelInputRef, className: 'lim-input', value: newChannelName, placeholder: '频道名（1-32 字符）', onChange: (e: any) => setNewChannelName(e.target.value), onCompositionStart: () => { composingRef.current = true }, onCompositionEnd: () => { composingRef.current = false }, onKeyDown: (e: any) => { if (e.key === 'Enter') { if (composingRef.current || (e.nativeEvent && e.nativeEvent.isComposing)) return; createChannelSubmit() } if (e.key === 'Escape') { setNewChannelName(''); setShowChannelModal(false) } } }),
          React.createElement('input', { className: 'lim-input', value: newChannelDesc, placeholder: '描述（可选）', onChange: (e: any) => setNewChannelDesc(e.target.value) }),
          React.createElement('div', { className: 'lim-row' },
            React.createElement('select', { className: 'lim-input', value: newChannelKind, onChange: (e: any) => setNewChannelKind(e.target.value === 'private' ? 'private' : 'public') },
              React.createElement('option', { value: 'public' }, '公开频道'),
              React.createElement('option', { value: 'private' }, '私有频道（仅成员可见）'),
            ),
          ),
          React.createElement('div', { className: 'lim-modal-actions' },
            React.createElement('button', { className: 'lim-send', onClick: createChannelSubmit }, '创建'),
            React.createElement('button', { className: 'lim-send', style: { background: 'transparent', color: 'var(--lim-muted)', border: '1px solid var(--lim-border)' }, onClick: () => { setNewChannelName(''); setNewChannelDesc(''); setShowChannelModal(false) } }, '取消'),
          ),
        ),
      )
    : null

  return React.createElement('div',
    { className: 'lim-window' + (dark ? ' lim-dark' : ' lim-light'), style: { left: pos.x, top: pos.y, width: size.w, height: size.h }, ref: rootRef },
    React.createElement('div', { className: 'lim-header', onPointerDown: onHeaderPointerDown, onPointerMove: onHeaderPointerMove, onPointerUp: onHeaderPointerUp, onPointerCancel: onHeaderPointerUp },
      React.createElement('span', { className: 'lim-dot' }, '💬'),
      React.createElement('span', { className: 'lim-title' }, '局域网聊天'),
      React.createElement('span', { className: 'lim-count' }, `${accounts.length + 1} 在线`),
      React.createElement('button', { className: 'lim-iconbtn', title: '搜索', onClick: () => { setShowSearch((s) => !s); if (showSearch) { setSearchKeyword(''); props.onSearch('') } } }, '🔍'),
      React.createElement('button', { className: 'lim-iconbtn', title: '诊断日志', onClick: () => setShowLog((s) => !s) }, '🛠'),
      React.createElement('button', { className: 'lim-iconbtn', title: '个人中心', onClick: () => setShowProfile(true) }, '⚙'),
      React.createElement('button', { className: 'lim-iconbtn', title: '关闭', onClick: props.onClose }, '✕'),
    ),
    needSetup
      ? React.createElement(AccountSetup, { onSetup: props.onSetupAccount })
      : React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'lim-statusbar' },
            React.createElement('button', { className: 'lim-selfname', title: '个人中心', onClick: () => setShowProfile(true) }, `我：${self?.name ?? '…'}`),
            React.createElement('span', { className: 'lim-ip' }, self?.accountId ?? ''),
            React.createElement('span', { className: 'lim-link' + (connected ? '' : ' off'), title: connected ? '已连接宿主' : '重连中…' }, connected ? '●' : '○'),
            React.createElement('span', { className: 'lim-link', title: muted.has(active) ? '已静音，点击取消' : '点击静音当前会话', style: { cursor: 'pointer' }, onClick: () => props.onToggleMute(active) }, muted.has(active) ? '🔕' : '🔔'),
          ),
          showLog ? React.createElement('div', { className: 'lim-log' }, logs.length === 0 ? React.createElement('div', { className: 'lim-logline' }, '暂无诊断日志') : logs.map((line, i) => React.createElement('div', { className: 'lim-logline', key: i }, line))) : null,
          searchInput,
          tabBar,
          React.createElement('div', { className: 'lim-body' },
            React.createElement('div', { className: 'lim-contacts' },
              React.createElement('div', { className: 'lim-contacts-group' }, '频道'),
              React.createElement(ContactItem, { icon: '👥', name: '公共频道', active: active === '*' && activeType === 'channel', unread: unread['*'] ?? 0, muted: muted.has('*'), onClick: () => props.onSelect('*', 'channel') }),
              channels.filter((c) => c.id !== '*').map((c) => c.joined === false
                ? React.createElement(ContactItem, {
                    key: c.id,
                    icon: '○',
                    name: c.name,
                    active: false,
                    unread: 0,
                    muted: false,
                    onClick: () => { props.onJoinChannel(c.id); props.onSelect(c.id, 'channel') },
                  })
                : React.createElement(ContactItem, {
                    key: c.id,
                    icon: c.kind === 'private' ? '🔒' : '#',
                    name: c.name,
                    active: active === c.id && activeType === 'channel',
                    unread: unread[c.id] ?? 0,
                    muted: muted.has(c.id),
                    onClick: () => props.onSelect(c.id, 'channel'),
                    onManage: () => { props.onSelect(c.id, 'channel'); setShowManageModal(true) },
                    onLeave: () => { props.onLeaveChannel(c.id); if (active === c.id && activeType === 'channel') props.onSelect('*', 'channel') },
                  })),
              React.createElement('div', { className: 'lim-contact', style: { color: 'var(--lim-muted)' }, onClick: () => setShowChannelModal(true) },
                React.createElement('span', { className: 'lim-cicon' }, '＋'),
                React.createElement('span', { className: 'lim-contact-name' }, '新建频道'),
              ),
              React.createElement('div', { className: 'lim-contacts-group' }, '私聊'),
              accounts.map((p) => React.createElement(ContactItem, { key: p.accountId, icon: 'dot', name: p.name || p.accountId, active: active === p.accountId && activeType === 'account', unread: unread[p.accountId] ?? 0, muted: muted.has(p.accountId), onClick: () => props.onSelect(p.accountId, 'account') })),
            ),
            React.createElement('div', { className: 'lim-thread' },
              activeType === 'channel' ? React.createElement('div', { className: 'lim-thread-title' },
                React.createElement('span', { className: 'lim-thread-name' }, activeChannel ? `${activeChannel.kind === 'private' ? '🔒 ' : ''}${activeChannel.name}` : ''),
                activeChannel?.description ? React.createElement('span', { className: 'lim-thread-desc' }, activeChannel.description) : null,
                activeChannel !== undefined && activeChannel.id !== '*' ? React.createElement('button', { className: 'lim-iconbtn', title: '频道管理', onClick: () => setShowManageModal(true) }, '⚙') : null,
              ) : null,
              React.createElement('div', { className: 'lim-messages', ref: threadRef }, activeTab === 'files' ? fileList : messageList),
              activeTab === 'files' ? fileToolbar : inputBar,
            ),
          ),
        ),
    channelModal,
    manageModal,
    profileModal,
    React.createElement('div', { className: 'lim-resize-e', onPointerDown: startResize('e'), ...resizeHandleProps }),
    React.createElement('div', { className: 'lim-resize-s', onPointerDown: startResize('s'), ...resizeHandleProps }),
    React.createElement('div', { className: 'lim-resize-se', onPointerDown: startResize('se'), ...resizeHandleProps }),
    props.error !== null ? React.createElement('div', { className: 'lim-error', title: '点击关闭', onClick: props.onDismissError }, props.error) : null,
  )
}
