/**
 * 小游戏本地存档：最高通关关卡 + 钱币图鉴收集 + 音效开关。
 * 照 compare.ts 的模式：isBrowser 守卫（预渲染 Node 环境）+ try/catch（隐私模式）。
 */

const BEST_KEY = 'coinmuseum:game-best'
const COLLECTION_KEY = 'coinmuseum:game-collection'
const SFX_KEY = 'coinmuseum:game-sfx'

const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined'

export function loadBest(): number {
  if (!isBrowser) return 0
  try {
    const v = Number.parseInt(localStorage.getItem(BEST_KEY) ?? '0', 10)
    return Number.isFinite(v) && v >= 0 && v <= 7 ? v : 0
  } catch {
    return 0
  }
}

export function saveBest(level: number): void {
  if (!isBrowser) return
  try {
    if (level > loadBest()) localStorage.setItem(BEST_KEY, String(Math.min(7, level)))
  } catch {
    /* 隐私模式写入失败可忽略 */
  }
}

export function loadCollection(): string[] {
  if (!isBrowser) return []
  try {
    const raw = localStorage.getItem(COLLECTION_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

export function addCollection(slug: string): void {
  if (!isBrowser) return
  try {
    const list = loadCollection()
    if (!list.includes(slug)) {
      list.push(slug)
      localStorage.setItem(COLLECTION_KEY, JSON.stringify(list))
    }
  } catch {
    /* 忽略 */
  }
}

export function loadSfx(): boolean {
  if (!isBrowser) return true
  try {
    return localStorage.getItem(SFX_KEY) !== 'off'
  } catch {
    return true
  }
}

export function saveSfx(on: boolean): void {
  if (!isBrowser) return
  try {
    localStorage.setItem(SFX_KEY, on ? 'on' : 'off')
  } catch {
    /* 忽略 */
  }
}
