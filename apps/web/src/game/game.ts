/**
 * 玩法核心：元气骑士式房间地牢状态机。
 * 每关 = 中央大厅 + 3 战斗房（各一宝箱）+ 关底（传送门 / BOSS）。
 * 进战斗房锁门刷怪 → 清完解锁开箱 → 答题（React 弹层接管）→ 答对强化武器。
 */

import { Input, Sfx, Particles, Rng, clamp, dist, type Vec } from './engine'
import { spriteCanvas, spriteWhite, ERA_PALETTES } from './sprites'
import { TILE, ROOM_TW, ROOM_TH, TEMPLATES, LEVELS, UPGRADE_CYCLE, type Arch } from './data/levels'
import type { Wave } from './data/levels'

export const VIEW_W = 480
export const VIEW_H = 270
const ROOM_H_PX = ROOM_TH * TILE // 256
const HUD_Y = ROOM_H_PX // HUD 条起始 y

/* ------------------------------------------------------------ 类型 */

interface DoorSpot {
  tx: number
  ty: number
  toRoom: string
  toTx: number
  toTy: number
  /** final = 大厅通往关底的大门（需清完三房） */
  kind: 'combat' | 'return' | 'final' | 'finalReturn'
}

interface Chest {
  x: number
  y: number
  opened: boolean
}

interface Room {
  key: string
  solid: Uint8Array // 0 地 1 墙 2 岩
  doors: DoorSpot[]
  chest: Chest | null
  portal: Vec | null
  bossAnchor: Vec | null
  rockVariant: Map<number, 0 | 1>
  waves: Wave[]
  waveIdx: number
  combatActive: boolean
  cleared: boolean
  visited: boolean
  bg: HTMLCanvasElement | null
}

interface Enemy {
  id: number
  arch: Arch
  x: number
  y: number
  hp: number
  maxHp: number
  r: number
  spd: number
  elite: boolean
  flash: number
  anim: number
  spawnT: number
  state: number
  t: number
  fireT: number
  dirX: number
  dirY: number
  phase: number
  rollAngle: number
  faceLeft: boolean
}

interface Bullet {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  dmg: number
  pierce: number
  friendly: boolean
  life: number
  spin: number
  hit: Set<number>
}

interface Pickup {
  x: number
  y: number
  t: number
}

interface Boss {
  x: number
  y: number
  hp: number
  maxHp: number
  r: number
  phase: number
  pattern: number
  patternT: number
  step: number
  angle: number
  fireT: number
  dirX: number
  dirY: number
  spawnT: number
  flash: number
  dead: boolean
  deadT: number
  summonT: number
}

export interface Weapon {
  dmg: number
  interval: number
  projectiles: number
  pierce: number
  upgrades: number
}

export interface GameCallbacks {
  /** 宝箱开启请求出题；游戏暂停，等 React 调 answerChest() */
  onChest: () => void
  /** 到达关底传送门（0-5 关） */
  onLevelClear: (levelIdx: number) => void
  /** BOSS 死亡，通关 */
  onVictory: () => void
  /** 玩家死亡 */
  onGameOver: () => void
  /** 底部上下文提示（null = 清除） */
  onPrompt: (text: string | null) => void
}

/* ------------------------------------------------------------ 常量表 */

const ARCH_BASE: Record<Arch, { hp: number; spd: number; r: number }> = {
  blob: { hp: 3, spd: 52, r: 6 },
  throw: { hp: 3, spd: 40, r: 6 },
  fly: { hp: 1.5, spd: 92, r: 5 },
  dash: { hp: 4, spd: 58, r: 6 },
  roll: { hp: 5, spd: 120, r: 7 },
  tank: { hp: 10, spd: 26, r: 8 },
}

const REDUCED_MOTION =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false

/* ------------------------------------------------------------ 游戏主体 */

export class Game {
  private ctx: CanvasRenderingContext2D
  /** 摇杆等外部输入注入点（公开给 React 壳的虚拟摇杆） */
  input: Input
  sfx = new Sfx()
  private rng = new Rng(1)
  private particles = new Particles()

  private levelIdx = 0
  private rooms: Record<string, Room> = {}
  private current: Room | null = null
  private clearedCombat = new Set<string>()
  /** 大厅左/右/上三门各自通往的战斗房（小地图用） */
  private sideRoom: Record<'L' | 'R' | 'T', string> = { L: '', R: '', T: '' }

  private player = {
    x: 240,
    y: 128,
    r: 5,
    hp: 5,
    maxHp: 5,
    iframe: 0,
    fireCd: 0,
    anim: 0,
    moving: false,
    faceLeft: false,
    aim: 0,
  }

  weapon: Weapon = { dmg: 1, interval: 0.42, projectiles: 1, pierce: 0, upgrades: 0 }

  private enemies: Enemy[] = []
  private bullets: Bullet[] = []
  private pickups: Pickup[] = []
  private boss: Boss | null = null
  private nextId = 1

  private raf = 0
  private lastT = 0
  private acc = 0
  private time = 0
  paused = true
  private running = false

  private fade = 1 // 1 = 全黑 → 0 显现
  private fadeDir = -1
  private pendingTransition: { room: string; tx: number; ty: number } | null = null
  private shake = 0
  private banner: { text: string; t: number } | null = null
  private promptText: string | null = null
  private nearChest = false
  private destroyed = false

  constructor(
    private canvas: HTMLCanvasElement,
    private cb: GameCallbacks,
    startLevel = 0,
  ) {
    this.ctx = canvas.getContext('2d')!
    this.input = new Input(canvas)
    this.input.onKeyOnce((e) => {
      if (e.code === 'KeyE') this.tryInteract()
    })
    canvas.addEventListener('pointerdown', this.firstGesture)
    this.levelIdx = clamp(startLevel, 0, 6)
    this.loadLevel(this.levelIdx)
    // 开发期调试钩子：浏览器控制台可用 window.__game 操作游戏内部状态
    if (import.meta.env.DEV) {
      ;(window as unknown as { __game?: Game }).__game = this
    }
  }

  private firstGesture = (): void => {
    this.sfx.unlock()
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.paused = false
    this.lastT = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  destroy(): void {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    this.input.destroy()
    this.sfx.destroy()
    this.canvas.removeEventListener('pointerdown', this.firstGesture)
  }

  pause(): void {
    this.paused = true
  }
  resume(): void {
    if (!this.destroyed) {
      this.paused = false
      this.lastT = performance.now()
    }
  }

  /* ------------------------------------------------------------ 关卡与房间 */

  private loadLevel(idx: number): void {
    this.levelIdx = idx
    this.rng = new Rng((Date.now() ^ (idx * 7919 + 13)) >>> 0)
    this.enemies = []
    this.bullets = []
    this.pickups = []
    this.boss = null
    this.clearedCombat = new Set()
    this.rooms = {}

    // 大厅 + 三战斗房 + 关底；大厅三门随机分配给三个战斗房
    this.rooms.hub = this.parseRoom('hub', TEMPLATES.hub!, [], [])
    // 大厅的门由下面的推送统一登记（模板里的 T/F/D 只留视觉位）
    this.rooms.hub.doors = []
    const sides: ('L' | 'R' | 'T')[] = ['L', 'R', 'T']
    // 洗牌（种子随机，同一次进入保持一致）
    for (let i = sides.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1))
      ;[sides[i], sides[j]] = [sides[j]!, sides[i]!]
    }
    const tmplBySide: Record<string, string> = { L: 'combatR', R: 'combatL', T: 'combatB' }
    const hubDoorBySide: Record<string, { tx: number; ty: number }> = {
      L: { tx: 0, ty: 8 },
      R: { tx: ROOM_TW - 1, ty: 8 },
      T: { tx: 15, ty: 0 },
    }
    const finalKey = idx === 6 ? 'boss' : 'final'
    const finalTmpl = idx === 6 ? TEMPLATES.bossT! : TEMPLATES.finalT!

