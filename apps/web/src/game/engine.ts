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

/** 可改键的键位（存 code，如 KeyW / ArrowUp / Space）；fire 空串 = 仅鼠标/摇杆 */
export interface KeyBindings {
  up: string
  down: string
  left: string
  right: string
  interact: string
  fire: string
}

export const DEFAULT_KEYS: KeyBindings = {
  up: 'KeyW',
  down: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  interact: 'KeyE',
  fire: '',
}

export class Input {
  private keys = new Set<string>()
  /** 指针在画布逻辑坐标系（480×270）中的位置与按下状态 */
  pointer = { x: 240, y: 135, down: false }
  private extraKeyDown = new Set<(e: KeyboardEvent) => void>()
  /** 移动端虚拟摇杆：左移动 / 右瞄准射击，由 React 层注入 */
  stickMove: Vec | null = null
  stickAim: Vec | null = null
  /** 当前键位（设置面板可热更新；方向键始终作为兜底） */
  keymap: KeyBindings = { ...DEFAULT_KEYS }

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
    const k = this.keymap
    if (this.keys.has(k.left) || this.keys.has('ArrowLeft')) x -= 1
    if (this.keys.has(k.right) || this.keys.has('ArrowRight')) x += 1
    if (this.keys.has(k.up) || this.keys.has('ArrowUp')) y -= 1
    if (this.keys.has(k.down) || this.keys.has('ArrowDown')) y += 1
    if (x === 0 && y === 0 && this.stickMove) return this.stickMove
    const l = Math.hypot(x, y)
    return l > 0 ? { x: x / l, y: y / l } : { x: 0, y: 0 }
  }

  /** 是否按住射击：鼠标按住、右摇杆推出，或自定义攻击键按住。 */
  firing(): boolean {
    return this.pointer.down || this.stickAim !== null || (this.keymap.fire !== '' && this.keys.has(this.keymap.fire))
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
  | 'explode'

/**
 * WebAudio 振荡器合成音效，无音频文件。
 * 首次用户手势（pointerdown once）后创建 AudioContext，规避 WebView 自动播放限制。
 */
export class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  muted = false
  /** 主音量 0~1（设置面板可调，实时生效） */
  volume = 1

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    if (this.master) this.master.gain.value = 0.14 * this.volume
  }

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
      this.master.gain.value = 0.14 * this.volume
      this.master.connect(this.ctx.destination)
      // 首次解锁手势前就有人开了 BGM → 现在补播
      if (this.bgmWant && this.bgmOn) this.startBgm()
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
      case 'explode':
        this.tone(140, 40, 0.3, 'sawtooth', 0.8)
        this.noise(0.22, 0.6)
        break
    }
  }

  /* ---------------- 背景音乐：五声音阶芯片循环（无音频文件） ---------------- */

  /** 设置面板开关（持久化） */
  bgmOn = true
  private bgmWant = false
  private bgmGain: GainNode | null = null
  private bgmTimer: number | null = null
  private bgmStep = 0
  private bgmNextT = 0

  setBgm(on: boolean): void {
    this.bgmOn = on
    if (on) this.startBgm()
    else this.stopBgm()
  }

  startBgm(): void {
    this.bgmWant = true
    if (!this.ctx || this.bgmTimer !== null) return
    this.bgmGain = this.ctx.createGain()
    this.bgmGain.gain.value = 0.6
    this.bgmGain.connect(this.master ?? this.ctx.destination)
    this.bgmStep = 0
    this.bgmNextT = this.ctx.currentTime + 0.15
    this.bgmTimer = window.setInterval(() => this.pumpBgm(), 180)
    this.pumpBgm()
  }

  stopBgm(): void {
    this.bgmWant = false
    if (this.bgmTimer !== null) {
      window.clearInterval(this.bgmTimer)
      this.bgmTimer = null
    }
    if (this.bgmGain) {
      try {
        this.bgmGain.disconnect()
      } catch {
        /* 忽略 */
      }
      this.bgmGain = null
    }
  }

  /** 前瞻式调度：每 180ms 把未来 0.5s 内的音符排进音频时钟 */
  private pumpBgm(): void {
    if (!this.ctx || !this.bgmGain || this.muted || !this.bgmOn) return
    const STEP = 0.27 // 八分音符 ≈ 111 BPM
    while (this.bgmNextT < this.ctx.currentTime + 0.5) {
      this.bgmNote(this.bgmStep, this.bgmNextT)
      this.bgmStep = (this.bgmStep + 1) % BGM_LEAD.length
      this.bgmNextT += STEP
    }
  }

  private bgmNote(step: number, t: number): void {
    const lead = BGM_LEAD[step]!
    if (lead !== null) this.bgmTone(523.25 * 2 ** (lead / 12), t, 0.24, 'square', 0.3)
    const bass = BGM_BASS[step]!
    if (bass !== null) this.bgmTone(130.81 * 2 ** (bass / 12), t, 0.5, 'triangle', 0.42)
  }

  private bgmTone(freq: number, t: number, dur: number, type: OscillatorType, gain: number): void {
    if (!this.ctx || !this.bgmGain) return
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(g)
    g.connect(this.bgmGain)
    osc.start(t)
    osc.stop(t + dur + 0.05)
  }

  destroy(): void {
    this.stopBgm()
    try {
      void this.ctx?.close()
    } catch {
      /* 忽略 */
    }
    this.ctx = null
  }
}

/* BGM 曲谱：C 大调五声音阶（C D E G A），64 步 = 8 小节 × 8 个八分音符。
 * 主旋律为 C5 起的半音偏移，null 为休止；低音声部为 C3 起的半音偏移。 */
const BGM_LEAD: (number | null)[] = [
  4, null, 7, 9, null, 7, 4, 2,
  0, null, 2, 4, null, null, null, null,
  4, null, 7, 9, null, 12, 9, 7,
  4, null, 2, 0, null, null, null, null,
  -3, null, 0, 2, null, 4, 2, 0,
  2, null, 4, 7, null, null, null, null,
  4, 7, 9, null, 12, null, 9, 7,
  4, null, 2, 0, null, null, null, null,
]

const BGM_BASS: (number | null)[] = [
  0, null, null, null, -5, null, null, null,
  -3, null, null, null, -8, null, null, null,
  -7, null, null, null, -5, null, null, null,
  0, null, null, null, -5, null, null, null,
  -3, null, null, null, -8, null, null, null,
  -7, null, null, null, -5, null, null, null,
  -7, null, null, null, -5, null, null, null,
  0, null, null, null, 0, null, null, null,
]

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
