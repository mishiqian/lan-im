declare const __LANIM_VERSION__: string

/**
 * 客户端 UI 组件：联系人/消息/文件气泡、悬浮球、账号设置、聊天主窗口。
 */
import * as React from 'react'
import type { Channel, ChannelKind, ChatMessage, FileInfo, Peer, SelfInfo, SharedFile, TargetType } from '../protocol.ts'
import { formatSize, formatTime, isDark } from './format.ts'

/**
 * 统一图标集：24 网格、1.8 描边、currentColor。
 * 全窗只用这一套（V3：不用 ◆ ✦ → 之类的字符凑图标，也不用 emoji）。
 */
const ICON_PATHS: Record<string, React.ReactNode> = {
  search: React.createElement(React.Fragment, null,
    React.createElement('circle', { cx: 11, cy: 11, r: 7 }),
    React.createElement('path', { d: 'm16.5 16.5 4.5 4.5' })),
  activity: React.createElement('path', { d: 'M3 12h3.5l2.5-7 4 14 2.5-7H21' }),
  settings: React.createElement(React.Fragment, null,
    React.createElement('circle', { cx: 12, cy: 12, r: 3 }),
    React.createElement('path', { d: 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z' })),
  close: React.createElement('path', { d: 'M6 6l12 12M18 6 6 18' }),
  bell: React.createElement(React.Fragment, null,
    React.createElement('path', { d: 'M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8' }),
    React.createElement('path', { d: 'M10.3 21a2 2 0 0 0 3.4 0' })),
  bellOff: React.createElement(React.Fragment, null,
    React.createElement('path', { d: 'M13.7 21a2 2 0 0 1-3.4 0' }),
    React.createElement('path', { d: 'M18.6 13.4c-.4-1.4-.6-3.2-.6-5.4a6 6 0 0 0-9.3-5' }),
    React.createElement('path', { d: 'M6 8c0 5-2 6-2 6h11' }),
    React.createElement('path', { d: 'M3 3l18 18' })),
  paperclip: React.createElement('path', { d: 'M21 12.5 12.6 21a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9' }),
  download: React.createElement(React.Fragment, null,
    React.createElement('path', { d: 'M12 3v12' }),
    React.createElement('path', { d: 'm7 11 5 5 5-5' }),
    React.createElement('path', { d: 'M4 20h16' })),
  plus: React.createElement('path', { d: 'M12 5v14M5 12h14' }),
  hash: React.createElement('path', { d: 'M9 3 7 21M17 3l-2 18M4 8.5h16M3 15.5h16' }),
  lock: React.createElement(React.Fragment, null,
    React.createElement('rect', { x: 4, y: 10, width: 16, height: 11, rx: 2 }),
    React.createElement('path', { d: 'M8 10V7a4 4 0 0 1 8 0v3' })),
  users: React.createElement(React.Fragment, null,
    React.createElement('circle', { cx: 9, cy: 8, r: 3.5 }),
    React.createElement('path', { d: 'M2.5 20a6.5 6.5 0 0 1 13 0' }),
    React.createElement('path', { d: 'M16 5.2a3.5 3.5 0 0 1 0 6.6' }),
    React.createElement('path', { d: 'M18 14.4A6.5 6.5 0 0 1 21.5 20' })),
  file: React.createElement(React.Fragment, null,
    React.createElement('path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z' }),
    React.createElement('path', { d: 'M14 3v5h5' })),
  upload: React.createElement(React.Fragment, null,
    React.createElement('path', { d: 'M12 19V5' }),
    React.createElement('path', { d: 'm6 11 6-6 6 6' })),
  reply: React.createElement(React.Fragment, null,
    React.createElement('path', { d: 'M9 7 4 12l5 5' }),
    React.createElement('path', { d: 'M4 12h9a6 6 0 0 1 6 6v1' })),
  copy: React.createElement(React.Fragment, null,
    React.createElement('rect', { x: 9, y: 9, width: 11, height: 11, rx: 2 }),
    React.createElement('path', { d: 'M5 15V5a1 1 0 0 1 1-1h9' })),
  edit: React.createElement(React.Fragment, null,
    React.createElement('path', { d: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z' }),
    React.createElement('path', { d: 'm14.5 6.5 3 3' })),
  send: React.createElement(React.Fragment, null,
    React.createElement('path', { d: 'm4 12 16-8-6 16-3-6z' }),
    React.createElement('path', { d: 'm11 14 9-10' })),
}

export function Icon(props: { name: keyof typeof ICON_PATHS & string; size?: number }): React.ReactElement {
  return React.createElement('svg', {
    width: props.size ?? 16,
    height: props.size ?? 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  }, ICON_PATHS[props.name] ?? null)
}

export function ContactItem(props: { icon: string; name: string; active: boolean; unread: number; muted: boolean; onClick: () => void; onLeave?: () => void; onManage?: () => void }): React.ReactElement {
  const initials = (props.name || '?').trim().slice(0, 1).toUpperCase()
  return React.createElement('div',
    {
      className: 'lim-contact' + (props.active ? ' on' : ''),
      role: 'button',
      tabIndex: 0,
      'aria-current': props.active ? 'true' : undefined,
      onClick: props.onClick,
      onKeyDown: (e: any) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onClick() } },
    },
    props.icon === 'dot'
      ? React.createElement('span', { className: 'lim-cavatar' }, initials)
      : React.createElement('span', { className: 'lim-cicon' }, React.createElement(Icon, { name: props.icon, size: 15 })),
    React.createElement('span', { className: 'lim-contact-name', title: props.name }, props.name),
    props.muted ? React.createElement('span', { className: 'lim-contact-mute' }, React.createElement(Icon, { name: 'bellOff', size: 13 })) : null,
    props.unread > 0 ? React.createElement('span', { className: 'lim-contact-badge' }, props.unread > 99 ? '99+' : String(props.unread)) : null,
    props.onManage !== undefined ? React.createElement('button', {
      className: 'lim-channel-act', title: '频道管理', 'aria-label': '管理频道 ' + props.name,
      onClick: (e: any) => { e.stopPropagation(); props.onManage?.() },
    }, React.createElement(Icon, { name: 'settings', size: 13 })) : null,
    props.onLeave !== undefined ? React.createElement('button', {
      className: 'lim-channel-x', title: '离开频道', 'aria-label': '离开频道 ' + props.name,
      onClick: (e: any) => { e.stopPropagation(); props.onLeave?.() },
    }, React.createElement(Icon, { name: 'close', size: 13 })) : null,
  )
}

export function MessageBubble(props: {
  message: ChatMessage
  selfAccountId: string
  onRecall: (id: string) => void
  onEdit: (id: string) => void
  onReply: (message: ChatMessage) => void
  compact?: boolean
}): React.ReactElement {
  const message = props.message
  if (message.kind === 'system') {
    return React.createElement('div', { className: 'lim-sys' }, message.body)
  }
  const mine = message.local || message.from === props.selfAccountId
  const compact = props.compact === true
  const initials = (message.fromName || message.from || '?').trim().slice(0, 1).toUpperCase()

  const avatar = React.createElement('div', { className: 'lim-msg-avatar' + (compact ? ' hidden' : ''), 'aria-hidden': 'true' }, initials)
  const meta = compact
    ? null
    : React.createElement('div', { className: 'lim-msg-meta' },
        React.createElement('b', null, message.fromName || message.from),
        React.createElement('span', null, formatTime(message.ts)),
        message.edited === true ? React.createElement('span', null, '已编辑') : null,
        mine && message.toType === 'account' && message.status === 'delivered' ? React.createElement('span', null, '已送达') : null,
      )

  const quote = message.replyTo === undefined
    ? null
    : React.createElement('div', { className: 'lim-quote' },
        React.createElement('span', { className: 'lim-quote-name' }, `@${message.replyTo.fromName || '对方'}`),
        React.createElement('span', { className: 'lim-quote-body' }, message.replyTo.body),
      )

  const tools = React.createElement('div', { className: 'lim-msg-tools' },
    React.createElement('button', {
      className: 'lim-tool', title: '回复', 'aria-label': '回复这条消息',
      onClick: () => props.onReply(message),
    }, React.createElement(Icon, { name: 'reply', size: 13 })),
    React.createElement('button', {
      className: 'lim-tool', title: '复制', 'aria-label': '复制内容',
      onClick: () => { void navigator.clipboard?.writeText(message.body).catch(() => {}) },
    }, React.createElement(Icon, { name: 'copy', size: 13 })),
    mine && !message.recalled
      ? React.createElement('button', { className: 'lim-tool', title: '编辑', 'aria-label': '编辑', onClick: () => props.onEdit(message.id) }, React.createElement(Icon, { name: 'edit', size: 13 }))
      : null,
    mine && !message.recalled
      ? React.createElement('button', { className: 'lim-tool danger', title: '撤回', 'aria-label': '撤回', onClick: () => props.onRecall(message.id) }, React.createElement(Icon, { name: 'close', size: 13 }))
      : null,
  )

  if (message.recalled) {
    return React.createElement('div', { className: 'lim-msg' + (mine ? ' mine' : '') + (compact ? ' compact' : '') },
      avatar,
      React.createElement('div', { className: 'lim-msg-main' },
        meta,
        React.createElement('div', { className: 'lim-bubble recalled' }, mine ? '你撤回了一条消息' : '对方撤回了一条消息'),
      ),
    )
  }

  return React.createElement('div', { className: 'lim-msg' + (mine ? ' mine' : '') + (compact ? ' compact' : '') },
    avatar,
    React.createElement('div', { className: 'lim-msg-main' },
      meta,
      React.createElement('div', { className: 'lim-bubble-wrap' },
        React.createElement('div', { className: 'lim-bubble' }, quote, message.body),
        tools,
      ),
    ),
  )
}

export function FileBubble(props: { file: FileInfo; selfAccountId: string }): React.ReactElement {
  const mine = props.file.from === props.selfAccountId
  const url = `/lan-im/files/${props.file.id}`
  const isImage = (props.file.mime ?? '').startsWith('image/')
  const initials = (props.file.fromName || props.file.from || '?').trim().slice(0, 1).toUpperCase()
  const avatar = React.createElement('div', { className: 'lim-msg-avatar', 'aria-hidden': 'true' }, initials)
  const meta = React.createElement('div', { className: 'lim-msg-meta' },
    React.createElement('b', null, props.file.fromName || props.file.from),
    React.createElement('span', null, formatTime(props.file.ts)),
  )
  const body = isImage
    ? React.createElement('div', { className: 'lim-file-body' },
        React.createElement('img', { className: 'lim-file-img', src: url, alt: props.file.name }),
        React.createElement('div', { className: 'lim-file-caption' }, `${props.file.name} · ${formatSize(props.file.size)} · `,
          React.createElement('a', { className: 'lim-file-dl', href: url, download: props.file.name, title: '下载' }, '下载'),
        ),
      )
    : React.createElement(React.Fragment, null,
        React.createElement('span', { className: 'lim-file-icon' }, React.createElement(Icon, { name: 'file', size: 16 })),
        React.createElement('div', { className: 'lim-file-meta' },
          React.createElement('div', { className: 'lim-file-name' }, props.file.name),
          React.createElement('div', { className: 'lim-file-size' }, `${formatSize(props.file.size)}`),
        ),
        React.createElement('a', { className: 'lim-file-dl', href: url, download: props.file.name, title: '下载', 'aria-label': '下载' }, React.createElement(Icon, { name: 'download', size: 15 })),
      )
  return React.createElement('div', { className: 'lim-msg' + (mine ? ' mine' : '') },
    avatar,
    React.createElement('div', { className: 'lim-msg-main' },
      meta,
      React.createElement('div', { className: 'lim-file' + (mine ? ' mine' : '') }, body),
    ),
  )
}

/**
 * 产品标志：对话气泡 + 三个节点（与 icon.svg 同源，内联成组件以便随尺寸/底色复用）。
 * tile 给了就画圆角底板；不给则表示「画在已有底板上」，节点用 node 颜色表现镂空。
 */
export function LanImMark(props: { size: number; tile?: string; bubble?: string; node?: string }): React.ReactElement {
  const bubble = props.bubble ?? '#F0FDFA'
  const node = props.node ?? props.tile ?? '#0891B2'
  const children: React.ReactNode[] = []
  if (props.tile !== undefined) {
    children.push(React.createElement('rect', { key: 'tile', x: 4, y: 4, width: 56, height: 56, rx: 14, fill: props.tile }))
  }
  children.push(React.createElement('path', {
    key: 'bubble',
    d: 'M22 17h20a10 10 0 0 1 10 10v7a10 10 0 0 1-10 10H30l-9 7v-7a10 10 0 0 1-9-10v-7a10 10 0 0 1 10-10Z',
    fill: bubble,
  }))
  children.push(React.createElement('path', {
    key: 'link',
    d: 'm23 35.5 9-10 9 10',
    fill: 'none',
    stroke: node,
    strokeWidth: 3.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }))
  for (const [key, cx, cy] of [['a', 32, 25.5], ['b', 23, 35.5], ['c', 41, 35.5]] as Array<[string, number, number]>) {
    children.push(React.createElement('circle', { key, cx, cy, r: 4.5, fill: node }))
  }
  return React.createElement('svg', {
    className: 'lim-mark',
    width: props.size,
    height: props.size,
    viewBox: '0 0 64 64',
    role: 'img',
    'aria-label': '局域网聊天',
  }, children)
}

export function Launcher(props: { unread: number; onClick: () => void }): React.ReactElement {
  return React.createElement('button', { className: 'lim-launcher', 'data-lanim-trigger': '1', title: '局域网聊天（Ctrl+Shift+L）', onClick: props.onClick },
    React.createElement(LanImMark, { size: 26, bubble: '#ffffff', node: '#0891B2' }),
    props.unread > 0 ? React.createElement('span', { className: 'lim-badge' }, props.unread > 99 ? '99+' : String(props.unread)) : null,
  )
}

const EmptyArt = (): React.ReactElement => React.createElement('svg', {
  className: 'lim-empty-art', width: 72, height: 56, viewBox: '0 0 72 56', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
},
  React.createElement('path', { d: 'M10 8h52a8 8 0 0 1 8 8v18a8 8 0 0 1-8 8H34l-14 10v-10H10a8 8 0 0 1-8-8V16a8 8 0 0 1 8-8Z' }),
  React.createElement('circle', { cx: 26, cy: 25, r: 3.5 }),
  React.createElement('circle', { cx: 46, cy: 25, r: 3.5 }),
  React.createElement('path', { d: 'M29.5 25h13' }),
)

export function AccountSetup(props: { connected: boolean; onSetup: (username: string, displayName: string, password: string) => void }): React.ReactElement {
  const [username, setUsername] = React.useState('')
  const [displayName, setDisplayName] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [showPassword, setShowPassword] = React.useState(false)
  const submit = (): void => { const u = username.trim(); if (u === '') return; props.onSetup(u, displayName.trim(), password) }
  const initials = (displayName.trim() || username.trim() || '?').slice(0, 2).toUpperCase()
  const canSubmit = username.trim() !== '' && props.connected

  return React.createElement('div', { className: 'lim-setup' },
    React.createElement('div', { className: 'lim-setup-hero' },
      React.createElement('div', { className: 'lim-avatar' }, initials),
      React.createElement('div', null,
        React.createElement('div', { className: 'lim-setup-title' }, '创建你的账号'),
        React.createElement('div', { className: 'lim-setup-hint' }, '账号是你在网络里的身份，别人靠它找到你。'),
      ),
    ),

    React.createElement('div', { className: 'lim-section' },
      React.createElement('div', { className: 'lim-section-title' }, '账号 ID'),
      React.createElement('input', {
        className: 'lim-input', value: username, placeholder: 'alice', autoFocus: true, maxLength: 32,
        'aria-describedby': 'lim-username-hint',
        onChange: (e: any) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_.-]/g, '')),
        onKeyDown: (e: any) => { if (e.key === 'Enter') submit() },
      }),
      React.createElement('div', { className: 'lim-section-hint', id: 'lim-username-hint' }, '字母、数字、下划线、点或连字符，创建后不可更改。'),
      React.createElement('div', { className: 'lim-section-title' }, '显示名'),
      React.createElement('input', {
        className: 'lim-input', value: displayName, placeholder: '张三', maxLength: 32,
        onChange: (e: any) => setDisplayName(e.target.value),
        onKeyDown: (e: any) => { if (e.key === 'Enter') submit() },
      }),
    ),

    React.createElement('div', { className: 'lim-section' },
      React.createElement('div', { className: 'lim-section-title' }, '本机密码（可选）'),
      React.createElement('div', { className: 'lim-row' },
        React.createElement('input', {
          className: 'lim-input', type: showPassword ? 'text' : 'password', value: password, placeholder: '留空则不设密码',
          onChange: (e: any) => setPassword(e.target.value),
          onKeyDown: (e: any) => { if (e.key === 'Enter') submit() },
        }),
        React.createElement('button', { className: 'lim-mini', onClick: () => setShowPassword((v) => !v) }, showPassword ? '隐藏' : '显示'),
      ),
      React.createElement('div', { className: 'lim-section-hint' }, '仅用于打开本机的聊天窗，不参与网络通信。'),
    ),

    props.connected
      ? null
      : React.createElement('div', { className: 'lim-setup-hint lim-warn' }, '正在连接宿主，连接完成后才能创建账号。'),

    React.createElement('div', { className: 'lim-row' },
      React.createElement('button', { className: 'lim-send lim-cta', disabled: !canSubmit, onClick: submit }, '创建账号'),
    ),
  )
}

