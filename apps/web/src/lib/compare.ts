/**
 * 「加入对比」的跨页状态。
 *
 * 用 localStorage 持久化 + useSyncExternalStore 订阅，不引入状态管理库。
 * 上限 3 枚 —— 后端 /coins/compare 也只接受 2~3 个。
 */

import { useSyncExternalStore } from 'react'

const KEY = 'coin-museum:compare'
export const COMPARE_MAX = 3

type Listener = () => void

const listeners = new Set<Listener>()

/**
 * 是否处于浏览器环境。
 * 构建期的预渲染会在 Node 里 import 本模块，那里没有 localStorage / window；
 * 不做判断的话模块加载阶段就会抛 ReferenceError，整个预渲染失败。
 */
const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined'

function read(): string[] {
  if (!isBrowser) return []
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

// 快照必须是稳定引用，否则 useSyncExternalStore 会无限重渲染
let snapshot: string[] = read()

function emit() {
  snapshot = read()
  listeners.forEach((l) => l())
}

function write(next: string[]) {
  if (isBrowser) {
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* 隐私模式下 localStorage 可能不可用，退化为仅内存 */
    }
  }
  emit()
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  if (!isBrowser) return () => listeners.delete(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) emit()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export const compareStore = {
  subscribe,
  getSnapshot: () => snapshot,
  toggle(slug: string): boolean {
    const cur = snapshot
    if (cur.includes(slug)) {
      write(cur.filter((s) => s !== slug))
      return false
    }
    if (cur.length >= COMPARE_MAX) return false
    write([...cur, slug])
    return true
  },
  remove(slug: string) {
    write(snapshot.filter((s) => s !== slug))
  },
  clear() {
    write([])
  },
  isFull(): boolean {
    return snapshot.length >= COMPARE_MAX
  },
}

export function useCompareList(): string[] {
  return useSyncExternalStore(compareStore.subscribe, compareStore.getSnapshot, () => [])
}
