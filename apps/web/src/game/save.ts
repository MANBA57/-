/**
 * 小游戏本地存档：最高通关关卡 + 钱币图鉴收集 + 音效开关/音量 + 键位 + 单局进度。
 * 照 compare.ts 的模式：isBrowser 守卫（预渲染 Node 环境）+ try/catch（隐私模式）。
 */

import { DEFAULT_KEYS, type KeyBindings } from './engine'
import { WEAPONS } from './data/weapons'

const BEST_KEY = 'coinmuseum:game-best'
const COLLECTION_KEY = 'coinmuseum:game-collection'
const SFX_KEY = 'coinmuseum:game-sfx'
const VOL_KEY = 'coinmuseum:game-vol'
const KEYS_KEY = 'coinmuseum:game-keys'
const AUTOAIM_KEY = 'coinmuseum:game-autoaim'
const RUN_KEY = 'coinmuseum:game-run'

const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined'

/** 武器数值块的默认值（续玩档缺字段时兜底）。 */
const WEAPON_DEFAULTS = {
  weaponId: 'rapid',
  dmg: 1,
  interval: 0.42,
  pierce: 0,
  projectiles: 1,
  upgrades: 0,
  crit: 0,
  speedMul: 1,
  energyMax: 100,
  regenMul: 1,
}

/** 进行中的单局状态：续玩时恢复武器（含武器形态）与血量上限（与死亡重试保留武器的规则一致）。 */
export interface RunState {
  level: number
  maxHp: number
  weapon: typeof WEAPON_DEFAULTS
}

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

export function loadVol(): number {
  if (!isBrowser) return 1
  try {
    const v = Number.parseFloat(localStorage.getItem(VOL_KEY) ?? '1')
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1
  } catch {
    return 1
  }
}

export function saveVol(v: number): void {
  if (!isBrowser) return
  try {
    localStorage.setItem(VOL_KEY, String(Math.max(0, Math.min(1, v))))
  } catch {
    /* 忽略 */
  }
}

export function loadAutoAim(): boolean {
  if (!isBrowser) return false
  try {
    return localStorage.getItem(AUTOAIM_KEY) === 'on'
  } catch {
    return false
  }
}

export function saveAutoAim(on: boolean): void {
  if (!isBrowser) return
  try {
    localStorage.setItem(AUTOAIM_KEY, on ? 'on' : 'off')
  } catch {
    /* 忽略 */
  }
}

const BGM_KEY = 'coinmuseum:game-bgm'

export function loadBgm(): boolean {
  if (!isBrowser) return true
  try {
    return localStorage.getItem(BGM_KEY) !== 'off'
  } catch {
    return true
  }
}

export function saveBgm(on: boolean): void {
  if (!isBrowser) return
  try {
    localStorage.setItem(BGM_KEY, on ? 'on' : 'off')
  } catch {
    /* 忽略 */
  }
}

export function loadKeys(): KeyBindings {
  if (!isBrowser) return { ...DEFAULT_KEYS }
  try {
    const raw = localStorage.getItem(KEYS_KEY)
    if (!raw) return { ...DEFAULT_KEYS }
    const k = JSON.parse(raw) as Partial<KeyBindings>
    const out = { ...DEFAULT_KEYS }
    for (const slot of ['up', 'down', 'left', 'right', 'interact', 'fire'] as const) {
      if (typeof k[slot] === 'string' && k[slot]) out[slot] = k[slot]!
    }
    return out
  } catch {
    return { ...DEFAULT_KEYS }
  }
}

export function saveKeys(k: KeyBindings): void {
  if (!isBrowser) return
  try {
    localStorage.setItem(KEYS_KEY, JSON.stringify(k))
  } catch {
    /* 忽略 */
  }
}

export function loadRun(): RunState | null {
  if (!isBrowser) return null
  try {
    const raw = localStorage.getItem(RUN_KEY)
    if (!raw) return null
    const r = JSON.parse(raw) as Partial<RunState>
    if (typeof r !== 'object' || r === null || typeof r.level !== 'number' || typeof r.maxHp !== 'number') return null
    const w = (r.weapon ?? {}) as Record<string, unknown>
    const num = (key: string, d: number): number =>
      typeof w[key] === 'number' && Number.isFinite(w[key]) ? (w[key] as number) : d
    const weaponId = typeof w.weaponId === 'string' && WEAPONS[w.weaponId] ? w.weaponId : 'rapid'
    return {
      level: r.level,
      maxHp: r.maxHp,
      weapon: {
        weaponId,
        dmg: num('dmg', 1),
        interval: num('interval', 0.42),
        pierce: num('pierce', 0),
        projectiles: num('projectiles', 1),
        upgrades: num('upgrades', 0),
        crit: num('crit', 0),
        speedMul: num('speedMul', 1),
        energyMax: num('energyMax', 100),
        regenMul: num('regenMul', 1),
      },
    }
  } catch {
    return null
  }
}

export function saveRun(run: RunState): void {
  if (!isBrowser) return
  try {
    localStorage.setItem(RUN_KEY, JSON.stringify(run))
  } catch {
    /* 忽略 */
  }
}

export function clearRun(): void {
  if (!isBrowser) return
  try {
    localStorage.removeItem(RUN_KEY)
  } catch {
    /* 忽略 */
  }
}
