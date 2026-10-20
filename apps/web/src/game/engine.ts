/**
 * 迷你引擎：数学工具、种子随机、输入（键盘 + 指针 + 虚拟摇杆）、WebAudio 合成音效、粒子。
 * 零第三方依赖，全部逻辑服务于 480×270 逻辑分辨率的像素地牢。
 */

export interface Vec {
  x: number
  y: number
}

export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v)
export const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(bx - ax, by - ay)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** mulberry32 种子随机——同一关每次进入的地形/刷怪保持可复现。 */
export class Rng {
  private s: number
  constructor(seed: number) {
    this.s = seed >>> 0
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1))
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!
  }
}

/* ------------------------------------------------------------------ 输入 */

export interface StickState {
  /** 归一化向量，长度 ≤ 1；null 表示未激活 */
  vec: Vec | null
}

export class Input {
  private keys = new Set<string>()
  /** 指针在画布逻辑坐标系（480×270）中的位置与按下状态 */
  pointer = { x: 240, y: 135, down: false }
  private extraKeyDown = new Set<(e: KeyboardEvent) => void>()
  /** 移动端虚拟摇杆：左移动 / 右瞄准射击，由 React 层注入 */
  stickMove: Vec | null = null
  stickAim: Vec | null = null

  constructor(private target: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    target.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.onPointerUp)
    // 防止方向键 / 空格滚动页面
    window.addEventListener('keydown', this.preventScroll, { passive: false })
  }

  private preventScroll = (e: KeyboardEvent): void => {
    const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']
    if (keys.includes(e.code)) e.preventDefault()
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code)
    for (const fn of this.extraKeyDown) fn(e)
  }
  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code)
  }

  private toLocal(e: PointerEvent): Vec {
    const r = this.target.getBoundingClientRect()
    return {
      x: clamp(((e.clientX - r.left) / r.width) * 480, 0, 480),
      y: clamp(((e.clientY - r.top) / r.height) * 270, 0, 270),
    }
  }

  private onPointerDown = (e: PointerEvent): void => {
    const p = this.toLocal(e)
    this.pointer.x = p.x
    this.pointer.y = p.y
    this.pointer.down = true
  }
  private onPointerMove = (e: PointerEvent): void => {
    const p = this.toLocal(e)
    this.pointer.x = p.x
    this.pointer.y = p.y
  }
  private onPointerUp = (): void => {
    this.pointer.down = false
  }

  onKeyOnce(fn: (e: KeyboardEvent) => void): void {
    this.extraKeyDown.add(fn)
  }

  /** 移动向量：键盘优先，其次左摇杆。长度 ≤ 1。 */
  moveAxis(): Vec {
    let x = 0
    let y = 0
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y -= 1
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y += 1
    if (x === 0 && y === 0 && this.stickMove) return this.stickMove
    const l = Math.hypot(x, y)
    return l > 0 ? { x: x / l, y: y / l } : { x: 0, y: 0 }
  }

  /** 是否按住射击：鼠标按住或右摇杆推出。 */
  firing(): boolean {
    return this.pointer.down || this.stickAim !== null
  }

  /** 瞄准方向（世界坐标）。 */
  aimFrom(px: number, py: number): number {
    if (this.stickAim && (this.stickAim.x !== 0 || this.stickAim.y !== 0)) {
      return Math.atan2(this.stickAim.y, this.stickAim.x)
    }
    return Math.atan2(this.pointer.y - py, this.pointer.x - px)
  }

  has(code: string): boolean {
    return this.keys.has(code)
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    this.target.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.onPointerUp)
    window.removeEventListener('keydown', this.preventScroll)
  }
}

/* ------------------------------------------------------------------ 音效 */

export type SfxName =
  | 'shoot'
  | 'hit'
  | 'enemyDie'
  | 'playerHurt'
  | 'coin'
  | 'chest'
  | 'correct'
  | 'wrong'
  | 'door'
  | 'upgrade'
  | 'boss'
  | 'victory'
  | 'select'
  | 'heart'

/**
 * WebAudio 振荡器合成音效，无音频文件。
 * 首次用户手势（pointerdown once）后创建 AudioContext，规避 WebView 自动播放限制。
 */
