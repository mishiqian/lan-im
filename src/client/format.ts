/**
 * 客户端纯工具函数：URL、时间/大小格式化、深色模式、通知权限。
 */
import { API_ROUTE, WS_PATH } from '../protocol.ts'

/**
 * 可连的 HTTP 主机。Electron 桌面端页面跑在 dsh-app://app 上，window.location.host
 * 是 "app"，拼出来的 ws://app 必然失败；这种情况下改用宿主回推的真实 Host。
 */
let apiHost: string | undefined

export function setApiHost(host: string | undefined): void {
  apiHost = host
}

export function currentApiHost(): string {
  return apiHost ?? window.location.host
}

/**
 * 宿主的 HTTP origin。桌面端页面在 dsh-app://app 上，但框架注入的
 * __DSH_TRANSPORT__.streamBaseUrl 就是宿主 HTTP 地址（API gateway 自己也用它连 WS）。
 */
export async function resolveApiHost(): Promise<string> {
  const transport = (window as unknown as { __DSH_TRANSPORT__?: { streamBaseUrl?: string } }).__DSH_TRANSPORT__
  const base = transport?.streamBaseUrl
  if (typeof base === 'string' && base !== '') {
    try {
      const host = new URL(base, window.location.href).host
      if (host !== '') { apiHost = host; return host }
    } catch { /* 继续往下试 */ }
  }
  if (/^https?:$/.test(window.location.protocol)) { apiHost = window.location.host; return apiHost }
  try {
    const res = await fetch(API_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'info' }),
    })
    const data = await res.json() as { host?: string }
    if (typeof data.host === 'string' && /:\d+$/.test(data.host)) { apiHost = data.host; return apiHost }
  } catch { /* 问不到就用页面自己的 */ }
  return currentApiHost()
}

export function apiBase(): string {
  // 桌面端页面在 dsh-app://app 上，window.location.host 是 "app"，
  // 拼出来的 http://app/... 必然失败。宿主的 transport 才是权威地址，
  // 而且必须每次读——启动时缓存的那份可能还拿不到。
  const transport = (window as unknown as { __DSH_TRANSPORT__?: { streamBaseUrl?: string } }).__DSH_TRANSPORT__
  const base = transport?.streamBaseUrl
  if (typeof base === 'string' && base !== '') {
    try {
      const url = new URL(base, window.location.href)
      return `${url.origin}${API_ROUTE}`
    } catch { /* 落到下面的兜底 */ }
  }
  const proto = window.location.protocol === 'https:' ? 'https:' : 'http:'
  return `${proto}//${currentApiHost()}${API_ROUTE}`
}

export function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${currentApiHost()}${WS_PATH}`
}

export function formatTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}

export function isDark(): boolean {
  const attr = document.body.getAttribute('data-ds-dark-theme')
  if (attr === 'true') return true
  if (attr === 'false') return false
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function requestNotif(): void {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    try { void Notification.requestPermission() } catch { /* 忽略 */ }
  }
}