    for (let i = 0; i < 3; i++) {
      const side = sides[i]!
      const tmplName = tmplBySide[side]!
      const key = `c${i}`
      this.sideRoom[side] = key
      const room = this.parseRoom(key, TEMPLATES[tmplName]!, LEVELS[idx]!.waves[i] ?? [], this.stampRocks())
      const hubDoor = hubDoorBySide[side]!
      // 战斗房的门 → 大厅对应门
      for (const d of room.doors) {
        d.toRoom = 'hub'
        d.toTx = hubDoor.tx
        d.toTy = hubDoor.ty
        d.kind = 'return'
      }
      // 大厅该门 → 战斗房（进入点 = 战斗房门内侧一格）
      const cDoor = room.doors[0]!
      this.rooms.hub.doors.push({
        tx: hubDoor.tx,
        ty: hubDoor.ty,
        toRoom: key,
        toTx: cDoor.tx,
        toTy: cDoor.ty,
        kind: 'combat',
      })
      this.rooms[key] = room
    }

    const finalRoom = this.parseRoom(finalKey, finalTmpl, [], [])
    this.rooms[finalKey] = finalRoom
    // 大厅底部大门 → 关底
    this.rooms.hub.doors.push({
      tx: 15,
      ty: ROOM_TH - 1,
      toRoom: finalKey,
      toTx: 15,
      toTy: 0,
      kind: 'final',
    })
    // 关底的门 → 大厅底部门
    finalRoom.doors = finalRoom.doors.map((d) => ({ ...d, toRoom: 'hub', toTx: 15, toTy: ROOM_TH - 1, kind: 'finalReturn' }))