export class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  muted = false

  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume()
      return
    }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return
      this.ctx = new AC()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.14
      this.master.connect(this.ctx.destination)
    } catch {
      this.ctx = null
    }
  }

  private tone(
    from: number,
    to: number,
    dur: number,
    type: OscillatorType,
    gain = 1,
    delay = 0,
  ): void {
    if (!this.ctx || !this.master || this.muted) return
    const t0 = this.ctx.currentTime + delay
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(Math.max(20, from), t0)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g)
    g.connect(this.master)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  private noise(dur: number, gain = 0.5, delay = 0): void {
    if (!this.ctx || !this.master || this.muted) return
    const t0 = this.ctx.currentTime + delay
    const n = Math.floor(this.ctx.sampleRate * dur)
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n)
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    const g = this.ctx.createGain()
    g.gain.value = gain
    src.connect(g)
    g.connect(this.master)
    src.start(t0)
  }

  play(name: SfxName): void {
    if (!this.ctx || this.muted) return
    switch (name) {
      case 'shoot':
        this.tone(760, 320, 0.07, 'square', 0.5)
        break
      case 'hit':
        this.noise(0.05, 0.35)
        break
      case 'enemyDie':
        this.tone(300, 60, 0.18, 'sawtooth', 0.5)
        this.noise(0.12, 0.4)
        break
      case 'playerHurt':
        this.tone(220, 90, 0.25, 'square', 0.7)
        break
      case 'coin':
        this.tone(1046, 1046, 0.06, 'sine', 0.7)
        this.tone(1568, 1568, 0.1, 'sine', 0.7, 0.06)
        break
      case 'chest':
        this.tone(180, 320, 0.12, 'triangle', 0.8)
        this.tone(520, 780, 0.16, 'triangle', 0.8, 0.1)
        break
      case 'correct':
        this.tone(523, 523, 0.09, 'sine', 0.8)
        this.tone(659, 659, 0.09, 'sine', 0.8, 0.09)
        this.tone(784, 784, 0.16, 'sine', 0.8, 0.18)
        break
      case 'wrong':
        this.tone(180, 120, 0.3, 'sawtooth', 0.6)
        break
      case 'door':
        this.tone(140, 90, 0.18, 'triangle', 0.8)
        this.noise(0.08, 0.3)
        break
      case 'upgrade':
        this.tone(392, 392, 0.08, 'square', 0.6)
        this.tone(523, 523, 0.08, 'square', 0.6, 0.08)
        this.tone(784, 784, 0.14, 'square', 0.6, 0.16)
        break
      case 'boss':
        this.tone(90, 45, 0.8, 'sawtooth', 0.9)
        this.noise(0.5, 0.5)
        break
      case 'victory':
        this.tone(523, 523, 0.12, 'sine', 0.8)
        this.tone(659, 659, 0.12, 'sine', 0.8, 0.12)
        this.tone(784, 784, 0.12, 'sine', 0.8, 0.24)
        this.tone(1046, 1046, 0.3, 'sine', 0.8, 0.36)
        break
      case 'select':
        this.tone(660, 880, 0.06, 'square', 0.5)
        break
      case 'heart':
        this.tone(660, 990, 0.12, 'sine', 0.7)
        break
    }
  }

  destroy(): void {
    try {
      void this.ctx?.close()
    } catch {
      /* 忽略 */
    }
    this.ctx = null
  }
}

/* ------------------------------------------------------------------ 粒子 */

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  color: string
  size: number
  gravity: number
}

export class Particles {
  list: Particle[] = []

  burst(x: number, y: number, color: string, n: number, spd = 60, life = 0.5, size = 2): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const s = spd * (0.4 + Math.random() * 0.8)
      this.list.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life,
        max: life,
        color,
        size,
        gravity: 0,
      })
    }
  }

  trail(x: number, y: number, color: string): void {
    this.list.push({ x, y, vx: 0, vy: 0, life: 0.25, max: 0.25, color, size: 1, gravity: 0 })
  }

  update(dt: number): void {
    for (const p of this.list) {
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += p.gravity * dt
      p.life -= dt
    }
    this.list = this.list.filter((p) => p.life > 0)
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.list) {
      ctx.globalAlpha = Math.max(0, p.life / p.max)
      ctx.fillStyle = p.color
      ctx.fillRect(Math.round(p.x - p.size / 2), Math.round(p.y - p.size / 2), p.size, p.size)
    }
    ctx.globalAlpha = 1
  }
}

/* ------------------------------------------------------------------ 画布 */

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  return cv
}