/** 枢纽可辨识名称：优先用枢纽自报的 id，localhost 这种占位就退回地址里的域名/IP */
function hubLabel(hub: HubUiState): string {
  const hubId = (hub.hubId ?? '').trim()
  if (hubId !== '' && hubId !== 'localhost') return hubId
  try {
    const url = new URL(hub.url)
    return url.host
  } catch {
    return hubId !== '' ? hubId : '枢纽'
  }
}

export interface HubUiState {
  state: 'offline' | 'connecting' | 'online'
  url: string
  hubId?: string
  lastError?: string
  managed?: boolean
  observedPin?: string
}

export function ProfileCenter(props: {
  self: SelfInfo
  peersCount: number
  channelsCount: number
  connected: boolean
  onSetName: (name: string) => void
  onSetupPsk: (psk: string) => void
  onSetupPassword: (password: string) => void
  hub: HubUiState
  onConfigureHub: (url: string, invite: string) => void
  onStartLocalHub: () => void
  onStopLocalHub: () => void
  onTrustHubPin: () => void
  onClose: () => void
}): React.ReactElement {
  const self = props.self
  const [tab, setTab] = React.useState<'account' | 'hub' | 'security'>('account')
  const [nameDraft, setNameDraft] = React.useState(self.name)
  const [pskDraft, setPskDraft] = React.useState('')
  const [showPsk, setShowPsk] = React.useState(false)
  const [passwordDraft, setPasswordDraft] = React.useState('')
  const [showPassword, setShowPassword] = React.useState(false)
  const [copied, setCopied] = React.useState<string | null>(null)
  const [hubUrl, setHubUrl] = React.useState(props.hub.url)
  const [hubInvite, setHubInvite] = React.useState('')
  const [hubBusy, setHubBusy] = React.useState(false)

  React.useEffect(() => { setNameDraft(self.name) }, [self.name])
  React.useEffect(() => { setHubUrl(props.hub.url) }, [props.hub.url])

  const copy = async (kind: string, text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      window.setTimeout(() => setCopied((v) => (v === kind ? null : v)), 1200)
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        document.body.append(ta)
        ta.select()
        document.execCommand('copy')
        ta.remove()
        setCopied(kind)
        window.setTimeout(() => setCopied((v) => (v === kind ? null : v)), 1200)
      } catch { /* 忽略 */ }
    }
  }

  const initials = (self.name || self.accountId || '?').trim().slice(0, 2).toUpperCase()
  const hubState = props.hub.state
  const hubConfigured = props.hub.url.trim() !== ''
  const hubText = hubState === 'online'
    ? `已连接 · ${hubLabel(props.hub)}`
    : hubState === 'connecting'
      ? '正在连接…'
      : hubConfigured ? '未连接' : '尚未配置枢纽'

  const kv = (label: string, value: string, kind: string): React.ReactElement =>
    React.createElement('div', { className: 'lim-kv' },
      React.createElement('span', { className: 'lim-kv-label' }, label),
      React.createElement('code', { className: 'lim-kv-value', title: value }, value),
      React.createElement('button', {
        className: 'lim-copybtn', onClick: () => { void copy(kind, value) },
        'aria-label': `复制${label}`,
      }, copied === kind ? '已复制' : '复制'),
    )

  const accountTab = React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'lim-section' },
      React.createElement('div', { className: 'lim-section-title' }, '显示名'),
      React.createElement('div', { className: 'lim-row' },
        React.createElement('input', {
          className: 'lim-input', value: nameDraft, maxLength: 32, placeholder: '输入显示名',
          onChange: (e: any) => setNameDraft(e.target.value),
          onKeyDown: (e: any) => { if (e.key === 'Enter') props.onSetName(nameDraft.trim() || self.accountId) },
        }),
        React.createElement('button', { className: 'lim-send', onClick: () => props.onSetName(nameDraft.trim() || self.accountId) }, '保存'),
      ),
      React.createElement('div', { className: 'lim-section-hint' }, '别人在会话列表里看到的名字，随时可改。'),
    ),
    React.createElement('div', { className: 'lim-section' },
      React.createElement('div', { className: 'lim-section-title' }, '身份'),
      kv('账号 ID', self.accountId || '未设置', 'account'),
      kv('节点 ID', self.nodeId, 'node'),
      React.createElement('div', { className: 'lim-section-hint' }, '账号 ID 用于别人找到你；节点 ID 标识这台设备。'),
    ),
    React.createElement('div', { className: 'lim-section' },
      React.createElement('div', { className: 'lim-section-title' }, '当前状态'),
      React.createElement('div', { className: 'lim-profile-stats' },
        React.createElement('div', { className: 'lim-stat' }, React.createElement('b', null, String(props.peersCount)), React.createElement('span', null, '在线账号')),
        React.createElement('div', { className: 'lim-stat' }, React.createElement('b', null, String(props.channelsCount)), React.createElement('span', null, '已加入频道')),
        React.createElement('div', { className: 'lim-stat' },
          React.createElement('b', { className: 'lim-stat-text' }, props.connected ? '正常' : '重连中'),
          React.createElement('span', null, '与宿主连接')),
      ),
    ),
  )

  const hubTab = React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'lim-section' },
      React.createElement('div', { className: 'lim-hub-state ' + (hubState === 'online' ? 'on' : hubConfigured ? 'off' : 'idle') },
        React.createElement('span', { className: 'lim-hub-dot' }),
        React.createElement('span', null, hubText),
      ),
      props.hub.lastError !== undefined && hubState !== 'online'
        ? React.createElement('div', { className: 'lim-hub-error' }, props.hub.lastError)
        : null,
    ),
    React.createElement('div', { className: 'lim-section' },
      React.createElement('div', { className: 'lim-section-title' }, '枢纽地址'),
      React.createElement('input', {
        className: 'lim-input', value: hubUrl, placeholder: 'wss://hub.example.com/hlp',
        onChange: (e: any) => setHubUrl(e.target.value),
      }),
      React.createElement('div', { className: 'lim-section-title' }, '邀请码'),
      React.createElement('input', {
        className: 'lim-input', value: hubInvite, placeholder: '地址里带了可留空',
        onChange: (e: any) => setHubInvite(e.target.value),
      }),
      React.createElement('div', { className: 'lim-row' },
        React.createElement('button', {
          className: 'lim-send', disabled: hubBusy,
          onClick: () => { setHubBusy(true); props.onConfigureHub(hubUrl.trim(), hubInvite.trim()); window.setTimeout(() => setHubBusy(false), 1500) },
        }, '连接'),
        React.createElement('button', {
          className: 'lim-mini', disabled: hubBusy,
          onClick: () => { setHubBusy(true); props.onStartLocalHub(); window.setTimeout(() => setHubBusy(false), 4000) },
        }, props.hub.managed === true ? '重启本机枢纽' : '在本机启动枢纽'),
        props.hub.managed === true
          ? React.createElement('button', { className: 'lim-mini', onClick: props.onStopLocalHub }, '停止')
          : null,
      ),
    ),
    props.hub.observedPin !== undefined && hubState !== 'online'
      ? React.createElement('div', { className: 'lim-section' },
          React.createElement('div', { className: 'lim-section-title' }, '证书指纹'),
          React.createElement('div', { className: 'lim-row' },
            React.createElement('code', { className: 'lim-kv-value' }, `${props.hub.observedPin.slice(0, 32)}…`),
            React.createElement('button', { className: 'lim-mini', onClick: props.onTrustHubPin }, '信任此证书'),
          ),
          React.createElement('div', { className: 'lim-section-hint' }, '自签证书会显示指纹；确认一次后会被记住。'),
        )
      : null,
    React.createElement('div', { className: 'lim-section-hint' },
      '所有通信（包括同一局域网）都经枢纽转发；内容端到端加密，枢纽只看到密文。'),
  )

  const securityTab = React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'lim-section' },
      React.createElement('div', { className: 'lim-section-title' }, '本机密码'),
      React.createElement('div', { className: 'lim-row' },
        React.createElement('input', {
          className: 'lim-input', type: showPassword ? 'text' : 'password', value: passwordDraft,
          placeholder: self.hasPassword ? '输入新密码覆盖，留空清除' : '设置后可防止他人打开聊天',
          onChange: (e: any) => setPasswordDraft(e.target.value),
          onKeyDown: (e: any) => { if (e.key === 'Enter') { props.onSetupPassword(passwordDraft); setPasswordDraft('') } },
        }),
        React.createElement('button', { className: 'lim-mini', onClick: () => setShowPassword((v) => !v) }, showPassword ? '隐藏' : '显示'),
        React.createElement('button', { className: 'lim-send', onClick: () => { props.onSetupPassword(passwordDraft); setPasswordDraft('') } }, '保存'),
      ),
      React.createElement('div', { className: 'lim-section-hint' }, self.hasPassword ? '已设置。仅作用于本机，不参与网络身份。' : '尚未设置。'),
    ),
    React.createElement('div', { className: 'lim-section' },
      React.createElement('div', { className: 'lim-section-title' }, '共享密钥 PSK'),
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
      React.createElement('div', { className: 'lim-section-hint' }, '旧版的节点间信任参数；使用枢纽时以枢纽的邀请码为准。'),
    ),
  )

  const tabButton = (id: 'account' | 'hub' | 'security', label: string): React.ReactElement =>
    React.createElement('button', {
      role: 'tab', 'aria-selected': tab === id, className: tab === id ? 'on' : '',
      onClick: () => setTab(id),
    }, label)

  return React.createElement('div', { className: 'lim-modal' },
    React.createElement('div', { className: 'lim-modal-box lim-profile' },
      React.createElement('div', { className: 'lim-profile-head' },
        React.createElement('div', { className: 'lim-avatar' }, initials),
        React.createElement('div', { className: 'lim-profile-id' },
          React.createElement('div', { className: 'lim-profile-name' }, self.name || self.accountId || '未设置'),
          React.createElement('div', { className: 'lim-profile-account' }, `@${self.accountId || '未设置账号'}`),
        ),
        React.createElement('button', { className: 'lim-iconbtn', title: '关闭', 'aria-label': '关闭', onClick: props.onClose },
          React.createElement(Icon, { name: 'close' })),
      ),

      React.createElement('div', { className: 'lim-profile-tabs', role: 'tablist' },
        tabButton('account', '账号'),
        tabButton('hub', '通信'),
        tabButton('security', '安全'),
      ),

      React.createElement('div', { className: 'lim-profile-body' },
        tab === 'account' ? accountTab : tab === 'hub' ? hubTab : securityTab,
      ),

      React.createElement('div', { className: 'lim-profile-foot' },
        React.createElement('span', { className: 'lim-profile-version' }, `lan-im ${__LANIM_VERSION__}`),
        React.createElement('button', { className: 'lim-send ghost', onClick: props.onClose }, '完成'),
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
  onSend: (to: string, toType: TargetType, body: string, replyTo?: { id: string; fromName: string; body: string }) => void
  onSetName: (name: string) => void
  onSetupAccount: (username: string, displayName: string, password: string) => void
  onSetupPsk: (psk: string) => void
  onSetupPassword: (password: string) => void
  hub: HubUiState
  onConfigureHub: (url: string, invite: string) => void
  onStartLocalHub: () => void
  onStopLocalHub: () => void
  onTrustHubPin: () => void
  onSearch: (keyword: string) => void
  onRecall: (id: string) => void
  onEdit: (id: string, body: string) => void
  onSendFile: (file: File, to: string, toType: TargetType) => void
  uploads: Record<string, { name: string; size: number; sent: number; to: string; toType: TargetType; cancelled?: boolean }>
  onCancelUpload: (uploadId: string) => void
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
      : React.createElement('span', { className: 'lim-shared-icon' }, React.createElement(Icon, { name: 'file', size: 16 })),
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
  const composerRef = React.useRef<HTMLTextAreaElement | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const [replyTarget, setReplyTarget] = React.useState<ChatMessage | null>(null)
  React.useEffect(() => {
    const el = composerRef.current
    if (el === null) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
    el.style.overflowY = el.scrollHeight > 132 ? 'auto' : 'hidden'
  }, [draft])
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
      props.onSend(active, activeType, text, replyTarget === null ? undefined : {
        id: replyTarget.id,
        fromName: replyTarget.fromName || replyTarget.from,
        body: replyTarget.body.slice(0, 120),
      })
    }
    setDraft('')
    setReplyTarget(null)
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
        React.createElement('button', { className: 'lim-iconbtn', 'aria-label': '关闭搜索', onClick: () => { setShowSearch(false); setSearchKeyword(''); props.onSearch('') } }, React.createElement(Icon, { name: 'close', size: 15 })),
      )
    : null

  const messageList = showSearch && searchResults !== null
    ? (searchResults.length === 0
        ? React.createElement('div', { className: 'lim-empty' },
            React.createElement('div', { className: 'lim-empty-title' }, '没有匹配的消息'),
            React.createElement('div', { className: 'lim-empty-hint' }, '换个关键词试试，只搜索本机保存的历史'),
          )
        : searchResults.map((m) => React.createElement(MessageBubble, { key: m.id, message: m, selfAccountId: self?.accountId ?? '', onRecall: props.onRecall, onEdit: (id) => { setEditingId(id); setDraft(m.body) } })))
    : (merged.length === 0
        ? React.createElement('div', { className: 'lim-empty' },
          React.createElement(EmptyArt, null),
          React.createElement('div', { className: 'lim-empty-title' }, activeType === 'channel' ? '这个频道还没有消息' : '还没有私聊消息'),
          React.createElement('div', { className: 'lim-empty-hint' }, activeType === 'channel' ? '说点什么，同一局域网内装了本插件的实例都会收到' : '从左侧选一个人，开始第一次对话'),
        )
        : merged.map((item, idx) => {
            if (item._file === true) {
              return React.createElement(FileBubble, { key: item.f.id, file: item.f, selfAccountId: self?.accountId ?? '' })
            }
            // 同一个人 5 分钟内的连续消息，隐藏重复的昵称与时间
            const prev = merged[idx - 1]
            const prevMsg = prev !== undefined && prev._file !== true ? prev.m : undefined
            const compact = prevMsg !== undefined
              && prevMsg.from === item.m.from
              && Math.abs(item.m.ts - prevMsg.ts) < 5 * 60 * 1000
            return React.createElement(MessageBubble, {
              key: item.m.id, message: item.m, compact, selfAccountId: self?.accountId ?? '',
              onRecall: props.onRecall,
              onEdit: (id) => { setEditingId(id); setReplyTarget(null); setDraft(item.m.body) },
              onReply: (m) => { setReplyTarget(m); setEditingId(null); window.setTimeout(() => composerRef.current?.focus(), 0) },
            })
          }))

  const fileList = activeType !== 'channel' || channelShared.length === 0
    ? React.createElement('div', { className: 'lim-empty' },
          React.createElement(EmptyArt, null),
          React.createElement('div', { className: 'lim-empty-title' }, activeType === 'channel' ? '频道还没有共享文件' : '私聊没有共享文件空间'),
          React.createElement('div', { className: 'lim-empty-hint' }, activeType === 'channel' ? '把文件上传到这里，成员按需拉取，不经过任何云端' : '私聊暂不支持共享文件空间'),
        )
    : React.createElement('div', { className: 'lim-shared-list' },
        channelShared.map((f) => React.createElement(SharedFileBubble, { key: f.id, file: f, self, onRemove: props.onRemoveSharedFile })),
      )

  const inputBar = needSetup || activeTab === 'files' ? null : React.createElement(React.Fragment, null,
    replyTarget !== null
      ? React.createElement('div', { className: 'lim-replybar' },
          React.createElement('div', { className: 'lim-replybar-text' },
            React.createElement('span', { className: 'lim-replybar-name' }, `回复 @${replyTarget.fromName || replyTarget.from}`),
            React.createElement('span', { className: 'lim-replybar-body' }, replyTarget.body),
          ),
          React.createElement('button', { className: 'lim-replybar-x', title: '取消引用', 'aria-label': '取消引用', onClick: () => setReplyTarget(null) },
            React.createElement(Icon, { name: 'close', size: 13 })),
        )
      : null,
    editingId !== null
      ? React.createElement('div', { className: 'lim-editbar' },
          React.createElement('span', null, '正在编辑这条消息'),
          React.createElement('button', {
            onClick: () => { setEditingId(null); setDraft('') },
          }, '取消'),
        )
      : null,
    React.createElement('div', { className: 'lim-inputbar' },
      React.createElement('label', { className: 'lim-attach', title: !connected ? '与宿主断开，暂不能发送文件' : '发送文件（≤20MB，也可拖进来）', style: connected ? undefined : { opacity: 0.45, cursor: 'not-allowed' } },
        React.createElement(Icon, { name: 'paperclip', size: 18 }),
        React.createElement('input', { ref: fileRef, type: 'file', style: { display: 'none' }, onChange: (e: any) => { const f = e.target.files?.[0]; if (f) props.onSendFile(f, active, activeType); e.target.value = '' } }),
      ),
      React.createElement('textarea', {
        ref: composerRef, className: 'lim-input lim-composer', rows: 1, value: draft,
        placeholder: !connected
          ? '已断开连接，正在重连…'
          : editingId !== null
            ? '编辑消息…（回车保存，Esc 取消）'
            : activeType === 'channel' ? (active === '*' ? '发送到公共频道…' : `发送到 ${activeChannel?.name ?? active}…`) : '发送私聊…',
        onChange: (e: any) => setDraft(e.target.value),
        onPaste: (e: any) => {
          const files: File[] = [...(e.clipboardData?.files ?? [])]
          if (files.length > 0) { e.preventDefault(); for (const f of files) props.onSendFile(f, active, activeType) }
        },
        onCompositionStart: () => { composingRef.current = true },
        onCompositionEnd: () => { composingRef.current = false },
        onKeyDown: (e: any) => {
          if (e.key === 'Escape' && editingId !== null) { setEditingId(null); setDraft(''); return }
          if (e.key !== 'Enter') return
          if (composingRef.current || (e.nativeEvent && e.nativeEvent.isComposing)) return
          if (e.shiftKey) return
          e.preventDefault(); send()
        },
      }),
      React.createElement('button', {
        className: 'lim-send' + (draft.trim() === '' ? ' ghost' : ''), disabled: !connected || (draft.trim() === '' && editingId === null),
        onClick: send, title: !connected ? '与宿主断开，暂不能发送' : '发送（回车）',
      }, editingId !== null
        ? '保存'
        : React.createElement(Icon, { name: 'send', size: 16 })),
    ),
  )

  const fileToolbar = needSetup || activeTab !== 'files' ? null : React.createElement('div', { className: 'lim-inputbar' },
    React.createElement('label', { className: 'lim-attach', title: '上传到频道共享空间' },
      React.createElement(Icon, { name: 'upload', size: 17 }),
      React.createElement('input', { ref: sharedFileRef, type: 'file', style: { display: 'none' }, onChange: (e: any) => { const f = e.target.files?.[0]; if (f && activeType === 'channel') props.onSendSharedFile(f, active); e.target.value = '' } }),
    ),
    React.createElement('div', { className: 'lim-shared-hint' }, activeType === 'channel' ? `上传到「${activeChannel?.name ?? active}」共享空间` : ''),
  )


  const manageModal = showManageModal && activeChannel !== undefined
    ? React.createElement('div', { className: 'lim-modal' },
        React.createElement('div', { className: 'lim-modal-box wide lim-form-modal' },
          React.createElement('div', { className: 'lim-modal-head' },
            React.createElement('div', null,
              React.createElement('div', { className: 'lim-modal-title' }, activeChannel.name),
              React.createElement('div', { className: 'lim-modal-sub' },
                activeChannel.kind === 'private' ? '私有频道 · 仅成员可见' : '公开频道 · 所有节点可见'),
            ),
            React.createElement('button', { className: 'lim-iconbtn', title: '关闭', 'aria-label': '关闭', onClick: () => setShowManageModal(false) },
              React.createElement(Icon, { name: 'close' })),
          ),

          canManageActive
            ? React.createElement('div', { className: 'lim-section' },
                React.createElement('div', { className: 'lim-section-title' }, '名称与描述'),
                React.createElement('input', { className: 'lim-input', value: manageName, placeholder: '频道名', onChange: (e: any) => setManageName(e.target.value) }),
                React.createElement('input', { className: 'lim-input', value: manageDesc, placeholder: '描述（可选）', onChange: (e: any) => setManageDesc(e.target.value) }),
                React.createElement('div', { className: 'lim-row' },
                  React.createElement('button', {
                    className: 'lim-send',
                    onClick: () => { if (manageName.trim() !== '') props.onRenameChannel(activeChannel.id, manageName.trim(), manageDesc.trim() || undefined); setShowManageModal(false) },
                  }, '保存'),
                ),
              )
            : React.createElement('div', { className: 'lim-section' },
                React.createElement('div', { className: 'lim-section-title' }, '描述'),
                React.createElement('div', { className: 'lim-section-hint' }, activeChannel.description || '这个频道没有描述'),
              ),

          activeChannel.kind === 'private' && canManageActive
            ? React.createElement('div', { className: 'lim-section' },
                React.createElement('div', { className: 'lim-section-title' }, `成员（${(activeChannel.members ?? []).length}）`),
                React.createElement('div', { className: 'lim-row' },
                  React.createElement('input', {
                    ref: memberInputRef, className: 'lim-input', list: `lim-members-${activeChannel.id}`,
                    value: memberDraft, placeholder: '输入账号邀请',
                    onChange: (e: any) => setMemberDraft(e.target.value),
                    onKeyDown: (e: any) => { if (e.key === 'Enter' && memberDraft.trim() !== '') { props.onInviteMember(activeChannel.id, memberDraft.trim()); setMemberDraft('') } },
                  }),
                  React.createElement('button', {
                    className: 'lim-send',
                    onClick: () => { if (memberDraft.trim() !== '') { props.onInviteMember(activeChannel.id, memberDraft.trim()); setMemberDraft('') } },
                  }, '邀请'),
                ),
                React.createElement('datalist', { id: `lim-members-${activeChannel.id}` },
                  accounts.filter((a) => !(activeChannel.members ?? []).includes(a.accountId)).map((a) => React.createElement('option', { key: a.accountId, value: a.accountId }, `${a.name || a.accountId}`)),
                ),
                React.createElement('div', { className: 'lim-member-list' },
                  (activeChannel.members ?? []).map((m) => React.createElement('div', { className: 'lim-member', key: m },
                    React.createElement('span', { className: 'lim-member-name' }, m),
                    m === activeChannel.createdBy
                      ? React.createElement('span', { className: 'lim-member-owner' }, '创建者')
                      : React.createElement('button', { className: 'lim-iconbtn', title: '移除成员', 'aria-label': '移除成员', onClick: () => props.onRemoveMember(activeChannel.id, m) },
                          React.createElement(Icon, { name: 'close', size: 14 })),
                  )),
                ),
              )
            : null,

          canManageActive || activeChannel.kind === 'private'
            ? React.createElement('div', { className: 'lim-section lim-danger-zone' },
                React.createElement('div', { className: 'lim-section-title' }, '危险操作'),
                React.createElement('div', { className: 'lim-section-hint' }, '这些操作不可撤销。'),
                React.createElement('div', { className: 'lim-row' },
                  canManageActive
                    ? React.createElement('button', {
                        className: 'lim-mini danger',
                        onClick: () => { props.onDeleteChannel(activeChannel.id); setShowManageModal(false); if (active === activeChannel.id) props.onSelect('*', 'channel') },
                      }, '解散频道')
                    : null,
                  activeChannel.kind === 'private'
                    ? React.createElement('button', {
                        className: 'lim-mini danger',
                        onClick: () => { props.onLeaveChannel(activeChannel.id); setShowManageModal(false); props.onSelect('*', 'channel') },
                      }, '退出频道')
                    : null,
                ),
              )
            : null,

          React.createElement('div', { className: 'lim-modal-actions' },
            React.createElement('button', { className: 'lim-send ghost', onClick: () => setShowManageModal(false) }, '关闭'),
          ),
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
        hub: props.hub,
        onConfigureHub: props.onConfigureHub,
        onStartLocalHub: props.onStartLocalHub,
        onStopLocalHub: props.onStopLocalHub,
        onTrustHubPin: props.onTrustHubPin,
        onClose: () => setShowProfile(false),
      })
    : null

  const channelModal = showChannelModal
    ? React.createElement('div', { className: 'lim-modal' },
        React.createElement('div', { className: 'lim-modal-box wide lim-form-modal' },
          React.createElement('div', { className: 'lim-modal-head' },
            React.createElement('div', null,
              React.createElement('div', { className: 'lim-modal-title' }, '新建频道'),
              React.createElement('div', { className: 'lim-modal-sub' }, '频道是共享的消息与文件空间'),
            ),
            React.createElement('button', { className: 'lim-iconbtn', title: '关闭', 'aria-label': '关闭', onClick: () => { setNewChannelName(''); setNewChannelDesc(''); setShowChannelModal(false) } },
              React.createElement(Icon, { name: 'close' })),
          ),

          React.createElement('div', { className: 'lim-section' },
            React.createElement('div', { className: 'lim-section-title' }, '频道名'),
            React.createElement('input', {
              ref: channelInputRef, className: 'lim-input', value: newChannelName, placeholder: '例如：产品讨论',
              onChange: (e: any) => setNewChannelName(e.target.value),
              onCompositionStart: () => { composingRef.current = true },
              onCompositionEnd: () => { composingRef.current = false },
              onKeyDown: (e: any) => {
                if (e.key === 'Enter') { if (composingRef.current || (e.nativeEvent && e.nativeEvent.isComposing)) return; createChannelSubmit() }
                if (e.key === 'Escape') { setNewChannelName(''); setNewChannelDesc(''); setShowChannelModal(false) }
              },
            }),
            React.createElement('div', { className: 'lim-section-title' }, '描述'),
            React.createElement('input', { className: 'lim-input', value: newChannelDesc, placeholder: '可选，一句话说明用途', onChange: (e: any) => setNewChannelDesc(e.target.value) }),
          ),

          React.createElement('div', { className: 'lim-section' },
            React.createElement('div', { className: 'lim-section-title' }, '可见性'),
            React.createElement('select', { className: 'lim-select', value: newChannelKind, onChange: (e: any) => setNewChannelKind(e.target.value === 'private' ? 'private' : 'public') },
              React.createElement('option', { value: 'public' }, '公开频道 · 所有节点可见'),
              React.createElement('option', { value: 'private' }, '私有频道 · 仅成员可见'),
            ),
            React.createElement('div', { className: 'lim-section-hint' }, '创建后可在频道管理里调整名称与成员。'),
          ),

          React.createElement('div', { className: 'lim-modal-actions' },
            React.createElement('button', { className: 'lim-send ghost', onClick: () => { setNewChannelName(''); setNewChannelDesc(''); setShowChannelModal(false) } }, '取消'),
            React.createElement('button', { className: 'lim-send', onClick: createChannelSubmit }, '创建'),
          ),
        ),
      )
    : null

  const meName = self?.name ?? '…'
  const meInitials = (meName === '' ? '?' : meName).slice(0, 2).toUpperCase()

  return React.createElement('div',
    {
      className: 'lim-window', style: { left: pos.x, top: pos.y, width: size.w, height: size.h }, ref: rootRef,
      onDragOver: (e: any) => { if (needSetup) return; e.preventDefault(); if (!dragging) setDragging(true) },
      onDragLeave: (e: any) => {
        const next = e.relatedTarget as Node | null
        if (next === null || !(e.currentTarget as Node).contains(next)) setDragging(false)
      },
      onDrop: (e: any) => {
        e.preventDefault(); setDragging(false)
        const files: File[] = [...(e.dataTransfer?.files ?? [])]
        for (const f of files) props.onSendFile(f, active, activeType)
      },
    },
    React.createElement('div', { className: 'lim-header', onPointerDown: onHeaderPointerDown, onPointerMove: onHeaderPointerMove, onPointerUp: onHeaderPointerUp, onPointerCancel: onHeaderPointerUp },
      React.createElement(LanImMark, { size: 20, tile: '#0891B2' }),
      React.createElement('span', { className: 'lim-title' }, '局域网聊天'),
      React.createElement('span', { className: 'lim-ver', title: '插件版本' }, __LANIM_VERSION__),
      React.createElement('span', {
        className: 'lim-count' + (connected ? '' : ' off'),
        title: connected ? '已连接宿主' : '与宿主断开，正在重连',
      }, connected ? `${accounts.length + 1} 在线` : '离线'),
      React.createElement('div', { className: 'lim-actions' },
        React.createElement('button', {
          className: 'lim-iconbtn', title: '搜索消息', 'aria-label': '搜索消息', 'aria-pressed': showSearch,
          onClick: () => { setShowSearch((v) => !v); if (showSearch) { setSearchKeyword(''); props.onSearch('') } },
        }, React.createElement(Icon, { name: 'search' })),
        React.createElement('button', {
          className: 'lim-iconbtn', title: '诊断日志', 'aria-label': '诊断日志', 'aria-pressed': showLog,
          onClick: () => setShowLog((v) => !v),
        }, React.createElement(Icon, { name: 'activity' })),
        React.createElement('button', {
          className: 'lim-iconbtn', title: '个人中心', 'aria-label': '个人中心',
          onClick: () => setShowProfile(true),
        }, React.createElement(Icon, { name: 'settings' })),
        React.createElement('button', {
          className: 'lim-iconbtn', title: '关闭（Esc）', 'aria-label': '关闭聊天窗',
          onClick: props.onClose,
        }, React.createElement(Icon, { name: 'close' })),
      ),
    ),
    dragging && !needSetup
      ? React.createElement('div', { className: 'lim-dropzone' },
          React.createElement('div', { className: 'lim-dropzone-box' },
            React.createElement(Icon, { name: 'upload', size: 22 }),
            React.createElement('span', null, `松手发送到「${activeType === 'channel' ? (active === '*' ? '公共频道' : (activeChannel?.name ?? active)) : (accounts.find((a) => a.accountId === active)?.name || active)}」`),
          ),
        )
      : null,
    needSetup
      ? React.createElement(AccountSetup, { connected, onSetup: props.onSetupAccount })
      : React.createElement(React.Fragment, null,
          showLog
            ? React.createElement('div', { className: 'lim-log' },
                logs.length === 0
                  ? React.createElement('div', { className: 'lim-logline' }, '暂无诊断日志')
                  : logs.map((line, i) => React.createElement('div', { className: 'lim-logline', key: i }, line)))
            : null,
          searchInput,
          React.createElement('div', { className: 'lim-body' },
            React.createElement('div', { className: 'lim-contacts' },
              React.createElement('div', { className: 'lim-contacts-scroll' },
                React.createElement('div', { className: 'lim-contacts-group' }, '频道'),
                React.createElement(ContactItem, { icon: 'hash', name: '公共频道', active: active === '*' && activeType === 'channel', unread: unread['*'] ?? 0, muted: muted.has('*'), onClick: () => props.onSelect('*', 'channel') }),
                channels.filter((c) => c.id !== '*').map((c) => c.joined === false
                  ? React.createElement(ContactItem, {
                      key: c.id,
                      icon: 'plus',
                      name: c.name,
                      active: false,
                      unread: 0,
                      muted: false,
                      onClick: () => { props.onJoinChannel(c.id); props.onSelect(c.id, 'channel') },
                    })
                  : React.createElement(ContactItem, {
                      key: c.id,
                      icon: c.kind === 'private' ? 'lock' : 'hash',
                      name: c.name,
                      active: active === c.id && activeType === 'channel',
                      unread: unread[c.id] ?? 0,
                      muted: muted.has(c.id),
                      onClick: () => props.onSelect(c.id, 'channel'),
                      onManage: () => { props.onSelect(c.id, 'channel'); setShowManageModal(true) },
                      onLeave: () => { props.onLeaveChannel(c.id); if (active === c.id && activeType === 'channel') props.onSelect('*', 'channel') },
                    })),
                React.createElement('button', { className: 'lim-newchannel', onClick: () => setShowChannelModal(true) },
                  React.createElement('span', { className: 'lim-cicon' }, React.createElement(Icon, { name: 'plus', size: 15 })),
                  '新建频道',
                ),
              React.createElement('div', { className: 'lim-dm-group' },
                React.createElement('div', { className: 'lim-contacts-group' }, accounts.length > 0 ? `私聊 · ${accounts.length}` : '私聊'),
React.createElement('div', { className: 'lim-dm-scroll' },
                  accounts.length === 0
                    ? React.createElement('div', { className: 'lim-contact', style: { color: 'var(--lim-faint)', cursor: 'default' } },
                        React.createElement('span', { className: 'lim-contact-name' }, '同一局域网暂时没人'),
                      )
                    : accounts.map((p) => React.createElement(ContactItem, { key: p.accountId, icon: 'dot', name: p.name || p.accountId, active: active === p.accountId && activeType === 'account', unread: unread[p.accountId] ?? 0, muted: muted.has(p.accountId), onClick: () => props.onSelect(p.accountId, 'account') })),
                ),
              ),
              ),
              React.createElement('div', { className: 'lim-me' },
                React.createElement('span', { className: 'lim-me-avatar' }, meInitials),
                React.createElement('span', { className: 'lim-me-name', title: '个人中心' },
                  meName,
                  React.createElement('span', { className: 'lim-me-id' }, `@${self?.accountId ?? ''}`),
                ),
                React.createElement('button', {
                  className: 'lim-iconbtn', title: muted.has(active) ? '取消静音当前会话' : '静音当前会话',
                  'aria-label': '静音当前会话', 'aria-pressed': muted.has(active),
                  onClick: () => props.onToggleMute(active),
                }, React.createElement(Icon, { name: muted.has(active) ? 'bellOff' : 'bell', size: 15 })),
                React.createElement('span', {
                  className: 'lim-me-dot' + (connected ? '' : ' off'),
                  title: connected ? '已连接宿主' : '与宿主断开',
                }),
              ),
            ),
            React.createElement('div', { className: 'lim-thread' },
              React.createElement('div', { className: 'lim-thread-title' },
                activeType === 'account'
                  ? React.createElement('span', { className: 'lim-cavatar' },
                      (accounts.find((a) => a.accountId === active)?.name || active).trim().slice(0, 1).toUpperCase())
                  : React.createElement('span', { className: 'lim-cicon' },
                      React.createElement(Icon, { name: activeChannel?.kind === 'private' ? 'lock' : 'hash', size: 15 })),
                React.createElement('span', { className: 'lim-thread-name' },
                  activeType === 'account'
                    ? (accounts.find((a) => a.accountId === active)?.name || active)
                    : (activeChannel?.name ?? '')),
                activeType === 'channel' && activeChannel?.description
                  ? React.createElement('span', { className: 'lim-thread-desc' }, activeChannel.description)
                  : React.createElement('span', { className: 'lim-thread-desc' }),
                activeType === 'channel' ? React.createElement('div', { className: 'lim-seg' },
                  React.createElement('button', { className: activeTab === 'messages' ? 'on' : '', 'aria-pressed': activeTab === 'messages', onClick: () => setActiveTab('messages') }, '消息'),
                  React.createElement('button', { className: activeTab === 'files' ? 'on' : '', 'aria-pressed': activeTab === 'files', onClick: () => setActiveTab('files') }, '文件'),
                ) : null,
                activeType === 'channel' && activeChannel !== undefined && activeChannel.id !== '*'
                  ? React.createElement('button', { className: 'lim-iconbtn', title: '频道管理', 'aria-label': '频道管理', onClick: () => setShowManageModal(true) }, React.createElement(Icon, { name: 'settings', size: 15 }))
                  : null,
              ),
              React.createElement('div', { className: 'lim-messages', ref: threadRef },
                React.createElement('div', { className: 'lim-messages-inner' },
                  activeTab === 'files' ? fileList : messageList,
                  activeTab === 'files' ? null : Object.entries(props.uploads).map(([id, up]) => React.createElement('div', { key: id, className: 'lim-upload' },
                    React.createElement('div', { className: 'lim-upload-head' },
                      React.createElement('span', { className: 'lim-upload-name' }, up.name),
                      React.createElement('button', {
                        className: 'lim-upload-x', title: '取消发送', 'aria-label': '取消发送',
                        onClick: () => props.onCancelUpload(id),
                      }, React.createElement(Icon, { name: 'close', size: 12 })),
                    ),
                    React.createElement('div', { className: 'lim-upload-bar' },
                      React.createElement('span', { style: { width: `${Math.min(100, Math.round((up.sent / Math.max(1, Math.ceil(up.size / 49152))) * 100))}%` } }),
                    ),
                    React.createElement('div', { className: 'lim-upload-sub' },
                      up.cancelled === true ? '已取消' : `发送中 ${Math.min(100, Math.round((up.sent / Math.max(1, Math.ceil(up.size / 49152))) * 100))}%`),
                  ))),
              activeTab === 'files' ? fileToolbar : inputBar,
            ),
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