    // 出生
    this.enterRoom('hub', -1, -1)
    this.fade = 1
    this.fadeDir = -1
    this.setPrompt(null)
    this.banner = { text: `第 ${idx + 1} 关 · ${LEVELS[idx]!.era}`, t: 2 }
  }

  private parseRoom(key: string, tmpl: string[], waves: Wave[], rocks: number[]): Room {
    const solid = new Uint8Array(ROOM_TW * ROOM_TH)
    const doors: DoorSpot[] = []
    const rockVariant = new Map<number, 0 | 1>()
    let chest: Chest | null = null
    let portal: Vec | null = null
    let bossAnchor: Vec | null = null

    for (let ty = 0; ty < ROOM_TH; ty++) {
      const row = tmpl[ty]!
      for (let tx = 0; tx < ROOM_TW; tx++) {
        const ch = row[tx] ?? '#'
        const i = ty * ROOM_TW + tx
        if (ch === '#') solid[i] = 1
        else if (ch === 'o') {
          solid[i] = 2
          rockVariant.set(i, this.rng.next() < 0.5 ? 0 : 1)
        } else if (ch === 'D' || ch === 'T' || ch === 'F') {
          doors.push({ tx, ty, toRoom: '', toTx: 0, toTy: 0, kind: 'return' })
        } else if (ch === 'C') chest = { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, opened: false }
        else if (ch === 'X') portal = { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 }
        else if (ch === 'B') bossAnchor = { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 }
      }
    }
    // 战斗房随机岩块（stampRocks 给的是格索引）
    for (const i of rocks) {
      if (solid[i] === 0) {
        solid[i] = 2
        rockVariant.set(i, this.rng.next() < 0.5 ? 0 : 1)
      }
    }

    return {
      key,
      solid,
      doors,
      chest,
      portal,
      bossAnchor,
      rockVariant,
      waves,
      waveIdx: -1,
      combatActive: false,
      // BOSS 房无波次但不能视为已通关，否则 enterRoom 的 !cleared 守卫会拦掉 BOSS 生成
      cleared: waves.length === 0 && bossAnchor === null,
      visited: false,
      bg: null,
    }
  }

  /** 给战斗房随机盖岩块：避开四边、门路线（行 8 / 列 15）、宝箱区、中心出生带。 */
  private stampRocks(): number[] {
    const cells: number[] = []
    const anchors: [number, number][] = [
      [6, 4], [9, 6], [12, 5], [18, 5], [21, 6], [24, 4],
      [6, 11], [9, 9], [12, 10], [18, 10], [21, 9], [24, 11],
    ]
    const n = this.rng.int(4, 6)
    const picked = new Set<number>()
    while (picked.size < Math.min(n, anchors.length)) {
      picked.add(this.rng.int(0, anchors.length - 1))
    }
    for (const a of picked) {
      const [ax, ay] = anchors[a]!
      const shape = this.rng.int(0, 3)
      const put = (x: number, y: number): void => {
        if (x < 1 || x > ROOM_TW - 2 || y < 1 || y > ROOM_TH - 2) return
        if (y === 8 || x === 15) return // 门路线
        if (y <= 4 && x >= 13 && x <= 17) return // 宝箱区
        cells.push(y * ROOM_TW + x)
      }
      put(ax, ay)
      if (shape === 1) put(ax + 1, ay)
      else if (shape === 2) put(ax, ay + 1)
      else if (shape === 3) {
        put(ax + 1, ay)
        put(ax, ay + 1)
        put(ax + 1, ay + 1)
      }
    }
    return cells
  }

  private enterRoom(key: string, entryTx: number, entryTy: number): void {
    const room = this.rooms[key]!
    this.current = room
    room.visited = true
    if (entryTx >= 0) {
      // 从门内侧一格进入
      const inX = clamp(entryTx + (entryTx === 0 ? 2 : entryTx === ROOM_TW - 1 ? -2 : 0), 1, ROOM_TW - 2)
      const inY = clamp(entryTy + (entryTy === 0 ? 2 : entryTy === ROOM_TH - 1 ? -2 : 0), 1, ROOM_TH - 2)
      this.player.x = inX * TILE + TILE / 2
      this.player.y = inY * TILE + TILE / 2
    } else {
      const p = this.findAnchor('P') ?? { x: 240, y: 128 }
      this.player.x = p.x
      this.player.y = p.y
    }
    this.bullets = []
    this.enemies = []
    this.pickups = []

    const isCombat = room.waves.length > 0
    const isBoss = room.bossAnchor !== null
    if (isCombat && !room.cleared) {
      room.combatActive = true
      room.waveIdx = 0
      this.spawnWave(room)
      this.sfx.play('door')
      this.banner = { text: '房门已锁——消灭所有敌人！', t: 1.6 }
    } else if (isBoss && !room.cleared) {
      const a = room.bossAnchor
      this.boss = {
        x: a!.x,
        y: a!.y,
        hp: 72,
        maxHp: 72,
        r: 20,
        phase: 1,
        pattern: -1,
        patternT: 1.4,
        step: 0,
        angle: 0,
        fireT: 0,
        dirX: 0,
        dirY: 0,
        spawnT: 1.2,
        flash: 0,
        dead: false,
        deadT: 0,
        summonT: 10,
      }
      this.sfx.play('boss')
      this.banner = { text: '铁面钱王 · 咸丰当百', t: 2.2 }
    }
  }

  private findAnchor(ch: string): Vec | null {
    const tmpl = TEMPLATES.hub
    for (let ty = 0; ty < ROOM_TH; ty++) {
      const row = tmpl[ty]!
      const tx = row.indexOf(ch)
      if (tx >= 0) return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 }
    }
    return null
  }

  /* ------------------------------------------------------------ 主循环 */

  private frame = (t: number): void => {
    if (this.destroyed) return
    this.raf = requestAnimationFrame(this.frame)
    const dtRaw = Math.min(0.1, (t - this.lastT) / 1000)
    this.lastT = t
    if (!this.paused) {
      this.acc += dtRaw
      const dt = 1 / 60
      while (this.acc >= dt) {
        this.update(dt)
        this.acc -= dt
      }
    }
    this.render()
  }

  private update(dt: number): void {
    this.time += dt
    this.fade = clamp(this.fade + this.fadeDir * dt * 5.5, 0, 1)
    if (this.shake > 0) this.shake -= dt
    if (this.banner) {
      this.banner.t -= dt
      if (this.banner.t <= 0) this.banner = null
    }

    // 转场
    if (this.fade >= 1 && this.fadeDir > 0 && this.pendingTransition) {
      const { room, tx, ty } = this.pendingTransition
      this.pendingTransition = null
      this.enterRoom(room, tx, ty)
      this.fadeDir = -1
    }

    if (this.fade < 0.9) this.updatePlayer(dt)
    this.updateEnemies(dt)
    this.updateBoss(dt)
    this.updateBullets(dt)
    this.updatePickups(dt)
    this.particles.update(dt)
    this.updateContextPrompt()
  }

  /* ------------------------------------------------------------ 玩家 */

  private updatePlayer(dt: number): void {
    const p = this.player
    p.iframe = Math.max(0, p.iframe - dt)
    p.fireCd = Math.max(0, p.fireCd - dt)

    const ax = this.input.moveAxis()
    p.moving = ax.x !== 0 || ax.y !== 0
    if (p.moving) {
      p.anim += dt
      const spd = 108
      this.moveCircle(p, ax.x * spd * dt, ax.y * spd * dt, false)
    }
    p.aim = this.input.aimFrom(p.x, p.y)
    p.faceLeft = Math.cos(p.aim) < 0

    // 射击
    if (this.input.firing() && p.fireCd <= 0) {
      p.fireCd = this.weapon.interval
      const n = this.weapon.projectiles
      for (let i = 0; i < n; i++) {
        const off = n === 1 ? 0 : (i - (n - 1) / 2) * 0.16
        const a = p.aim + off
        this.bullets.push({
          x: p.x + Math.cos(a) * 8,
          y: p.y + Math.sin(a) * 8,
          vx: Math.cos(a) * 250,
          vy: Math.sin(a) * 250,
          r: 3.5,
          dmg: this.weapon.dmg,
          pierce: this.weapon.pierce,
          friendly: true,
          life: 1.6,
          spin: this.rng.next() * Math.PI * 2,
          hit: new Set(),
        })
      }
      this.sfx.play('shoot')
    }

    // 门穿越
    const room = this.current
    if (room) {
      for (const d of room.doors) {
        if (this.doorLocked(room, d)) continue
        const cx = d.tx * TILE + TILE / 2
        const cy = d.ty * TILE + TILE / 2
        if (dist(p.x, p.y, cx, cy) < 13) {
          this.pendingTransition = { room: d.toRoom, tx: d.toTx, ty: d.toTy }
          this.fadeDir = 1
          this.sfx.play('door')
          return
        }
      }
      // 传送门（关底）
      if (room.portal && !this.paused && dist(p.x, p.y, room.portal.x, room.portal.y) < 14) {
        this.paused = true
        this.sfx.play('victory')
        this.cb.onLevelClear(this.levelIdx)
        return
      }
    }
  }

  /** 圆形实体贴墙移动（分轴检测）。fly=true 时可越过岩块。 */
  private moveCircle(e: { x: number; y: number; r: number }, dx: number, dy: number, fly: boolean): void {
    const room = this.current!
    const solidAt = (px: number, py: number): boolean => {
      const tx = Math.floor(px / TILE)
      const ty = Math.floor(py / TILE)
      if (tx < 0 || ty < 0 || tx >= ROOM_TW || ty >= ROOM_TH) return true
      const s = room.solid[ty * ROOM_TW + tx]!
      if (s === 0) return false
      if (s === 2 && fly) return false
      return true
    }
    // 门洞可通行
    const doorAt = (px: number, py: number): boolean => {
      const tx = Math.floor(px / TILE)
      const ty = Math.floor(py / TILE)
      return room.doors.some((d) => d.tx === tx && d.ty === ty && !this.doorLocked(room, d))
    }
    const blocked = (px: number, py: number): boolean => solidAt(px, py) && !doorAt(px, py)

    const r = e.r - 1
    if (dx !== 0) {
      const nx = e.x + dx
      const edge = nx + Math.sign(dx) * r
      if (
        !blocked(edge, e.y - r * 0.7) &&
        !blocked(edge, e.y + r * 0.7) &&
        !blocked(edge, e.y)
      ) {
        e.x = nx
      }
    }
    if (dy !== 0) {
      const ny = e.y + dy
      const edge = ny + Math.sign(dy) * r
      if (
        !blocked(e.x - r * 0.7, edge) &&
        !blocked(e.x + r * 0.7, edge) &&
        !blocked(e.x, edge)
      ) {
        e.y = ny
      }
    }
  }

  /* ------------------------------------------------------------ 敌人 */

  private spawnWave(room: Room): void {
    const wave = room.waves[room.waveIdx]
    if (!wave) return
    const hpMul = 1 + this.levelIdx * 0.28
    for (const entry of wave) {
      for (let i = 0; i < entry.count; i++) {
        const base = ARCH_BASE[entry.arch]
        const pos = this.findSpawnPos()
        const elite = entry.elite === true
        this.enemies.push({
          id: this.nextId++,
          arch: entry.arch,
          x: pos.x,
          y: pos.y,
          hp: base.hp * hpMul * (elite ? 2.2 : 1),
          maxHp: base.hp * hpMul * (elite ? 2.2 : 1),
          r: base.r * (elite ? 1.25 : 1),
          spd: base.spd * (elite ? 1.15 : 1),
          elite,
          flash: 0,
          anim: this.rng.next() * 2,
          spawnT: 0.5 + i * 0.12,
          state: 0,
          t: this.rng.range(0.8, 2),
          fireT: this.rng.range(1, 2),
          dirX: 0,
          dirY: 0,
          phase: this.rng.next() * Math.PI * 2,
          rollAngle: 0,
          faceLeft: false,
        })
      }
    }
    this.banner = { text: `第 ${room.waveIdx + 1} / ${room.waves.length} 波`, t: 1.2 }
  }

  private findSpawnPos(): Vec {
    const p = this.player
    for (let i = 0; i < 80; i++) {
      const tx = this.rng.int(2, ROOM_TW - 3)
      const ty = this.rng.int(2, ROOM_TH - 3)
      const s = this.current!.solid[ty * ROOM_TW + tx]!
      if (s !== 0) continue
      const x = tx * TILE + TILE / 2
      const y = ty * TILE + TILE / 2
      if (dist(x, y, p.x, p.y) < 100) continue
      return { x, y }
    }
    return { x: 240, y: 48 }
  }

  private updateEnemies(dt: number): void {
    const p = this.player
    const room = this.current
    if (!room) return

    for (const e of this.enemies) {
      if (e.spawnT > 0) {
        e.spawnT -= dt
        continue
      }
      e.flash = Math.max(0, e.flash - dt)
      e.anim += dt
      const d = dist(e.x, e.y, p.x, p.y)
      const ux = d > 0 ? (p.x - e.x) / d : 0
      const uy = d > 0 ? (p.y - e.y) / d : 0

      switch (e.arch) {
        case 'blob': {
          const wob = Math.sin(this.time * 3 + e.phase) * 0.35
          this.moveCircle(e, (ux - uy * wob) * e.spd * dt, (uy + ux * wob) * e.spd * dt, false)
          e.faceLeft = ux < 0
          break
        }
        case 'throw': {
          if (e.state === 1) {
            // 蓄力 → 发射铲币
            e.t -= dt
            if (e.t <= 0) {
              e.state = 0
              const a = Math.atan2(p.y - e.y, p.x - e.x)
              this.bullets.push({
                x: e.x + Math.cos(a) * 8,
                y: e.y + Math.sin(a) * 8,
                vx: Math.cos(a) * 125,
                vy: Math.sin(a) * 125,
                r: 3.5,
                dmg: 1,
                pierce: 0,
                friendly: false,
                life: 4,
                spin: 0,
                hit: new Set(),
              })
              e.fireT = this.rng.range(1.6, 2.3)
            }
          } else {
            e.fireT -= dt
            if (e.fireT <= 0 && d < 220) {
              e.state = 1
              e.t = 0.38
            }
            // 保持距离
            let mx = 0
            let my = 0
            if (d > 175) {
              mx = ux
              my = uy
            } else if (d < 110) {
              mx = -ux
              my = -uy
            } else {
              mx = -uy * 0.5
              my = ux * 0.5
            }
            this.moveCircle(e, mx * e.spd * dt, my * e.spd * dt, false)
          }
          e.faceLeft = ux < 0
          break
        }
        case 'fly': {
          const wob = Math.sin(this.time * 6 + e.phase) * 0.8
          this.moveCircle(e, (ux - uy * wob) * e.spd * dt, (uy + ux * wob) * e.spd * dt, true)
          e.faceLeft = ux < 0
          break
        }
        case 'dash': {
          if (e.state === 0) {
            // 潜行接近
            this.moveCircle(e, ux * e.spd * dt, uy * e.spd * dt, false)
            e.t -= dt
            if (e.t <= 0) {
              e.state = 1
              e.t = 0.5
            }
          } else if (e.state === 1) {
            // 瞄准蓄力（最后 0.15s 锁向）
            if (e.t > 0.15) {
              e.dirX = ux
              e.dirY = uy
            }
            e.t -= dt
            if (e.t <= 0) {
              e.state = 2
              e.t = 1.1
              this.sfx.play('select')
            }
          } else if (e.state === 2) {
            // 冲锋
            const before = { x: e.x, y: e.y }
            this.moveCircle(e, e.dirX * 300 * dt, e.dirY * 300 * dt, false)
            if (Math.abs(e.x - before.x) < 0.1 && Math.abs(e.dirX) > 0.1) e.t = 0
            if (Math.abs(e.y - before.y) < 0.1 && Math.abs(e.dirY) > 0.1) e.t = 0
            e.t -= dt
            if (e.t <= 0) {
              e.state = 3
              e.t = 0.75
            }
          } else {
            e.t -= dt
            if (e.t <= 0) {
              e.state = 0
              e.t = this.rng.range(1.2, 2)
            }
          }
          e.faceLeft = e.state === 2 ? e.dirX < 0 : ux < 0
          break
        }
        case 'roll': {
          if (e.dirX === 0) e.dirX = this.rng.next() < 0.5 ? -1 : 1
          const before = e.x
          this.moveCircle(e, e.dirX * e.spd * dt, 0, false)
          if (Math.abs(e.x - before) < Math.abs(e.dirX * e.spd * dt) * 0.3) e.dirX *= -1
          e.rollAngle += e.dirX * e.spd * dt / e.r
          break
        }
        case 'tank': {
          this.moveCircle(e, ux * e.spd * dt, uy * e.spd * dt, false)
          e.faceLeft = ux < 0
          if (e.state === 1) {
            e.t -= dt
            if (e.t <= 0) {
              e.state = 0
              // 环形 8 向弹
              for (let k = 0; k < 8; k++) {
                const a = (k / 8) * Math.PI * 2 + e.phase
                this.bullets.push({
                  x: e.x + Math.cos(a) * 10,
                  y: e.y + Math.sin(a) * 10,
                  vx: Math.cos(a) * 95,
                  vy: Math.sin(a) * 95,
                  r: 3,
                  dmg: 1,
                  pierce: 0,
                  friendly: false,
                  life: 4,
                  spin: 0,
                  hit: new Set(),
                })
              }
              e.fireT = this.rng.range(2.8, 3.6)
            }
          } else {
            e.fireT -= dt
            if (e.fireT <= 0 && d < 230) {
              e.state = 1
              e.t = 0.45
            }
          }
          break
        }
      }

      // 接触伤害
      if (p.iframe <= 0 && d < e.r + p.r - 1) {
        this.hurtPlayer(ux, uy)
      }
    }

    // 清理死亡
    this.enemies = this.enemies.filter((e) => e.hp > 0)

    // 波次推进
    if (room.combatActive && this.enemies.length === 0) {
      if (room.waveIdx < room.waves.length - 1) {
        room.waveIdx++
        this.spawnWave(room)
      } else if (!room.cleared) {
        room.cleared = true
        room.combatActive = false
        this.clearedCombat.add(room.key)
        this.sfx.play('door')
        this.banner = { text: '战斗胜利！宝箱已解锁', t: 1.6 }
        if (this.clearedCombat.size >= 3) {
          this.banner = { text: '三房已清——关底大门开启！', t: 2 }
          this.sfx.play('upgrade')
        }
      }
    }
  }

  private hurtPlayer(kx: number, ky: number): void {
    const p = this.player
    p.hp -= 1
    p.iframe = 1.1
    this.sfx.play('playerHurt')
    this.shake = REDUCED_MOTION ? 0 : 0.35
    this.particles.burst(p.x, p.y, '#e0453a', 10, 80)
    // 击退
    this.moveCircle(p, -kx * 14, -ky * 14, false)
    if (p.hp <= 0) {
      p.hp = 0
      this.paused = true
      this.cb.onGameOver()
    }
  }

  /* ------------------------------------------------------------ BOSS */

  private updateBoss(dt: number): void {
    const b = this.boss
    if (!b) return
    const p = this.player
    b.flash = Math.max(0, b.flash - dt)

    if (b.dead) {
      b.deadT += dt
      if (b.deadT > 0.2 && b.deadT - dt <= 0.2) this.particles.burst(b.x, b.y, '#ffd23f', 40, 140, 0.9)
      if (b.deadT > 1.4 && !this.paused) {
        this.paused = true
        this.sfx.play('victory')
        this.cb.onVictory()
      }
      return
    }

    if (b.spawnT > 0) {
      b.spawnT -= dt
      return
    }

    const d = dist(b.x, b.y, p.x, p.y)
    const ux = d > 0 ? (p.x - b.x) / d : 0
    const uy = d > 0 ? (p.y - b.y) / d : 0

    // 进入二阶段
    if (b.phase === 1 && b.hp <= b.maxHp / 2) {
      b.phase = 2
      b.flash = 0.4
      this.shake = REDUCED_MOTION ? 0 : 0.5
      this.sfx.play('boss')
      this.banner = { text: '钱王暴怒——虚值大钱漫天飞舞！', t: 2.2 }
    }

    b.patternT -= dt
    const speedMul = b.phase === 2 ? 1.35 : 1

    switch (b.pattern) {
      case -1: // 开场逼近
      case 0: { // 漂移逼近
        this.moveCircle(b, ux * 32 * speedMul * dt, uy * 32 * speedMul * dt, false)
        if (b.patternT <= 0) {
          b.pattern = this.rng.int(1, b.phase === 2 ? 4 : 3)
          b.step = 0
          b.patternT = 0
        }
        break
      }
      case 1: { // 环形弹幕（3 轮）
        if (b.patternT <= 0) {
          const n = 14
          const off = b.step * 0.22
          for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2 + off
            this.bullets.push({
              x: b.x + Math.cos(a) * b.r,
              y: b.y + Math.sin(a) * b.r,
              vx: Math.cos(a) * (78 + b.phase * 14),
              vy: Math.sin(a) * (78 + b.phase * 14),
              r: 3,
              dmg: 1,
              pierce: 0,
              friendly: false,
              life: 4.5,
              spin: 0,
              hit: new Set(),
            })
          }
          this.sfx.play('hit')
          b.step++
          b.patternT = 0.3
          if (b.step >= 3) {
            b.pattern = 0
            b.patternT = 1.5
          }
        }
        break
      }
      case 2: { // 瞄准散射（3 组）
        if (b.patternT <= 0) {
          const base = Math.atan2(p.y - b.y, p.x - b.x)
          for (let k = -2; k <= 2; k++) {
            const a = base + k * 0.16
            this.bullets.push({
              x: b.x + Math.cos(a) * b.r,
              y: b.y + Math.sin(a) * b.r,
              vx: Math.cos(a) * 130,
              vy: Math.sin(a) * 130,
              r: 3,
              dmg: 1,
              pierce: 0,
              friendly: false,
              life: 4,
              spin: 0,
              hit: new Set(),
            })
          }
          this.sfx.play('hit')
          b.step++
          b.patternT = 0.45
          if (b.step >= 3) {
            b.pattern = 0
            b.patternT = 1.6
          }
        }
        break
      }
      case 3: { // 冲锋 ×2
        if (b.step % 2 === 0 && b.patternT <= 0) {
          // 瞄准
          b.dirX = ux
          b.dirY = uy
          b.step++
          b.patternT = 0.55
        } else if (b.step % 2 === 1) {
          const before = { x: b.x, y: b.y }
          this.moveCircle(b, b.dirX * 300 * dt, b.dirY * 300 * dt, false)
          b.patternT -= dt * 3
          if (
            b.patternT <= 0 ||
            (Math.abs(b.x - before.x) < 0.05 && Math.abs(b.dirX) > 0.1) ||
            (Math.abs(b.y - before.y) < 0.05 && Math.abs(b.dirY) > 0.1)
          ) {
            b.step++
            if (b.step >= 4) {
              b.pattern = 0
              b.patternT = 1.3
            } else {
              b.patternT = 0.4
            }
          }
        }
        break
      }
      case 4: { // 二阶段螺旋流
        if (b.patternT <= 0) {
          b.fireT -= dt
          if (b.fireT <= 0) {
            b.fireT = 0.07
            b.angle += 0.42
            for (const s of [0, Math.PI]) {
              const a = b.angle + s
              this.bullets.push({
                x: b.x + Math.cos(a) * b.r,
                y: b.y + Math.sin(a) * b.r,
                vx: Math.cos(a) * 105,
                vy: Math.sin(a) * 105,
                r: 3,
                dmg: 1,
                pierce: 0,
                friendly: false,
                life: 4,
                spin: 0,
                hit: new Set(),
              })
            }
            b.step++
          }
          if (b.step > 34) {
            b.pattern = 0
            b.patternT = 1.4
          }
        } else {
          b.patternT -= dt
        }
        break
      }
    }

    // 二阶段召唤
    if (b.phase === 2) {
      b.summonT -= dt
      if (b.summonT <= 0 && this.enemies.length < 3) {
        b.summonT = 11
        const hpMul = 1 + this.levelIdx * 0.28
        for (let k = 0; k < 3; k++) {
          const pos = this.findSpawnPos()
          this.enemies.push({
            id: this.nextId++,
            arch: 'blob',
            x: pos.x,
            y: pos.y,
            hp: 3 * hpMul,
            maxHp: 3 * hpMul,
            r: 6,
            spd: 62,
            elite: false,
            flash: 0,
            anim: 0,
            spawnT: 0.4,
            state: 0,
            t: 1,
            fireT: 2,
            dirX: 0,
            dirY: 0,
            phase: this.rng.next() * Math.PI * 2,
            rollAngle: 0,
            faceLeft: false,
          })
        }
        this.banner = { text: '钱王召来小钱兵！', t: 1.2 }
      }
    }

    // 接触伤害
    if (p.iframe <= 0 && d < b.r + p.r) {
      this.hurtPlayer(ux, uy)
    }
  }

  /* ------------------------------------------------------------ 弹丸与掉落 */

  private updateBullets(dt: number): void {
    const room = this.current!
    const p = this.player
    for (const b of this.bullets) {
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.life -= dt
      b.spin += dt * 9

      // 撞墙
      const tx = Math.floor(b.x / TILE)
      const ty = Math.floor(b.y / TILE)
      if (tx < 0 || ty < 0 || tx >= ROOM_TW || ty >= ROOM_TH || room.solid[ty * ROOM_TW + tx] !== 0) {
        b.life = 0
        if (b.friendly) this.particles.burst(b.x, b.y, '#d9b44a', 3, 40, 0.25)
        continue
      }

      if (b.friendly) {
        for (const e of this.enemies) {
          if (e.spawnT > 0 || b.hit.has(e.id)) continue
          if (dist(b.x, b.y, e.x, e.y) < b.r + e.r) {
            e.hp -= b.dmg
            e.flash = 0.12
            b.hit.add(e.id)
            this.sfx.play('hit')
            this.particles.burst(b.x, b.y, ERA_PALETTES[this.levelIdx]!.tint, 4, 60, 0.3)
            if (e.hp <= 0) {
              this.particles.burst(e.x, e.y, ERA_PALETTES[this.levelIdx]!.tint, 12, 90, 0.5)
              this.sfx.play('enemyDie')
              if (this.rng.next() < 0.16 && p.hp < p.maxHp) this.pickups.push({ x: e.x, y: e.y, t: 0 })
            }
            if (b.pierce > 0) b.pierce -= 1
            else b.life = 0
            break
          }
        }
        // 打 BOSS
        const boss = this.boss
        if (boss && !boss.dead && boss.spawnT <= 0 && b.life > 0) {
          if (dist(b.x, b.y, boss.x, boss.y) < b.r + boss.r) {
            boss.hp -= b.dmg
            boss.flash = 0.1
            this.sfx.play('hit')
            this.particles.burst(b.x, b.y, '#ffd23f', 4, 60, 0.3)
            if (boss.hp <= 0) {
              boss.dead = true
              boss.hp = 0
              this.shake = REDUCED_MOTION ? 0 : 0.6
            }
            if (b.pierce > 0) b.pierce -= 1
            else b.life = 0
          }
        }
      } else if (p.iframe <= 0 && dist(b.x, b.y, p.x, p.y) < b.r + p.r - 1) {
        b.life = 0
        this.hurtPlayer(b.vx / 130, b.vy / 130)
      }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0)
  }

  private updatePickups(dt: number): void {
    const p = this.player
    for (const it of this.pickups) it.t += dt
    this.pickups = this.pickups.filter((it) => {
      if (dist(it.x, it.y, p.x, p.y) < 12) {
        p.hp = Math.min(p.maxHp, p.hp + 1)
        this.sfx.play('heart')
        this.particles.burst(it.x, it.y, '#e0453a', 8, 60, 0.4)
        return false
      }
      return it.t < 12
    })
  }

  /* ------------------------------------------------------------ 宝箱与答题 */

  private tryInteract(): void {
    if (this.paused || !this.nearChest) return
    const room = this.current!
    if (!room.chest || room.chest.opened || !room.cleared) return
    room.chest.opened = true
    this.sfx.play('chest')
    this.paused = true
    this.cb.onChest()
  }

  /** React 答题弹层关闭时回调：correct = 答对则强化武器。 */
  answerChest(correct: boolean): void {
    if (correct) this.applyUpgrade()
    this.setPrompt(null)
    this.paused = false
    this.lastT = performance.now()
  }

  private applyUpgrade(): void {
    const kind = UPGRADE_CYCLE[this.weapon.upgrades % UPGRADE_CYCLE.length]!
    switch (kind) {
      case 'rate':
        this.weapon.interval = Math.max(0.13, this.weapon.interval * 0.82)
        break
      case 'dmg':
        this.weapon.dmg += 0.5
        break
      case 'proj':
        this.weapon.projectiles = Math.min(3, this.weapon.projectiles + 1)
        break
      case 'pierce':
        this.weapon.pierce = Math.min(2, this.weapon.pierce + 1)
        break
    }
    this.weapon.upgrades++
    this.sfx.play('upgrade')
    this.banner = { text: '武器强化！', t: 1.2 }
  }

  /** 触摸端「开箱」按钮调用。 */
  requestInteract(): void {
    this.tryInteract()
  }

  /** 过关后进入下一关（保留武器，上限+1 并回满）。 */
  nextLevel(): void {
    this.player.maxHp = Math.min(8, this.player.maxHp + 1)
    this.player.hp = this.player.maxHp
    this.player.iframe = 1
    this.loadLevel(Math.min(6, this.levelIdx + 1))
    this.paused = false
    this.lastT = performance.now()
  }

  /** 死亡重试本关：保留武器，血量回满，房间重置。 */
  retryLevel(): void {
    this.player.hp = this.player.maxHp
    this.player.iframe = 1
    this.loadLevel(this.levelIdx)
    this.paused = false
    this.lastT = performance.now()
  }

  private updateContextPrompt(): void {
    const room = this.current
    if (!room) return
    const chest = room.chest
    let prompt: string | null = null
    if (chest && !chest.opened) {
      if (!room.cleared) prompt = '先消灭所有敌人'
      else if (dist(this.player.x, this.player.y, chest.x, chest.y) < 24) {
        this.nearChest = true
        prompt = '按 E / 点按 开启宝箱'
        this.setPrompt(prompt)
        return
      }
    }
    this.nearChest = false
    this.setPrompt(prompt)
  }

  private setPrompt(text: string | null): void {
    if (this.promptText !== text) {
      this.promptText = text
      this.cb.onPrompt(text)
    }
  }

  get level(): number {
    return this.levelIdx
  }
  get playerHp(): number {
    return this.player.hp
  }
  get playerMaxHp(): number {
    return this.player.maxHp
  }

  /* ------------------------------------------------------------ 渲染 */

  private doorLocked(room: Room, d: DoorSpot): boolean {
    if (d.kind === 'final') return this.clearedCombat.size < 3
    if (d.kind === 'finalReturn') return room.combatActive
    return room.combatActive
  }

  private render(): void {
    const ctx = this.ctx
    const room = this.current
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = '#0e0f14'
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    if (!room) return

    const shakeX = this.shake > 0 && !REDUCED_MOTION ? (Math.random() - 0.5) * this.shake * 8 : 0
    const shakeY = this.shake > 0 && !REDUCED_MOTION ? (Math.random() - 0.5) * this.shake * 8 : 0
    ctx.save()
    ctx.translate(Math.round(shakeX), Math.round(shakeY))

    this.drawRoomBg(room)
    this.drawDoors(room)
    if (room.portal) this.drawPortal(room.portal)
    if (room.chest) this.drawChest(room.chest)
    this.drawPickups()
    for (const e of this.enemies) this.drawEnemy(e)
    if (this.boss) this.drawBoss(this.boss)
    this.drawPlayer()
    this.drawBullets()
    this.particles.draw(ctx)
    ctx.restore()

    this.drawHud()
    this.drawBanner()

    // 转场黑幕
    if (this.fade > 0) {
      ctx.fillStyle = `rgba(10,10,14,${this.fade})`
      ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    }
  }

  private drawRoomBg(room: Room): void {
    if (!room.bg) {
      const bg = document.createElement('canvas')
      bg.width = VIEW_W
      bg.height = ROOM_H_PX
      const c = bg.getContext('2d')!
      c.imageSmoothingEnabled = false
      for (let ty = 0; ty < ROOM_TH; ty++) {
        for (let tx = 0; tx < ROOM_TW; tx++) {
          const s = room.solid[ty * ROOM_TW + tx]!
          const x = tx * TILE
          const y = ty * TILE
          if (s === 1) {
            c.drawImage(spriteCanvas('wall', this.levelIdx), x, y)
          } else {
            c.drawImage(spriteCanvas((tx + ty) % 2 === 0 ? 'floorA' : 'floorB', this.levelIdx), x, y)
            if (s === 2) {
              const v = room.rockVariant.get(ty * ROOM_TW + tx) ?? 0
              c.drawImage(spriteCanvas(v === 0 ? 'rock0' : 'rock1', this.levelIdx), x, y + 1)
            }
          }
        }
      }
      room.bg = bg
    }
    this.ctx.drawImage(room.bg, 0, 0)
  }

  private drawDoors(room: Room): void {
    const ctx = this.ctx
    for (const d of room.doors) {
      const x = d.tx * TILE
      const y = d.ty * TILE
      ctx.drawImage(spriteCanvas('door', this.levelIdx), x, y)
      if (this.doorLocked(room, d)) {
        // 红色封条
        ctx.fillStyle = '#9c2a22'
        ctx.fillRect(x + 4, y + 5, 8, 6)
        ctx.fillStyle = '#e0453a'
        ctx.fillRect(x + 5, y + 7, 6, 2)
      } else {
        // 开启微光
        ctx.fillStyle = 'rgba(255, 240, 180, 0.25)'
        ctx.fillRect(x + 5, y + 5, 6, 6)
      }
    }
  }

  private drawPortal(p: Vec): void {
    const ctx = this.ctx
    const t = this.time
    ctx.save()
    ctx.translate(p.x, p.y)
    for (let ring = 0; ring < 3; ring++) {
      const rr = 8 + ring * 5 + Math.sin(t * 2 + ring) * 1.5
      ctx.strokeStyle = ring === 1 ? '#ffd23f' : ERA_PALETTES[this.levelIdx]!.accent
      ctx.globalAlpha = 0.85 - ring * 0.2
      ctx.beginPath()
      ctx.arc(0, 0, rr, t * (ring % 2 === 0 ? 1 : -1), t * (ring % 2 === 0 ? 1 : -1) + Math.PI * 1.5)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    if (!REDUCED_MOTION && Math.random() < 0.15) {
      this.particles.burst(p.x, p.y, '#ffd23f', 1, 25, 0.6)
    }
    ctx.restore()
  }

  private drawChest(chest: Chest): void {
    const ctx = this.ctx
    const name = chest.opened ? 'chest-o' : 'chest-c'
    // 未开且已解锁 → 微光提示
    if (!chest.opened && this.current?.cleared) {
      const glow = Math.sin(this.time * 4) * 0.15 + 0.25
      ctx.fillStyle = `rgba(255, 210, 63, ${glow})`
      ctx.fillRect(chest.x - 10, chest.y - 8, 20, 16)
    }
    ctx.drawImage(spriteCanvas(name, this.levelIdx), Math.round(chest.x - 8), Math.round(chest.y - 6))
  }

  private drawPickups(): void {
    const ctx = this.ctx
    const spr = spriteCanvas('heart', this.levelIdx)
    for (const it of this.pickups) {
      const bob = Math.sin(it.t * 5) * 1.5
      ctx.drawImage(spr, Math.round(it.x - 4), Math.round(it.y - 4 + bob))
    }
  }

  private drawEnemy(e: Enemy): void {
    const ctx = this.ctx
    if (e.spawnT > 0) {
      // 出生预警圈
      ctx.strokeStyle = 'rgba(224, 69, 58, 0.8)'
      ctx.beginPath()
      ctx.arc(e.x, e.y, 4 + e.spawnT * 10, 0, Math.PI * 2)
      ctx.stroke()
      return
    }
    const frame = Math.floor(e.anim * 6) % 2
    let name = `${e.arch}${frame}`
    if (e.arch === 'roll') name = 'roll'
    const white = e.flash > 0
    const spr = white ? spriteWhite(name, this.levelIdx) : spriteCanvas(name, this.levelIdx)
    // 影子
    ctx.fillStyle = 'rgba(0,0,0,0.22)'
    ctx.beginPath()
    ctx.ellipse(e.x, e.y + e.r - 1, e.r, e.r * 0.4, 0, 0, Math.PI * 2)
    ctx.fill()

    const scale = e.elite ? 1.25 : 1
    ctx.save()
    ctx.translate(Math.round(e.x), Math.round(e.y))
    if (e.arch === 'roll') ctx.rotate(e.rollAngle)
    if (e.faceLeft && e.arch !== 'roll') ctx.scale(-scale, scale)
    else ctx.scale(scale, scale)
    ctx.drawImage(spr, -spr.width / 2, -spr.height / 2)
    ctx.restore()

    // 投掷原型蓄力时浮起的铲币
    if (e.arch === 'throw' && e.state === 1) {
      const s = spriteCanvas('spade', this.levelIdx)
      const bob = Math.sin(this.time * 18) * 1
      ctx.drawImage(s, Math.round(e.x + (e.faceLeft ? -12 : 6)), Math.round(e.y - 10 + bob))
    }
    // 冲锋瞄准线
    if (e.arch === 'dash' && e.state === 1) {
      ctx.strokeStyle = 'rgba(224, 69, 58, 0.35)'
      ctx.beginPath()
      ctx.moveTo(e.x, e.y)
      ctx.lineTo(e.x + e.dirX * 120, e.y + e.dirY * 120)
      ctx.stroke()
    }
    // 精英标记 & 血条
    if (e.elite) {
      ctx.fillStyle = '#ffd23f'
      ctx.fillRect(e.x - 1, e.y - e.r - 8, 2, 2)
      ctx.fillRect(e.x - 4, e.y - e.r - 6, 8, 2)
    }
    if (e.hp < e.maxHp) {
      const w = 12
      ctx.fillStyle = '#1b1c24'
      ctx.fillRect(e.x - w / 2, e.y - e.r - 4, w, 2)
      ctx.fillStyle = '#e0453a'
      ctx.fillRect(e.x - w / 2, e.y - e.r - 4, (w * e.hp) / e.maxHp, 2)
    }
  }

  private drawBoss(b: Boss): void {
    const ctx = this.ctx
    if (b.spawnT > 0) {
      ctx.strokeStyle = 'rgba(255, 210, 63, 0.9)'
      ctx.beginPath()
      ctx.arc(b.x, b.y, 8 + b.spawnT * 24, 0, Math.PI * 2)
      ctx.stroke()
      return
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)'
    ctx.beginPath()
    ctx.ellipse(b.x, b.y + b.r - 2, b.r, b.r * 0.35, 0, 0, Math.PI * 2)
    ctx.fill()
    const spr = b.flash > 0 ? spriteWhite('boss', this.levelIdx) : spriteCanvas('boss', this.levelIdx)
    const scale = b.dead ? Math.max(0, 1 - b.deadT / 1.2) : 1 + (b.phase === 2 ? Math.sin(this.time * 10) * 0.02 : 0)
    ctx.save()
    ctx.translate(Math.round(b.x), Math.round(b.y))
    ctx.scale(scale * 2, scale * 2) // 24×24 画布按 2 倍出
    if (b.dead) ctx.rotate(b.deadT * 1.5)
    ctx.drawImage(spr, -spr.width / 2, -spr.height / 2)
    ctx.restore()
    if (!b.dead) {
      const w = 160
      const x = (VIEW_W - w) / 2
      ctx.fillStyle = '#1b1c24'
      ctx.fillRect(x - 1, 8, w + 2, 6)
      ctx.fillStyle = b.phase === 2 ? '#e0453a' : '#ffd23f'
      ctx.fillRect(x, 9, (w * b.hp) / b.maxHp, 4)
      ctx.fillStyle = '#f5f5f7'
      ctx.font = 'bold 8px "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('铁面钱王 · 咸丰当百', VIEW_W / 2, 7)
      ctx.textAlign = 'left'
    }
  }

  private drawPlayer(): void {
    const ctx = this.ctx
    const p = this.player
    // 无敌帧闪烁
    if (p.iframe > 0 && Math.floor(p.iframe * 12) % 2 === 0) return
    const frame = p.moving ? Math.floor(p.anim * 8) % 2 : 0
    const spr = spriteCanvas(`player${frame}`, this.levelIdx)
    ctx.fillStyle = 'rgba(0,0,0,0.25)'
    ctx.beginPath()
    ctx.ellipse(p.x, p.y + 6, 6, 2.5, 0, 0, Math.PI * 2)
    ctx.fill()
    // 手臂/武器
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(p.aim)
    ctx.fillStyle = '#1f4fb8'
    ctx.fillRect(2, -1.5, 6, 3)
    ctx.fillStyle = '#f4c542'
    ctx.fillRect(7, -1.5, 3, 3)
    ctx.restore()
    ctx.save()
    ctx.translate(Math.round(p.x), Math.round(p.y))
    if (p.faceLeft) ctx.scale(-1, 1)
    ctx.drawImage(spr, -spr.width / 2, -spr.height / 2)
    ctx.restore()
  }

  private drawBullets(): void {
    const ctx = this.ctx
    for (const b of this.bullets) {
      if (b.friendly) {
        const spr = spriteCanvas('proj', this.levelIdx)
        ctx.save()
        ctx.translate(Math.round(b.x), Math.round(b.y))
        ctx.rotate(b.spin)
        ctx.drawImage(spr, -spr.width / 2, -spr.height / 2)
        ctx.restore()
        if (!REDUCED_MOTION && Math.random() < 0.3) this.particles.trail(b.x, b.y, 'rgba(255,210,63,0.5)')
      } else {
        ctx.drawImage(spriteCanvas('ebullet', this.levelIdx), Math.round(b.x - 2.5), Math.round(b.y - 2.5))
      }
    }
  }

  private drawHud(): void {
    const ctx = this.ctx
    const p = this.player
    // 底条
    ctx.fillStyle = '#14151c'
    ctx.fillRect(0, HUD_Y, VIEW_W, VIEW_H - HUD_Y)
    ctx.fillStyle = ERA_PALETTES[this.levelIdx]!.accent
    ctx.globalAlpha = 0.5
    ctx.fillRect(0, HUD_Y, VIEW_W, 1)
    ctx.globalAlpha = 1

    // 血量（像素红心）
    const heart = spriteCanvas('heart', this.levelIdx)
    for (let i = 0; i < p.maxHp; i++) {
      const x = 6 + i * 9
      const y = HUD_Y + 4
      if (i < p.hp) ctx.drawImage(heart, x, y)
      else {
        ctx.globalAlpha = 0.25
        ctx.drawImage(heart, x, y)
        ctx.globalAlpha = 1
      }
    }

    // 关名
    ctx.fillStyle = '#f5f5f7'
    ctx.font = 'bold 8px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.textAlign = 'center'
    const lv = LEVELS[this.levelIdx]!
    ctx.fillText(`第${this.levelIdx + 1}关 ${lv.era} · ${lv.projName} 强化×${this.weapon.upgrades}`, VIEW_W / 2, HUD_Y + 9)

    // 小地图（右上）：十字布局 = 大厅三门 + 底部关底
    const mm = { x: VIEW_W - 34, y: 4 }
    const cell = 7
    const sideState = (side: 'L' | 'R' | 'T'): string => {
      const key = this.sideRoom[side]
      const r = this.rooms[key]
      if (this.current?.key === key) return 'cur'
      if (r?.cleared) return 'ok'
      return 'un'
    }
    const pos: [number, number, string][] = [
      [1, 1, sideState('T')],
      [0, 1, sideState('L')],
      [2, 1, sideState('R')],
      [1, 0, this.current?.key === 'hub' ? 'cur' : 'hub'],
      [1, 2, this.current?.key === 'final' || this.current?.key === 'boss' ? 'cur' : this.clearedCombat.size >= 3 ? 'ok' : 'lock'],
    ]
    for (const [cx, cy, st] of pos) {
      ctx.fillStyle = st === 'cur' ? '#ffffff' : st === 'ok' ? '#ffd23f' : st === 'lock' ? '#9c2a22' : st === 'hub' ? '#8a8f98' : '#3a3d46'
      ctx.fillRect(mm.x + cx * (cell + 1), mm.y + cy * (cell + 1), cell, cell)
    }
    ctx.textAlign = 'left'
  }

  private drawBanner(): void {
    if (!this.banner) return
    const ctx = this.ctx
    const a = Math.min(1, this.banner.t / 0.4)
    ctx.globalAlpha = a
    ctx.font = 'bold 12px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.textAlign = 'center'
    const y = 60
    const w = ctx.measureText(this.banner.text).width + 20
    ctx.fillStyle = 'rgba(14, 15, 20, 0.75)'
    ctx.fillRect((VIEW_W - w) / 2, y - 13, w, 19)
    ctx.fillStyle = '#ffd23f'
    ctx.fillText(this.banner.text, VIEW_W / 2, y)
    ctx.globalAlpha = 1
    ctx.textAlign = 'left'
  }
}
