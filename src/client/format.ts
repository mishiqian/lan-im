/**
 * 客户端纯工具函数：URL、时间/大小格式化、深色模式、通知权限。
 */
import { WS_PATH } from '../protocol.ts'

export function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}${WS_PATH}`
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
