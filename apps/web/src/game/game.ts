/**
 * 玩法核心：元气骑士式房间地牢状态机。
 * 每关 = 中央大厅 + 4 战斗房（各一宝箱）+ 关底（传送门 / BOSS）。
 * 进战斗房锁门刷怪 → 清完解锁开箱 → 答题（React 弹层接管）→ 答对强化武器。
 * 武器 13 把（近战/远程/爆炸）过关三选一；攻击消耗能量，杀敌掉能量珠补给。
 * 第 2/4/6 关关底为中途 BOSS，第 7 关为终极铁面钱王。
 */

import { Input, Sfx, Particles, Rng, clamp, dist, type Vec } from './engine'

export { DEFAULT_KEYS, type KeyBindings } from './engine'
import { spriteCanvas, spriteWhite, ERA_PALETTES } from './sprites'
import { TILE, ROOM_TW, ROOM_TH, TEMPLATES, LEVELS, UPGRADE_CYCLE, UPGRADE_LABEL, type Arch } from './data/levels'
import type { Wave } from './data/levels'
import { WEAPONS, type WeaponDef } from './data/weapons'
import { BOSSES, LEVEL_BOSS, type BossId } from './data/bosses'

export const VIEW_W = 480
export const VIEW_H = 270
const ROOM_H_PX = ROOM_TH * TILE // 256
const HUD_Y = ROOM_H_PX // HUD 条起始 y

/** 能量自然回复（点/秒），强化可乘 regenMul */
const ENERGY_REGEN = 7

const fmtNum = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/* ------------------------------------------------------------ 类型 */

interface DoorSpot {
  tx: number
  ty: number
  toRoom: string
  toTx: number
  toTy: number
  /** final = 大厅通往关底的大门（需清完四房） */
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
  /** 行为标签（影响更新分支） */
  kind?: 'boomerang' | 'homing' | 'lob' | 'wheel'
  /** 年龄（秒） */
  t: number
  /** 爆炸半径（有值则消亡时爆炸） */
  blast?: number
  /** 专属弹形 sprite 名 */
  sprite?: string
  /** 拖尾粒子色 */
  trailC?: string
  /** 不渲染的纯伤害体（环绕刀） */
  hidden?: boolean
  /** 自旋速度（默认 9） */
  spinRate?: number
  /** 抛射高度（lob） */
  z?: number
  /** lob 总飞行时长 */
  flight?: number
  /** boomerang 是否回程 */
  returning?: boolean
  /** 剩余反弹次数（BOSS 飞轮） */
  bounce?: number
  /** 敌方爆炸弹（自爆飞轮等）：消亡时对玩家方爆炸半径 */
  blastE?: number
  /** homing 每秒转向（rad） */
  turn?: number
  /** 已对 BOSS 结算过（防穿透弹帧帧重复伤害） */
  bossHit?: boolean
  /** 近战判定体：触碰可消除敌方子弹 */
  melee?: boolean
}

interface Pickup {
  x: number
  y: number
  t: number
  type: 'heart' | 'orb'
}

interface Boss {
  id: BossId
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
  /** 激光锁定方向 */
  aimX: number
  aimY: number
  /** 奖励是否已发（中途 BOSS 开门 / 终极通关） */
  rewarded: boolean
}

/** 伤害跳字 */
interface FloatText {
  x: number
  y: number
  text: string
  t: number
  color: string
  size: number
}

export interface Weapon {
  weaponId: string
  dmg: number
  interval: number
  projectiles: number
  pierce: number
  /** 暴击率 0~0.5（暴击 ×2 伤害） */
  crit: number
  /** 弹速倍率 */
  speedMul: number
  /** 能量上限 */
  energyMax: number
  /** 能量回复倍率 */
  regenMul: number
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
  bomb: { hp: 4, spd: 46, r: 6 },
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
  /** 自动瞄准最近敌人（设置面板开关） */
  autoAim = false
  sfx = new Sfx()
  private rng = new Rng(1)
  private particles = new Particles()

  private levelIdx = 0
  private rooms: Record<string, Room> = {}
  private current: Room | null = null
  private clearedCombat = new Set<string>()
  /** 大厅四个侧门各自通往的战斗房（小地图用） */
  private sideRoom: Record<'L' | 'R' | 'T' | 'R2', string> = { L: '', R: '', T: '', R2: '' }

  player = {
    x: 240,
    y: 128,
    r: 5,
    hp: 5,
    maxHp: 5,
    iframe: 0,
    fireCd: 0,
    dustT: 0,
    anim: 0,
    moving: false,
    faceLeft: false,
    aim: 0,
    /** 攻击能量（消耗型资源） */
    energy: 100,
  }

  weapon: Weapon = {
    weaponId: 'rapid',
    dmg: 1,
    interval: 0.42,
    projectiles: 1,
    pierce: 0,
    crit: 0,
    speedMul: 1,
    energyMax: 100,
    regenMul: 1,
    upgrades: 0,
  }

  private enemies: Enemy[] = []
  private bullets: Bullet[] = []
  private pickups: Pickup[] = []
  private floats: FloatText[] = []
  /** 爆炸扩散冲击环 */
  private boomRings: { x: number; y: number; max: number; t: number }[] = []
  /** 地面焦痕（渐隐） */
  private scorches: { x: number; y: number; r: number; life: number }[] = []
  /** 预警圈：倒计时归零时按 dmg 爆炸（0 = 纯视觉） */
  private hazards: { x: number; y: number; r: number; t: number; t0: number; dmg: number }[] = []
  /** 顿帧 / 慢动作（打击感） */
  private slowT = 0
  private slowScale = 1
  /** BOSS 死亡白闪 / 受击红晕 */
  private whiteFlash = 0
  private hurtFlash = 0
  /** 环境浮尘 / 传送门·宝箱粒子节拍 */
  private motes: { x: number; y: number; vx: number; vy: number }[] = []
  private portalT = 0
  private chestT = 0
  private boss: Boss | null = null
  private nextId = 1

  /** 环绕刀状态 */
  private orbitOn = false
  private orbitAngle = 0
  private orbitTick = 0
  /** 连珠点射剩余 */
  private burstLeft = 0
  private burstT = 0
  private burstAngle = 0
  /** 能量不足提示闪烁 */
  private energyFlash = 0

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
      if (e.code === this.input.keymap.interact) this.tryInteract()
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
    if (import.meta.env.DEV) {
      const w = window as unknown as { __game?: Game }
      if (w.__game === this) w.__game = undefined
    }
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
    this.floats = []
    this.boss = null
    this.orbitOn = false
    this.burstLeft = 0
    this.clearedCombat = new Set()
    this.rooms = {}

    // 大厅 + 四战斗房 + 关底；大厅四门随机分配给四个战斗房
    this.rooms.hub = this.parseRoom('hub', TEMPLATES.hub!, [], [])
    // 大厅的门由下面的推送统一登记（模板里的 T/F/D 只留视觉位）
    this.rooms.hub.doors = []
    const sides: ('L' | 'R' | 'T' | 'R2')[] = ['L', 'R', 'T', 'R2']
    // 洗牌（种子随机，同一次进入保持一致）
    for (let i = sides.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1))
      ;[sides[i], sides[j]] = [sides[j]!, sides[i]!]
    }
    const tmplBySide: Record<string, string> = { L: 'combatR', R: 'combatL', T: 'combatB', R2: 'combatL' }
    const hubDoorBySide: Record<string, { tx: number; ty: number }> = {
      L: { tx: 0, ty: 8 },
      R: { tx: ROOM_TW - 1, ty: 8 },
      T: { tx: 15, ty: 0 },
      R2: { tx: ROOM_TW - 1, ty: 12 },
    }
    const bossId = LEVEL_BOSS[idx]
    const finalKey = bossId ? 'boss' : 'final'
    const finalTmpl = bossId ? TEMPLATES.bossT! : TEMPLATES.finalT!

    for (let i = 0; i < 4; i++) {
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
    this.hazards = []
    this.boomRings = []
    this.orbitOn = false
    this.burstLeft = 0
    // 环境浮尘重新铺一层
    this.motes = []
    if (!REDUCED_MOTION) {
      for (let i = 0; i < 12; i++) {
        this.motes.push({
          x: this.rng.range(10, VIEW_W - 10),
          y: this.rng.range(20, ROOM_H_PX - 10),
          vx: this.rng.range(-3, 3),
          vy: this.rng.range(-2.5, 1.5),
        })
      }
    }

    const isCombat = room.waves.length > 0
    const isBoss = room.bossAnchor !== null
    if (isCombat && !room.cleared) {
      room.combatActive = true
      room.waveIdx = 0
      this.spawnWave(room)
      this.sfx.play('door')
      // 进新战斗房补一点能量
      this.player.energy = Math.min(this.weapon.energyMax, this.player.energy + 30)
      this.banner = { text: '房门已锁——消灭所有敌人！', t: 1.6 }
    } else if (isBoss && !room.cleared) {
      const a = room.bossAnchor
      const id = LEVEL_BOSS[this.levelIdx] ?? 'qianwang'
      const def = BOSSES[id]!
      this.boss = {
        id,
        x: a!.x,
        y: a!.y,
        hp: def.hp,
        maxHp: def.hp,
        r: def.r,
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
        aimX: 0,
        aimY: 1,
        rewarded: false,
      }
      this.sfx.play('boss')
      this.banner = { text: def.banner, t: 2.2 }
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
        // 顿帧 / BOSS 死亡慢动作：缩短本帧步长
        let step = dt
        if (this.slowT > 0) {
          this.slowT -= dt
          step = dt * this.slowScale
        }
        this.update(step)
        this.acc -= dt
      }
    }
    this.render()
  }

  /** 打击感顿帧：短暂压低 timeScale。 */
  private hitStop(t: number, scale: number): void {
    if (REDUCED_MOTION) return
    if (this.slowT <= 0 || scale < this.slowScale) {
      this.slowT = Math.max(this.slowT, t)
      this.slowScale = scale
    }
  }

  private update(dt: number): void {
    this.time += dt
    this.fade = clamp(this.fade + this.fadeDir * dt * 5.5, 0, 1)
    if (this.shake > 0) this.shake -= dt
    this.energyFlash = Math.max(0, this.energyFlash - dt)
    this.whiteFlash = Math.max(0, this.whiteFlash - dt * 1.6)
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 3)
    if (this.banner) {
      this.banner.t -= dt
      if (this.banner.t <= 0) this.banner = null
    }
    for (const f of this.floats) {
      f.t += dt
      f.y -= 22 * dt
    }
    this.floats = this.floats.filter((f) => f.t < 0.75)

    // 转场
    if (this.fade >= 1 && this.fadeDir > 0 && this.pendingTransition) {
      const { room, tx, ty } = this.pendingTransition
      this.pendingTransition = null
      this.enterRoom(room, tx, ty)
      this.fadeDir = -1
    }

    // 环境浮尘漂移（越界回绕）
    for (const m of this.motes) {
      m.x += m.vx * dt
      m.y += m.vy * dt
      if (m.x < 8) m.x = VIEW_W - 8
      else if (m.x > VIEW_W - 8) m.x = 8
      if (m.y < 20) m.y = ROOM_H_PX - 8
      else if (m.y > ROOM_H_PX - 8) m.y = 20
    }
    // 传送门漩涡粒子
    const portal = this.current?.portal
    if (portal && !REDUCED_MOTION) {
      this.portalT -= dt
      if (this.portalT <= 0) {
        this.portalT = 0.05
        for (let k = 0; k < 2; k++) {
          const ang = this.time * 4 + k * Math.PI
          const rr = 10 + Math.sin(this.time * 2 + k) * 4
          this.particles.list.push({
            x: portal.x + Math.cos(ang) * rr,
            y: portal.y + Math.sin(ang) * rr,
            vx: -Math.sin(ang) * 18,
            vy: Math.cos(ang) * 18,
            life: 0.4,
            max: 0.4,
            color: k === 0 ? '#ffd23f' : '#f5f5f7',
            size: 1,
            gravity: 0,
          })
        }
      }
    }
    // 宝箱流光（解锁未开时）
    const room = this.current
    if (room?.chest && !room.chest.opened && room.cleared && !REDUCED_MOTION) {
      this.chestT -= dt
      if (this.chestT <= 0) {
        this.chestT = 0.7
        this.particles.list.push({
          x: room.chest.x + (this.rng.next() - 0.5) * 12,
          y: room.chest.y - 6,
          vx: 0,
          vy: -14,
          life: 0.6,
          max: 0.6,
          color: '#ffd23f',
          size: 1,
          gravity: 0,
        })
      }
    }

    if (this.fade < 0.9) this.updatePlayer(dt)
    this.updateEnemies(dt)
    this.updateBoom(dt)
    this.updateBoss(dt)
    this.updateBullets(dt)
    this.updatePickups(dt)
    this.particles.update(dt)
    this.updateContextPrompt()
  }

  /* ------------------------------------------------------------ 玩家 */

  private weaponDef(): WeaponDef {
    return WEAPONS[this.weapon.weaponId] ?? WEAPONS.rapid!
  }

  private updatePlayer(dt: number): void {
    const p = this.player
    const def = this.weaponDef()
    p.iframe = Math.max(0, p.iframe - dt)
    p.fireCd = Math.max(0, p.fireCd - dt)
    // 能量自然回复
    p.energy = Math.min(this.weapon.energyMax, p.energy + ENERGY_REGEN * this.weapon.regenMul * dt)

    const ax = this.input.moveAxis()
    p.moving = ax.x !== 0 || ax.y !== 0
    if (p.moving) {
      p.anim += dt
      const spd = 108
      this.moveCircle(p, ax.x * spd * dt, ax.y * spd * dt, false)
      // 脚步扬尘
      p.dustT -= dt
      if (p.dustT <= 0 && !REDUCED_MOTION) {
        p.dustT = 0.16
        this.particles.list.push({
          x: p.x - ax.x * 5 + (this.rng.next() - 0.5) * 3,
          y: p.y + 4,
          vx: -ax.x * 12 + (this.rng.next() - 0.5) * 8,
          vy: -5,
          life: 0.28,
          max: 0.28,
          color: '#8d8574',
          size: 1,
          gravity: 0,
        })
      }
    }
    p.aim = this.autoAim ? this.autoAimAngle(p.x, p.y) : this.input.aimFrom(p.x, p.y)
    p.faceLeft = Math.cos(p.aim) < 0

    // 连珠点射排程
    if (this.burstLeft > 0) {
      this.burstT -= dt
      if (this.burstT <= 0) {
        this.burstT = 0.07
        this.burstLeft--
        const a = this.burstAngle + (this.rng.next() - 0.5) * 0.06
        this.spawnBullet(a, def, {})
        this.sfx.play('shoot')
      }
    }

    // 环绕钱刀：按住持续消耗能量
    if (def.pattern === 'orbit') {
      if (this.input.firing() && p.energy > 1) {
        this.orbitOn = true
        p.energy = Math.max(0, p.energy - def.cost * dt)
        this.orbitAngle += dt * 7
        this.orbitTick -= dt
        if (this.orbitTick <= 0) {
          this.orbitTick = 0.15
          for (let k = 0; k < 4; k++) {
            const a = this.orbitAngle + (k / 4) * Math.PI * 2
            // 内外交替双环：消除贴身盲区
            const orbR = k % 2 === 0 ? 33 : 21
            this.bullets.push({
              x: p.x + Math.cos(a) * orbR,
              y: p.y + Math.sin(a) * orbR,
              vx: 0,
              vy: 0,
              r: 9,
              dmg: this.weapon.dmg * def.dmgMul,
              pierce: 99,
              friendly: true,
              life: 0.23,
              spin: a,
              t: 0,
              hidden: true,
              melee: true,
              hit: new Set(),
            })
          }
        }
      } else {
        this.orbitOn = false
      }
    } else {
      this.orbitOn = false
      // 常规开火
      if (this.input.firing() && p.fireCd <= 0) {
        if (p.energy >= def.cost) {
          p.energy -= def.cost
          p.fireCd = this.weapon.interval * def.intervalMul
          this.fireWeapon(def)
        } else {
          this.energyFlash = 0.6
        }
      }
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

  /** 按武器 pattern 开火（能量已扣、冷却已设）。 */
  private fireWeapon(def: WeaponDef): void {
    const p = this.player
    const a0 = p.aim
    // 弹壳抛出（远程武器）：垂直方向弹出带重力的小壳粒
    if (!REDUCED_MOTION && def.pattern !== 'slash' && def.pattern !== 'orbit' && def.pattern !== 'slam') {
      const side = this.rng.next() < 0.5 ? 1 : -1
      const ca = a0 + (Math.PI / 2) * side
      this.particles.list.push({
        x: p.x + Math.cos(a0) * 4,
        y: p.y + Math.sin(a0) * 4,
        vx: Math.cos(ca) * 34,
        vy: Math.sin(ca) * 34 - 26,
        life: 0.45,
        max: 0.45,
        color: '#c8971e',
        size: 1,
        gravity: 300,
      })
    }
    switch (def.pattern) {
      case 'single': {
        const n = this.weapon.projectiles
        for (let i = 0; i < n; i++) this.spawnBullet(a0 + (n === 1 ? 0 : (i - (n - 1) / 2) * 0.16), def)
        this.sfx.play('shoot')
        break
      }
      case 'fan': {
        const n = 5 + (this.weapon.projectiles - 1) * 2
        const spread = def.spread ?? 0.34
        for (let i = 0; i < n; i++) this.spawnBullet(a0 + (i - (n - 1) / 2) * spread, def)
        this.sfx.play('shoot')
        break
      }
      case 'lance': {
        const n = this.weapon.projectiles
        for (let i = 0; i < n; i++) this.spawnBullet(a0 + (n === 1 ? 0 : (i - (n - 1) / 2) * 0.1), def)
        this.sfx.play('shoot')
        break
      }
      case 'burst': {
        // 首发立即，余两发由排程补上
        this.burstLeft = 2
        this.burstT = 0.07
        this.burstAngle = a0
        this.spawnBullet(a0, def, {})
        this.sfx.play('shoot')
        break
      }
      case 'homing': {
        const n = this.weapon.projectiles
        for (let i = 0; i < n; i++) this.spawnBullet(a0 + (n === 1 ? 0 : (i - (n - 1) / 2) * 0.25), def, { kind: 'homing', turn: 4.2 })
        this.sfx.play('shoot')
        break
      }
      case 'boomerang': {
        this.spawnBullet(a0, def, { kind: 'boomerang' })
        this.sfx.play('shoot')
        break
      }
      case 'lob': {
        // 落点 = 瞄准点（鼠标位置 / 自动瞄准目标 / 摇杆方向 90px），按距离定速度保证落点准确
        const tgt = this.aimTargetPoint()
        const d = clamp(dist(p.x, p.y, tgt.x, tgt.y), 40, 220)
        const flight = 0.55
        const a = Math.atan2(tgt.y - p.y, tgt.x - p.x)
        this.spawnBullet(a, def, { kind: 'lob', flight, z: 0 }, d / flight)
        this.sfx.play('shoot')
        break
      }
      case 'cannon': {
        this.spawnBullet(a0, def, {})
        this.sfx.play('shoot')
        this.particles.burst(p.x + Math.cos(a0) * 10, p.y + Math.sin(a0) * 10, '#ff9650', 4, 50, 0.2)
        break
      }
      case 'slash': {
        // 贴身反制：近身扇形立即结算+击退（弧光判定体在身前 16px 起，贴脸是盲区）
        {
          const sweepDmg = this.weapon.dmg * def.dmgMul
          const sweepHit = (tx: number, ty: number, r: number): boolean =>
            dist(p.x, p.y, tx, ty) < 18 + r &&
            Math.abs(Math.atan2(Math.sin(Math.atan2(ty - p.y, tx - p.x) - a0), Math.cos(Math.atan2(ty - p.y, tx - p.x) - a0))) < 1.35
          for (const e of this.enemies) {
            if (e.spawnT > 0) continue
            if (!sweepHit(e.x, e.y, e.r)) continue
            e.hp -= sweepDmg
            e.flash = 0.12
            this.addFloat(e.x, e.y - e.r - 2, fmtNum(sweepDmg), '#f5f5f7', 7)
            const dd = dist(p.x, p.y, e.x, e.y) || 1
            this.moveCircle(e, ((e.x - p.x) / dd) * 14, ((e.y - p.y) / dd) * 14, false)
            if (e.hp <= 0) this.enemyDie(e)
          }
          const bs = this.boss
          if (bs && !bs.dead && bs.spawnT <= 0 && sweepHit(bs.x, bs.y, bs.r)) this.damageBoss(sweepDmg, false)
          this.particles.burst(p.x + Math.cos(a0) * 10, p.y + Math.sin(a0) * 10, '#e8e2ff', 5, 60, 0.22)
        }
        // 三道弧光扇形斩（判定体更大更远，可劈碎敌弹）
        for (const off of [-0.5, 0, 0.5]) {
          const a = a0 + off
          this.bullets.push({
            x: p.x + Math.cos(a) * 27,
            y: p.y + Math.sin(a) * 27,
            vx: Math.cos(a) * 85,
            vy: Math.sin(a) * 85,
            r: 11,
            dmg: this.weapon.dmg * def.dmgMul,
            pierce: 99,
            friendly: true,
            life: 0.2,
            spin: a + Math.PI / 2,
            t: 0,
            sprite: 'slash',
            spinRate: 0,
            trailC: def.trail,
            melee: true,
            hit: new Set(),
          })
        }
        this.sfx.play('select')
        this.particles.burst(p.x + Math.cos(a0) * 30, p.y + Math.sin(a0) * 30, '#f5f5f7', 8, 80, 0.28)
        break
      }
      case 'slam': {
        this.sfx.play('explode')
        this.shake = REDUCED_MOTION ? 0 : 0.55
        this.particles.burst(p.x, p.y, '#cdd4e0', 14, 130, 0.45)
        this.particles.burst(p.x, p.y, '#828b9c', 10, 90, 0.55)
        const radius = def.blast ?? 40
        const dmg = this.weapon.dmg * def.dmgMul
        for (const e of this.enemies) {
          if (e.spawnT > 0) continue
          if (dist(p.x, p.y, e.x, e.y) < radius + e.r) {
            e.hp -= dmg
            e.flash = 0.15
            this.addFloat(e.x, e.y - e.r - 2, fmtNum(dmg), '#e8f1f8', 8)
            // 击退
            const d = dist(p.x, p.y, e.x, e.y) || 1
            this.moveCircle(e, ((e.x - p.x) / d) * 16, ((e.y - p.y) / d) * 16, false)
            if (e.hp <= 0) this.enemyDie(e)
          }
        }
        const boss = this.boss
        if (boss && !boss.dead && boss.spawnT <= 0 && dist(p.x, p.y, boss.x, boss.y) < radius + boss.r) {
          this.damageBoss(dmg, false)
        }
        // 震波消弹：范围内敌方弹丸全部震碎（自爆弹不触发爆炸）
        for (const eb of this.bullets) {
          if (eb.friendly || eb.life <= 0) continue
          if (eb.z !== undefined && eb.z > 6) continue
          if (dist(p.x, p.y, eb.x, eb.y) < radius + eb.r) {
            eb.blastE = undefined
            eb.life = 0
            this.particles.burst(eb.x, eb.y, '#f5f5f7', 3, 46, 0.22)
          }
        }
        break
      }
      case 'orbit':
        break // 环绕刀在 updatePlayer 里按帧处理
    }
    // 枪口火光（非近战/环绕）
    if (def.pattern !== 'slash' && def.pattern !== 'slam' && def.pattern !== 'orbit' && def.pattern !== 'cannon') {
      this.particles.burst(p.x + Math.cos(a0) * 9, p.y + Math.sin(a0) * 9, def.trail.replace(/^rgba\((\d+),(\d+),(\d+).*$/, 'rgba($1,$2,$3,0.8)'), 2, 26, 0.14)
    }
  }

  /** 造一发常规弹（速度/伤害/穿透/弹形取武器数值 × 武器定义）。speedPx 覆盖弹速。 */
  private spawnBullet(a: number, def: WeaponDef, over: Partial<Bullet> = {}, speedPx?: number): void {
    const p = this.player
    const speed = (speedPx ?? (def.speed ?? 250)) * this.weapon.speedMul
    const b: Bullet = {
      x: p.x + Math.cos(a) * 8,
      y: p.y + Math.sin(a) * 8,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      r: def.bulletR ?? 3.5,
      dmg: this.weapon.dmg * def.dmgMul,
      pierce: this.weapon.pierce + (def.pierce ?? 0),
      friendly: true,
      life: def.life ?? 1.4,
      spin: this.rng.next() * Math.PI * 2,
      t: 0,
      sprite: def.sprite,
      trailC: def.trail,
      hit: new Set(),
    }
    if (def.blast) b.blast = def.blast
    Object.assign(b, over)
    this.bullets.push(b)
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

  private solidAtPx(x: number, y: number): boolean {
    const room = this.current
    if (!room) return true
    const tx = Math.floor(x / TILE)
    const ty = Math.floor(y / TILE)
    if (tx < 0 || ty < 0 || tx >= ROOM_TW || ty >= ROOM_TH) return true
    return room.solid[ty * ROOM_TW + tx] !== 0
  }

  /* ------------------------------------------------------------ 敌人 */

  private spawnWave(room: Room): void {
    const wave = room.waves[room.waveIdx]
    if (!wave) return
    for (const entry of wave) {
      for (let i = 0; i < entry.count; i++) {
        const pos = this.findSpawnPos()
        this.summonEnemy(entry.arch, pos.x, pos.y, entry.elite === true)
      }
    }
    this.banner = { text: `第 ${room.waveIdx + 1} / ${room.waves.length} 波`, t: 1.2 }
  }

  private summonEnemy(arch: Arch, x: number, y: number, elite = false, spdOverride?: number): void {
    const base = ARCH_BASE[arch]
    const hpMul = 1 + this.levelIdx * 0.28
    this.enemies.push({
      id: this.nextId++,
      arch,
      x,
      y,
      hp: base.hp * hpMul * (elite ? 2.2 : 1),
      maxHp: base.hp * hpMul * (elite ? 2.2 : 1),
      r: base.r * (elite ? 1.25 : 1),
      spd: spdOverride ?? base.spd * (elite ? 1.15 : 1),
      elite,
      flash: 0,
      anim: this.rng.next() * 2,
      spawnT: 0.5,
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
      // 接触钳制：贴到碰撞边缘就不再逼近（防止吸到玩家圆心坐脸）
      const hold = d > e.r + p.r + 3 ? 1 : 0

      switch (e.arch) {
        case 'blob': {
          const wob = Math.sin(this.time * 3 + e.phase) * 0.35
          this.moveCircle(e, (ux * hold - uy * wob) * e.spd * dt, (uy * hold + ux * wob) * e.spd * dt, false)
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
              this.bullets.push(this.enemyShot(e.x, e.y, a, 125))
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
          this.moveCircle(e, (ux * hold - uy * wob) * e.spd * dt, (uy * hold + ux * wob) * e.spd * dt, true)
          e.faceLeft = ux < 0
          break
        }
        case 'dash': {
          if (e.state === 0) {
            // 潜行接近（贴身即停，转入蓄力）
            this.moveCircle(e, ux * hold * e.spd * dt, uy * hold * e.spd * dt, false)
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
          this.moveCircle(e, ux * hold * e.spd * dt, uy * hold * e.spd * dt, false)
          e.faceLeft = ux < 0
          if (e.state === 1) {
            e.t -= dt
            if (e.t <= 0) {
              e.state = 0
              // 环形 8 向弹
              for (let k = 0; k < 8; k++) {
                const a = (k / 8) * Math.PI * 2 + e.phase
                this.bullets.push(this.enemyShot(e.x, e.y, a, 95, 3))
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
        case 'bomb': {
          if (e.state === 0) {
            // 竹钱妖追击（贴身即停，留给玩家跑出爆炸圈的余地）
            this.moveCircle(e, ux * hold * e.spd * dt, uy * hold * e.spd * dt, false)
            e.faceLeft = ux < 0
            if (d < 26) {
              e.state = 1
              e.t = 0.8
              this.sfx.play('select')
            }
          } else if (e.state === 1) {
            // 引信倒计时：原地待爆 + 火星 + 加速闪烁
            e.t -= dt
            if (!REDUCED_MOTION && Math.random() < 0.35) {
              this.particles.trail(e.x + (Math.random() - 0.5) * 4, e.y - e.r - 4, '#ffd23f')
            }
            if (e.t <= 0) {
              // 引信烧尽：大爆（伤玩家 + 波及小怪）
              e.state = 2
              e.hp = 0
              this.blastEnemy(e.x, e.y, 26, 2)
              this.enemyDie(e)
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
        if (this.clearedCombat.size >= 4) {
          this.banner = { text: '四房已清——关底大门开启！', t: 2 }
          this.sfx.play('upgrade')
        }
      }
    }
  }

  private enemyShot(x: number, y: number, a: number, speed: number, r = 3.5, over: Partial<Bullet> = {}): Bullet {
    const b: Bullet = {
      x: x + Math.cos(a) * 8,
      y: y + Math.sin(a) * 8,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      r,
      dmg: 1,
      pierce: 0,
      friendly: false,
      life: 4,
      spin: 0,
      t: 0,
      hit: new Set(),
    }
    Object.assign(b, over)
    return b
  }

  /** 自动瞄准：最近的可命中目标（含 BOSS）；无目标时退回手动瞄准。 */
  private autoAimAngle(px: number, py: number): number {
    let best: { x: number; y: number } | null = null
    let bd = Infinity
    for (const e of this.enemies) {
      if (e.spawnT > 0) continue
      const d = dist(px, py, e.x, e.y)
      if (d < bd) { bd = d; best = e }
    }
    const b = this.boss
    if (b && !b.dead) {
      const d = dist(px, py, b.x, b.y)
      if (d < bd) { bd = d; best = b }
    }
    return best ? Math.atan2(best.y - py, best.x - px) : this.input.aimFrom(px, py)
  }

  /** 瞄准落点（爆雷等抛射武器用）：自动瞄准→目标实体；摇杆→朝向 90px；鼠标→指针位置。 */
  private aimTargetPoint(): Vec {
    const p = this.player
    if (this.autoAim) {
      const t = this.nearestTarget(p.x, p.y)
      if (t) return t
    }
    const stick = this.input.stickAim
    if (stick && (stick.x !== 0 || stick.y !== 0)) {
      const a = Math.atan2(stick.y, stick.x)
      return { x: p.x + Math.cos(a) * 90, y: p.y + Math.sin(a) * 90 }
    }
    return { x: this.input.pointer.x, y: this.input.pointer.y }
  }

  private hurtPlayer(kx: number, ky: number): void {
    const p = this.player
    p.hp -= 1
    p.iframe = 1.1
    this.sfx.play('playerHurt')
    this.hurtFlash = 0.35
    this.shake = REDUCED_MOTION ? 0 : 0.45
    this.particles.burst(p.x, p.y, '#e0453a', 14, 90, 0.45, 2)
    this.particles.burst(p.x, p.y, '#ffffff', 4, 60, 0.3)
    // 击退
    this.moveCircle(p, -kx * 14, -ky * 14, false)
    if (p.hp <= 0) {
      p.hp = 0
      this.paused = true
      this.cb.onGameOver()
    }
  }

  /** 敌人死亡：爆散 + 掉落（红心 / 能量珠）。 */
  private enemyDie(e: Enemy): void {
    const p = this.player
    this.particles.burst(e.x, e.y, ERA_PALETTES[this.levelIdx]!.tint, 12, 90, 0.5)
    this.particles.burst(e.x, e.y, '#ffd23f', 10, 70, 0.45)
    // 金币雨：带重力散落
    if (!REDUCED_MOTION) {
      for (let i = 0; i < 5; i++) {
        this.particles.list.push({
          x: e.x,
          y: e.y,
          vx: this.rng.range(-45, 45),
          vy: this.rng.range(-70, -25),
          life: 0.55,
          max: 0.55,
          color: i % 2 === 0 ? '#ffd23f' : '#c8971e',
          size: 2,
          gravity: 230,
        })
      }
    }
    if (e.elite) this.hitStop(0.06, 0.25)
    this.sfx.play('enemyDie')
    // 竹钱妖被提前击杀：小爆只伤小怪（不伤玩家），可连锁
    if (e.arch === 'bomb' && e.state !== 2) {
      this.blastEnemy(e.x, e.y, 16, 1.5, false)
    }
    const wantHeart = p.hp < p.maxHp
    if (e.elite) {
      if (wantHeart) this.pickups.push({ x: e.x - 5, y: e.y, t: 0, type: 'heart' })
      this.pickups.push({ x: e.x + 5, y: e.y, t: 0, type: 'orb' })
    } else {
      const r = this.rng.next()
      if (wantHeart && r < 0.28) this.pickups.push({ x: e.x, y: e.y, t: 0, type: 'heart' })
      else if (this.rng.next() < 0.3) this.pickups.push({ x: e.x, y: e.y, t: 0, type: 'orb' })
    }
  }

  private addFloat(x: number, y: number, text: string, color: string, size = 7): void {
    if (REDUCED_MOTION) return
    this.floats.push({ x, y, text, t: 0, color, size })
  }

  /** 爆炸视觉：闪芯 + 大火花 + 余烬 + 烟雾 + 冲击环 + 地面焦痕。 */
  private boomFx(x: number, y: number, r: number): void {
    this.sfx.play('explode')
    this.shake = REDUCED_MOTION ? 0 : Math.min(1.8, r / 26)
    this.particles.burst(x, y, '#ffffff', 8, r * 3.5, 0.22, 3)
    this.particles.burst(x, y, '#ffd23f', 16, r * 4.5, 0.5, 3)
    this.particles.burst(x, y, '#ff7840', 14, r * 3, 0.55, 3)
    if (!REDUCED_MOTION) {
      // 烟雾缓慢上浮
      for (let i = 0; i < 6; i++) {
        this.particles.list.push({
          x: x + (this.rng.next() - 0.5) * r * 0.8,
          y: y + (this.rng.next() - 0.5) * r * 0.5,
          vx: (this.rng.next() - 0.5) * 14,
          vy: -18 - this.rng.next() * 16,
          life: 0.9,
          max: 0.9,
          color: '#565663',
          size: this.rng.next() < 0.5 ? 3 : 4,
          gravity: 0,
        })
      }
      this.boomRings.push({ x, y, max: r * 1.5, t: 0 })
    }
    this.scorches.push({ x, y, r, life: 5 })
    if (this.scorches.length > 30) this.scorches.shift()
  }

  /** 敌方爆炸：伤玩家（可选）+ 波及小怪，可连锁。 */
  private blastEnemy(x: number, y: number, r: number, dmg: number, hurtPlayer = true): void {
    this.boomFx(x, y, r)
    const p = this.player
    if (hurtPlayer && p.iframe <= 0 && dist(x, y, p.x, p.y) < r + p.r) {
      const dd = dist(x, y, p.x, p.y) || 1
      this.hurtPlayer((p.x - x) / dd, (p.y - y) / dd)
    }
    for (const e of this.enemies) {
      if (e.spawnT > 0 || e.hp <= 0) continue
      if (dist(x, y, e.x, e.y) < r + e.r) {
        e.hp -= dmg
        e.flash = 0.15
        this.addFloat(e.x, e.y - e.r - 2, fmtNum(dmg), '#ffb066', 8)
        if (e.hp <= 0) this.enemyDie(e)
      }
    }
  }

  /** 爆炸：范围伤害（可选击退）+ 双色粒子 + 震屏。 */
  private explode(x: number, y: number, radius: number, dmg: number, knock = false): void {
    this.boomFx(x, y, radius)
    for (const e of this.enemies) {
      if (e.spawnT > 0) continue
      if (dist(x, y, e.x, e.y) < radius + e.r) {
        e.hp -= dmg
        e.flash = 0.15
        this.addFloat(e.x, e.y - e.r - 2, fmtNum(dmg), '#ffb066', 8)
        if (knock) {
          const d = dist(x, y, e.x, e.y) || 1
          this.moveCircle(e, ((e.x - x) / d) * 14, ((e.y - y) / d) * 14, false)
        }
        if (e.hp <= 0) this.enemyDie(e)
      }
    }
    const boss = this.boss
    if (boss && !boss.dead && boss.spawnT <= 0 && dist(x, y, boss.x, boss.y) < radius + boss.r) {
      this.damageBoss(dmg, false)
    }
  }

  private damageBoss(dmg: number, crit: boolean): void {
    const b = this.boss
    if (!b || b.dead) return
    b.hp -= dmg
    b.flash = 0.1
    this.addFloat(b.x + (this.rng.next() - 0.5) * 14, b.y - b.r - 4, (crit ? '暴击 ' : '') + fmtNum(dmg), crit ? '#ff5b4d' : '#f5f5f7', crit ? 9 : 7)
    if (b.hp <= 0) {
      b.hp = 0
      b.dead = true
      // 死亡慢动作 + 白闪 + 双冲击环
      this.shake = REDUCED_MOTION ? 0 : 1.6
      this.slowT = REDUCED_MOTION ? 0 : 0.5
      this.slowScale = 0.3
      this.whiteFlash = 0.5
      if (!REDUCED_MOTION) {
        this.boomRings.push({ x: b.x, y: b.y, max: b.r * 3, t: 0 })
        this.boomRings.push({ x: b.x, y: b.y, max: b.r * 4.5, t: -0.12 })
      }
      this.sfx.play('boss')
    }
  }

  /* ------------------------------------------------------------ BOSS */

  private updateBoss(dt: number): void {
    const b = this.boss
    if (!b) return
    const def = BOSSES[b.id]!
    const p = this.player
    b.flash = Math.max(0, b.flash - dt)

    if (b.dead) {
      b.deadT += dt
      if (b.deadT > 0.2 && b.deadT - dt <= 0.2) this.particles.burst(b.x, b.y, '#ffd23f', 40, 140, 0.9)
      if (b.deadT > 1.4 && !b.rewarded) {
        b.rewarded = true
        if (b.id === 'qianwang') {
          this.paused = true
          this.sfx.play('victory')
          this.cb.onVictory()
        } else {
          // 中途 BOSS：双倍强化 + 补给 + 开传送门
          const room = this.current!
          room.portal = { x: room.bossAnchor?.x ?? b.x, y: (room.bossAnchor?.y ?? b.y) + 26 }
          room.cleared = true
          this.applyUpgrade()
          this.applyUpgrade()
          p.hp = Math.min(p.maxHp, p.hp + 2)
          p.energy = this.weapon.energyMax
          this.pickups.push({ x: b.x - 8, y: b.y, t: 0, type: 'heart' })
          for (let k = 0; k < 5; k++) {
            const a = (k / 5) * Math.PI * 2
            this.pickups.push({ x: b.x + Math.cos(a) * 20, y: b.y + Math.sin(a) * 20, t: 0, type: 'orb' })
          }
          this.banner = { text: 'BOSS 击破！强化 ×2 · 传送门开启', t: 2.6 }
          this.sfx.play('victory')
        }
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

    // 阶段切换
    if (b.phase === 1 && b.hp <= b.maxHp / 2) {
      b.phase = 2
      b.flash = 0.4
      this.shake = REDUCED_MOTION ? 0 : 0.5
      this.sfx.play('boss')
      this.banner = { text: def.rageBanner, t: 2.2 }
    }
    if (b.id === 'qianwang' && b.phase === 2 && b.hp <= b.maxHp / 4) {
      b.phase = 3
      b.flash = 0.5
      this.shake = REDUCED_MOTION ? 0 : 0.7
      this.sfx.play('boss')
      this.banner = { text: '当百钱海——虚值滔天！', t: 2.4 }
    }

    b.patternT -= dt
    const speedMul = b.phase === 3 ? 1.5 : b.phase === 2 ? 1.3 : 1
    const drift = (b.id === 'zhushen' ? 26 : b.id === 'zhimo' ? 28 : 32) * speedMul

    if (b.pattern <= 0) {
      // 漂移逼近 → 按 BOSS 挑下一个技能
      this.moveCircle(b, ux * drift * dt, uy * drift * dt, false)
      if (b.patternT <= 0) {
        const pools: Record<BossId, number[]> = {
          zhushen: b.phase === 2 ? [1, 2, 3, 4, 3] : [1, 2, 3, 4],
          shengshou: b.phase === 2 ? [1, 2, 3, 4, 1] : [1, 2, 3, 4],
          zhimo: b.phase === 2 ? [1, 2, 3, 4, 2] : [1, 2, 3, 4],
          qianwang:
            b.phase === 3 ? [1, 2, 3, 4, 5, 6, 7] : b.phase === 2 ? [1, 2, 3, 4, 6] : [1, 2, 3],
        }
        const pool = pools[b.id]
        b.pattern = pool[this.rng.int(0, pool.length - 1)]!
        b.step = 0
        b.fireT = 0
        b.patternT = 0
        // 带预警的技能给前摇时间
        if (b.id === 'zhushen' && b.pattern === 3) b.patternT = 0.75
        if (b.id === 'zhushen' && b.pattern === 4) b.patternT = 0.55
        if (b.id === 'shengshou' && b.pattern === 3) b.patternT = 0.4
        if (b.id === 'zhimo' && b.pattern === 4) b.patternT = 0.9
        if (b.id === 'qianwang' && b.pattern === 7) b.patternT = 0.9
      }
      return
    }

    switch (b.id) {
      case 'zhushen': {
        if (b.pattern === 1) {
          // 铸模弹幕：环形 3 轮（二阶段 16 向）
          if (b.patternT <= 0) {
            const n = b.phase === 2 ? 16 : 12
            const off = b.step * 0.22
            for (let k = 0; k < n; k++) {
              const a = (k / n) * Math.PI * 2 + off
              this.bullets.push(this.enemyShot(b.x, b.y, a, 78 + b.phase * 12, 3, { life: 4.5 }))
            }
            this.sfx.play('hit')
            b.step++
            b.patternT = 0.34
            if (b.step >= 3) {
              b.pattern = 0
              b.patternT = 1.5
            }
          }
        } else if (b.pattern === 2) {
          // 开范召唤贝仔
          if (b.step === 0) {
            for (let k = 0; k < 3; k++) {
              const a = (k / 3) * Math.PI * 2
              const px = clamp(b.x + Math.cos(a) * 34, 24, VIEW_W - 24)
              const py = clamp(b.y + Math.sin(a) * 34, 24, ROOM_H_PX - 24)
              this.summonEnemy('blob', px, py)
            }
            this.banner = { text: '铸神开范——贝仔涌出！', t: 1.4 }
            b.step = 1
            b.patternT = 1.2
          } else if (b.patternT <= 0) {
            b.pattern = 0
            b.patternT = 1.4
          }
        } else if (b.pattern === 3) {
          // 铜液浇铸：预警线 → 直线激光
          if (b.step === 0) {
            if (b.fireT === 0) {
              // 进场即锁定方向，预警 0.75s 后喷射
              b.aimX = ux
              b.aimY = uy
              b.fireT = 1
            }
            if (b.patternT <= 0) {
              b.step = 1
              b.patternT = 0.65
              this.sfx.play('boss')
              this.shake = REDUCED_MOTION ? 0 : 0.3
            }
          }
          if (b.step === 1) {
            // 喷射中的伤害判定
            if (p.iframe <= 0 && this.distToRay(p.x, p.y, b.x, b.y, b.aimX, b.aimY, 340) < 8) {
              this.hurtPlayer(b.aimX, b.aimY)
            }
            if (!REDUCED_MOTION && Math.random() < 0.6) {
              const len = this.rng.range(20, 330)
              this.particles.burst(b.x + b.aimX * len, b.y + b.aimY * len, '#ffd23f', 1, 30, 0.3)
            }
            if (b.patternT <= 0) {
              b.fireT = 0
              b.pattern = 0
              b.patternT = 1.4
            }
          }
        } else if (b.pattern === 4) {
          // 范锤砸击：锁定落点红圈预警 → 冲刺砸地 AOE + 环形冲击弹
          if (b.step === 0) {
            if (b.fireT === 0) {
              b.aimX = p.x
              b.aimY = p.y
              b.fireT = 1
              this.hazards.push({ x: p.x, y: p.y, r: 28, t: 0.55, t0: 0.55, dmg: 0 })
              this.banner = { text: '铸神举范——砸！', t: 1.2 }
            }
            if (b.patternT <= 0) {
              b.step = 1
              b.patternT = 0.4
              const dd = dist(b.x, b.y, b.aimX, b.aimY) || 1
              b.dirX = (b.aimX - b.x) / dd
              b.dirY = (b.aimY - b.y) / dd
              this.sfx.play('boss')
            }
          } else if (b.step === 1) {
            const remain = Math.max(b.patternT, 0.06)
            const spd = Math.max(240, Math.min(560, dist(b.x, b.y, b.aimX, b.aimY) / remain))
            b.x = clamp(b.x + b.dirX * spd * dt, 24, VIEW_W - 24)
            b.y = clamp(b.y + b.dirY * spd * dt, 24, ROOM_H_PX - 24)
            if (!REDUCED_MOTION && Math.random() < 0.7) {
              this.particles.trail(b.x, b.y + 6, '#c8971e')
            }
            if (b.patternT <= 0) {
              // 落地：AOE 震荡 + 环形冲击弹
              b.x = clamp(b.aimX, 24, VIEW_W - 24)
              b.y = clamp(b.aimY, 24, ROOM_H_PX - 24)
              this.blastEnemy(b.x, b.y, 30, 2)
              for (let k = 0; k < 10; k++) {
                this.bullets.push(this.enemyShot(b.x, b.y, (k / 10) * Math.PI * 2, 70, 2.5, { life: 3 }))
              }
              b.dirX = 0
              b.dirY = 0
              b.fireT = 0
              b.pattern = 0
              b.patternT = 1.6
            }
          }
        }
        break
      }
      case 'shengshou': {
        if (b.pattern === 1) {
          // 旋风飞轮：反弹钱轮（二阶段 4 枚）
          if (b.patternT <= 0 && b.step === 0) {
            const n = b.phase === 2 ? 4 : 3
            for (let k = 0; k < n; k++) {
              const a = b.angle + (k / n) * Math.PI * 2
              this.bullets.push(
                this.enemyShot(b.x, b.y, a, 120 + this.rng.range(0, 40), 5, {
                  life: 5,
                  kind: 'wheel',
                  bounce: 8,
                  sprite: 'roll',
                }),
              )
            }
            b.angle += 0.7
            this.sfx.play('hit')
            b.step = 1
            b.patternT = 1.9
          } else if (b.patternT <= 0) {
            b.pattern = 0
            b.patternT = 1.2
          }
        } else if (b.pattern === 2) {
          // 新月斩波：3 组瞄准扇形
          if (b.patternT <= 0) {
            const base = Math.atan2(p.y - b.y, p.x - b.x)
            for (let k = -2; k <= 2; k++) {
              this.bullets.push(this.enemyShot(b.x, b.y, base + k * 0.2, 95, 3.5, { life: 4 }))
            }
            this.sfx.play('hit')
            b.step++
            b.patternT = 0.45
            if (b.step >= 3) {
              b.pattern = 0
              b.patternT = 1.6
            }
          }
        } else if (b.pattern === 3) {
          // 瞬移 + 环形弹
          if (b.step === 0) {
            if (b.fireT === 0) {
              b.fireT = 1
              this.particles.burst(b.x, b.y, '#f5f5f7', 12, 70, 0.4)
              this.sfx.play('select')
            }
            if (b.patternT <= 0) {
              const pos = this.findBlinkPos()
              b.x = pos.x
              b.y = pos.y
              this.particles.burst(b.x, b.y, '#ffd23f', 14, 90, 0.4)
              for (let k = 0; k < 10; k++) {
                const a = (k / 10) * Math.PI * 2
                this.bullets.push(this.enemyShot(b.x, b.y, a, 100, 3, { life: 4 }))
              }
              this.sfx.play('hit')
              b.fireT = 0
              b.pattern = 0
              b.patternT = 1.2
            }
          }
        } else if (b.pattern === 4) {
          // 飞轮过载：慢速自爆轮（寿命尽/反弹耗尽/命中玩家时爆炸）
          if (b.patternT <= 0 && b.step === 0) {
            const n = b.phase === 2 ? 3 : 2
            const base = Math.atan2(p.y - b.y, p.x - b.x)
            for (let k = 0; k < n; k++) {
              this.bullets.push(
                this.enemyShot(b.x, b.y, base + (k - (n - 1) / 2) * 0.55, 64, 5, {
                  life: 3.2,
                  kind: 'wheel',
                  bounce: 4,
                  sprite: 'roll',
                  blastE: 20,
                  trailC: '#e0453a',
                }),
              )
            }
            this.banner = { text: '飞轮过载——自爆轮出闸！', t: 1.4 }
            this.sfx.play('hit')
            b.step = 1
            b.patternT = 1.9
          } else if (b.patternT <= 0) {
            b.pattern = 0
            b.patternT = 1.2
          }
        }
        break
      }
      case 'zhimo': {
        if (b.pattern === 1) {
          // 纸刃螺旋（二阶段 4 臂）
          if (b.patternT <= 0) {
            b.fireT -= dt
            if (b.fireT <= 0) {
              b.fireT = 0.08
              b.angle += 0.42
              const arms = b.phase === 2 ? [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2] : [0, Math.PI]
              for (const s of arms) {
                const a = b.angle + s
                this.bullets.push(this.enemyShot(b.x, b.y, a, 100, 3, { life: 4, sprite: 'projNote' }))
              }
              b.step++
            }
            if (b.step > 32) {
              b.pattern = 0
              b.patternT = 1.4
            }
          }
        } else if (b.pattern === 2) {
          // 宝钞雨：预警 → 顶部落纸
          if (b.step === 0) {
            this.banner = { text: '纸魔召来宝钞雨！', t: 1.2 }
            b.step = 1
            b.patternT = 0.8
            b.fireT = 0
          } else if (b.patternT <= 0) {
            b.fireT -= dt
            if (b.fireT <= 0) {
              b.fireT = b.phase === 2 ? 0.11 : 0.15
              const x = clamp(p.x + this.rng.range(-75, 75), 26, VIEW_W - 26)
              this.bullets.push({
                x,
                y: 20,
                vx: this.rng.range(-8, 8),
                vy: 68 + (b.phase === 2 ? 22 : 0),
                r: 3,
                dmg: 1,
                pierce: 0,
                friendly: false,
                life: 5,
                spin: 0,
                t: 0,
                sprite: 'projNote',
                hit: new Set(),
              })
              b.step++
            }
            if (b.step > 22) {
              b.pattern = 0
              b.patternT = 1.5
            }
          }
        } else if (b.pattern === 3) {
          // 撕钞分身：两只纸灵（精英飞虫）
          if (b.step === 0) {
            for (const s of [-1, 1]) {
              this.summonEnemy('fly', clamp(b.x + s * 30, 24, VIEW_W - 24), clamp(b.y - 20, 24, ROOM_H_PX - 24), true)
            }
            this.banner = { text: '纸魔撕下两角——纸灵扑来！', t: 1.4 }
            b.step = 1
            b.patternT = 1.1
          } else if (b.patternT <= 0) {
            b.pattern = 0
            b.patternT = 1.3
          }
        } else if (b.pattern === 4) {
          // 幽魂凝视：粗激光预警 → 宽光束缓慢扫摆（±0.5rad）
          if (b.step === 0) {
            if (b.fireT === 0) {
              const a0 = Math.atan2(p.y - b.y, p.x - b.x)
              b.aimX = Math.cos(a0)
              b.aimY = Math.sin(a0)
              b.angle = a0
              b.fireT = 1
              this.banner = { text: '纸魔凝视——幽光将扫过！', t: 1.4 }
            }
            if (b.patternT <= 0) {
              b.step = 1
              b.patternT = 1.4
              this.sfx.play('boss')
              this.shake = REDUCED_MOTION ? 0 : 0.35
            }
          } else {
            const a = b.angle + Math.sin(this.time * 2.4) * 0.5
            const dx = Math.cos(a)
            const dy = Math.sin(a)
            if (p.iframe <= 0 && this.distToRay(p.x, p.y, b.x, b.y, dx, dy, 340) < 7) {
              this.hurtPlayer(dx, dy)
            }
            if (!REDUCED_MOTION && Math.random() < 0.7) {
              const len = this.rng.range(20, 330)
              this.particles.burst(b.x + dx * len, b.y + dy * len, '#a78bfa', 1, 34, 0.3)
            }
            if (b.patternT <= 0) {
              b.fireT = 0
              b.pattern = 0
              b.patternT = 1.4
            }
          }
        }
        break
      }
      case 'qianwang': {
        switch (b.pattern) {
          case 1: { // 环形弹幕（3 轮）
            if (b.patternT <= 0) {
              const n = b.phase === 3 ? 18 : 14
              const off = b.step * 0.22
              for (let k = 0; k < n; k++) {
                const a = (k / n) * Math.PI * 2 + off
                this.bullets.push(
                  this.enemyShot(b.x, b.y, a, 78 + b.phase * 14, b.phase === 3 ? 4.5 : 3, { life: 4.5 }),
                )
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
                this.bullets.push(this.enemyShot(b.x, b.y, base + k * 0.16, 130, 3, { life: 4 }))
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
          case 4: { // 螺旋流
            if (b.patternT <= 0) {
              b.fireT -= dt
              if (b.fireT <= 0) {
                b.fireT = 0.07
                b.angle += 0.42
                for (const s of b.phase === 3 ? [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2] : [0, Math.PI]) {
                  const a = b.angle + s
                  this.bullets.push(this.enemyShot(b.x, b.y, a, 105, 3, { life: 4 }))
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
          case 5: { // 三阶段·当百钱海：大钱环 + 召唤铁卫
            if (b.patternT <= 0) {
              const n = 18
              const off = b.step * 0.19
              for (let k = 0; k < n; k++) {
                const a = (k / n) * Math.PI * 2 + off
                this.bullets.push(this.enemyShot(b.x, b.y, a, 66, 4.5, { life: 4.5, sprite: 'projBig' }))
              }
              this.shake = REDUCED_MOTION ? 0 : 0.3
              this.sfx.play('hit')
              b.step++
              b.patternT = 0.42
              if (b.step === 1 && this.enemies.length < 4) {
                for (const s of [-1, 1]) {
                  this.summonEnemy('tank', clamp(b.x + s * 40, 24, VIEW_W - 24), b.y + 24)
                }
                this.banner = { text: '钱王召来铁卫！', t: 1.2 }
              }
              if (b.step >= 3) {
                b.pattern = 0
                b.patternT = 1.2
              }
            }
            break
          }
          case 6: { // 当百炮轰：玩家附近三处预警 → 依次大爆
            if (b.step === 0) {
              this.banner = { text: '当百炮轰——避开盘口！', t: 1.4 }
              for (let k = 0; k < 3; k++) {
                const hx = clamp(p.x + this.rng.range(-42, 42), 30, VIEW_W - 30)
                const hy = clamp(p.y + this.rng.range(-32, 32), 26, ROOM_H_PX - 26)
                this.hazards.push({ x: hx, y: hy, r: 30, t: 0.7 + k * 0.28, t0: 0.98, dmg: 2 })
              }
              this.sfx.play('boss')
              b.step = 1
              b.patternT = 2.1
            } else if (b.patternT <= 0) {
              b.pattern = 0
              b.patternT = 1.3
            }
            break
          }
          case 7: { // 帝瞳金光：粗激光缓慢横扫（仅三阶段）
            if (b.step === 0) {
              if (b.fireT === 0) {
                const a0 = Math.atan2(p.y - b.y, p.x - b.x)
                b.aimX = Math.cos(a0)
                b.aimY = Math.sin(a0)
                b.angle = a0
                b.fireT = 1
                this.banner = { text: '帝瞳金光——横扫千军！', t: 1.4 }
              }
              if (b.patternT <= 0) {
                b.step = 1
                b.patternT = 2.0
                this.sfx.play('boss')
                this.shake = REDUCED_MOTION ? 0 : 0.4
              }
            } else {
              const a = b.angle + Math.sin(this.time * 1.5) * 0.8
              const dx = Math.cos(a)
              const dy = Math.sin(a)
              if (p.iframe <= 0 && this.distToRay(p.x, p.y, b.x, b.y, dx, dy, 360) < 8) {
                this.hurtPlayer(dx, dy)
              }
              if (!REDUCED_MOTION && Math.random() < 0.8) {
                const len = this.rng.range(20, 350)
                this.particles.burst(b.x + dx * len, b.y + dy * len, '#ffd23f', 1, 36, 0.3)
              }
              if (b.patternT <= 0) {
                b.fireT = 0
                b.pattern = 0
                b.patternT = 1.5
              }
            }
            break
          }
        }
        break
      }
    }

    // 二阶段召唤
    if (b.phase >= 2) {
      b.summonT -= dt
      if (b.summonT <= 0 && this.enemies.length < 4) {
        b.summonT = 11
        for (let k = 0; k < 3; k++) {
          const pos = this.findSpawnPos()
          this.summonEnemy(def.summonArch, pos.x, pos.y)
        }
        this.banner = { text: 'BOSS 召来援军！', t: 1.2 }
      }
    }

    // 接触伤害
    if (p.iframe <= 0 && d < b.r + p.r) {
      this.hurtPlayer(ux, uy)
    }
  }

  /** 点到射线（起点 o、单位方向 d、长 len）的最短距离。 */
  private distToRay(px: number, py: number, ox: number, oy: number, dx: number, dy: number, len: number): number {
    const t = clamp((px - ox) * dx + (py - oy) * dy, 0, len)
    return dist(px, py, ox + dx * t, oy + dy * t)
  }

  private findBlinkPos(): Vec {
    const p = this.player
    for (let i = 0; i < 16; i++) {
      const a = this.rng.next() * Math.PI * 2
      const r = 70 + this.rng.next() * 40
      const x = clamp(p.x + Math.cos(a) * r, 30, VIEW_W - 30)
      const y = clamp(p.y + Math.sin(a) * r, 30, ROOM_H_PX - 30)
      if (!this.solidAtPx(x, y)) return { x, y }
    }
    return { x: clamp(p.x, 30, VIEW_W - 30), y: clamp(p.y - 70, 30, ROOM_H_PX - 30) }
  }

  /* ------------------------------------------------------------ 弹丸与掉落 */

  /** 爆炸余波：冲击环扩散 / 焦痕渐隐 / 预警圈倒计时引爆。 */
  private updateBoom(dt: number): void {
    for (const r of this.boomRings) r.t += dt
    this.boomRings = this.boomRings.filter((r) => r.t < 0.35)
    for (const s of this.scorches) s.life -= dt
    this.scorches = this.scorches.filter((s) => s.life > 0)
    for (const h of this.hazards) {
      h.t -= dt
      if (h.t <= 0 && h.dmg > 0) this.blastEnemy(h.x, h.y, h.r, h.dmg)
    }
    this.hazards = this.hazards.filter((h) => h.t > 0)
  }

  private updateBullets(dt: number): void {
    const room = this.current!
    const p = this.player
    for (const b of this.bullets) {
      b.t += dt
      b.life -= dt
      b.spin += dt * (b.spinRate ?? 9)

      // 行为更新
      if (b.kind === 'homing' && b.friendly) {
        const tgt = this.nearestTarget(b.x, b.y)
        if (tgt) {
          const speed = Math.hypot(b.vx, b.vy)
          const want = Math.atan2(tgt.y - b.y, tgt.x - b.x)
          const cur = Math.atan2(b.vy, b.vx)
          let diff = want - cur
          while (diff > Math.PI) diff -= Math.PI * 2
          while (diff < -Math.PI) diff += Math.PI * 2
          const turn = Math.max(-b.turn! * dt, Math.min(b.turn! * dt, diff))
          const a = cur + turn
          b.vx = Math.cos(a) * speed
          b.vy = Math.sin(a) * speed
        }
      }
      if (b.kind === 'boomerang') {
        const speed = Math.hypot(b.vx, b.vy)
        if (!b.returning && b.t > 0.42) {
          b.returning = true
          b.hit.clear() // 回程可以再打一遍
        }
        if (b.returning) {
          const a = Math.atan2(p.y - b.y, p.x - b.x)
          b.vx = Math.cos(a) * speed
          b.vy = Math.sin(a) * speed
          if (dist(b.x, b.y, p.x, p.y) < 10) b.life = 0
        }
      }
      if (b.flight !== undefined) {
        // 抛射高度弧线
        b.z = Math.sin(Math.PI * Math.min(1, b.t / b.flight)) * 24
      }

      b.x += b.vx * dt
      b.y += b.vy * dt

      // 撞墙
      const tx = Math.floor(b.x / TILE)
      const ty = Math.floor(b.y / TILE)
      const offGrid = tx < 0 || ty < 0 || tx >= ROOM_TW || ty >= ROOM_TH
      const hitWall = !offGrid && room.solid[ty * ROOM_TW + tx] !== 0
      if ((offGrid || hitWall) && (b.z === undefined || b.z < 4)) {
        if (b.bounce && b.bounce > 0 && !offGrid) {
          b.bounce -= 1
          const sx = Math.sign(b.vx)
          const sy = Math.sign(b.vy)
          const sideX = this.solidAtPx(b.x + sx * (b.r + 2), b.y)
          const sideY = this.solidAtPx(b.x, b.y + sy * (b.r + 2))
          if (sideX || !sideY) b.vx = -b.vx
          if (sideY || (!sideX && !sideY)) b.vy = -b.vy
          b.x += b.vx * dt * 2
          b.y += b.vy * dt * 2
          this.particles.burst(b.x, b.y, '#cdd4e0', 3, 40, 0.2)
        } else {
          b.life = 0
          if (b.friendly && !b.blast) this.particles.burst(b.x, b.y, '#d9b44a', 3, 40, 0.25)
          continue
        }
      }

      if (b.friendly) {
        const lowFlight = b.z === undefined || b.z < 6
        for (const e of this.enemies) {
          if (e.spawnT > 0 || b.hit.has(e.id) || b.life <= 0) continue
          if (lowFlight && dist(b.x, b.y, e.x, e.y) < b.r + e.r) {
            if (b.blast) {
              // 爆炸类：命中即灭，伤害统一交给爆炸
              b.life = 0
              break
            }
            const crit = this.rng.next() < this.weapon.crit
            const dmg = b.dmg * (crit ? 2 : 1)
            e.hp -= dmg
            e.flash = 0.12
            b.hit.add(e.id)
            this.sfx.play('hit')
            this.addFloat(e.x, e.y - e.r - 2, (crit ? '暴击 ' : '') + fmtNum(dmg), crit ? '#ff5b4d' : '#f5f5f7', crit ? 9 : 7)
            if (crit) {
              this.particles.burst(b.x, b.y, '#ffffff', 8, 90, 0.35)
              this.shake = Math.max(this.shake, REDUCED_MOTION ? 0 : 0.25)
              this.hitStop(0.06, 0.2)
            } else {
              this.particles.burst(b.x, b.y, b.trailC ?? ERA_PALETTES[this.levelIdx]!.tint, 4, 60, 0.3)
            }
            if (e.hp <= 0) this.enemyDie(e)
            if (b.pierce > 0) b.pierce -= 1
            else b.life = 0
            break
          }
        }
        // 打 BOSS（每颗弹对 BOSS 只结算一次——近战穿透弹帧帧命中会一刀秒）
        const boss = this.boss
        if (boss && !boss.dead && boss.spawnT <= 0 && b.life > 0 && lowFlight && !b.bossHit) {
          if (dist(b.x, b.y, boss.x, boss.y) < b.r + boss.r) {
            const crit = this.rng.next() < this.weapon.crit
            const dmg = b.dmg * (crit ? 2 : 1)
            b.bossHit = true
            this.sfx.play('hit')
            if (crit) this.particles.burst(b.x, b.y, '#ffffff', 8, 90, 0.35)
            if (!b.blast) this.damageBoss(dmg, crit)
            if (b.pierce > 0 && !b.blast) b.pierce -= 1
            else b.life = 0
          }
        }
        // 近战消弹：斩击 / 环绕刀劈碎触碰到的敌方弹丸（自爆弹被劈碎不爆炸）
        if (b.melee) {
          for (const eb of this.bullets) {
            if (eb.friendly || eb.life <= 0) continue
            if (eb.z !== undefined && eb.z > 6) continue
            if (dist(b.x, b.y, eb.x, eb.y) < b.r + eb.r + 2) {
              eb.blastE = undefined
              eb.life = 0
              this.particles.burst(eb.x, eb.y, '#f5f5f7', 3, 46, 0.22)
            }
          }
        }
      } else if (p.iframe <= 0 && dist(b.x, b.y, p.x, p.y) < b.r + p.r - 1) {
        b.life = 0
        this.hurtPlayer(b.vx / 130, b.vy / 130)
      }
    }
    // 玩家爆炸弹消亡时统一爆一次（命中 / 撞墙 / 落地 / 到时）
    for (const b of this.bullets) {
      if (b.life <= 0 && b.friendly && b.blast) this.explode(b.x, b.y, b.blast, b.dmg)
      // 敌方自爆弹（过载飞轮）：消亡时对玩家方爆炸
      if (b.life <= 0 && !b.friendly && b.blastE) this.blastEnemy(b.x, b.y, b.blastE, 2)
    }
    this.bullets = this.bullets.filter((b) => b.life > 0)
  }

  private nearestTarget(x: number, y: number): Vec | null {
    let best: Vec | null = null
    let bd = Infinity
    for (const e of this.enemies) {
      if (e.spawnT > 0) continue
      const d = dist(x, y, e.x, e.y)
      if (d < bd) { bd = d; best = e }
    }
    const b = this.boss
    if (b && !b.dead && b.spawnT <= 0) {
      const d = dist(x, y, b.x, b.y)
      if (d < bd) { bd = d; best = b }
    }
    return best
  }

  private updatePickups(dt: number): void {
    const p = this.player
    for (const it of this.pickups) it.t += dt
    this.pickups = this.pickups.filter((it) => {
      const d = dist(it.x, it.y, p.x, p.y)
      // 能量珠：靠近吸附
      if (it.type === 'orb' && d < 52 && d > 0.5) {
        const s = 110 * dt * (1 + (52 - d) / 52)
        it.x += ((p.x - it.x) / d) * s
        it.y += ((p.y - it.y) / d) * s
      }
      if (d < 11) {
        if (it.type === 'heart') {
          if (p.hp >= p.maxHp) return it.t < 12 // 满血不吃，留在地上
          p.hp = Math.min(p.maxHp, p.hp + 1)
          this.sfx.play('heart')
          this.particles.burst(it.x, it.y, '#e0453a', 8, 60, 0.4)
        } else {
          p.energy = Math.min(this.weapon.energyMax, p.energy + 16)
          this.sfx.play('coin')
          this.particles.burst(it.x, it.y, '#43d0ff', 8, 70, 0.4)
          this.addFloat(p.x, p.y - 12, '+16', '#43d0ff', 7)
        }
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

  /** React 答题弹层关闭时回调：correct = 答对则强化武器并回血 1 点、回满能量。 */
  answerChest(correct: boolean): void {
    if (correct) {
      this.applyUpgrade()
      if (this.player.hp < this.player.maxHp) this.player.hp += 1
      this.player.energy = this.weapon.energyMax
      this.sfx.play('heart')
    }
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
        this.weapon.pierce = Math.min(4, this.weapon.pierce + 1)
        break
      case 'speed':
        this.weapon.speedMul = Math.min(1.8, this.weapon.speedMul * 1.15)
        break
      case 'crit':
        this.weapon.crit = Math.min(0.5, this.weapon.crit + 0.08)
        break
      case 'emax':
        this.weapon.energyMax += 25
        this.player.energy = Math.min(this.weapon.energyMax, this.player.energy + 25)
        break
      case 'eregen':
        this.weapon.regenMul = Math.min(2.2, this.weapon.regenMul * 1.18)
        break
    }
    this.weapon.upgrades++
    this.sfx.play('upgrade')
    this.banner = { text: `武器强化！${UPGRADE_LABEL[kind]}`, t: 1.4 }
    this.ringBurst(this.player.x, this.player.y, '#ffd23f', 14, 20)
  }

  /** 触摸端「开箱」按钮调用。 */
  requestInteract(): void {
    this.tryInteract()
  }

  /** 武器架换武器：强化数值保留，只换形态（冷却清零，立即可射）。 */
  switchWeapon(id: string): void {
    const def = WEAPONS[id]
    if (!def || id === this.weapon.weaponId) return
    this.weapon.weaponId = id
    this.player.energy = this.weapon.energyMax
    this.player.fireCd = 0
    this.burstLeft = 0
    this.orbitOn = false
    this.sfx.play('upgrade')
    this.ringBurst(this.player.x, this.player.y, def.trail, 16, 26)
  }

  /** 过关后进入下一关（保留武器，上限+1 并回满）。 */
  nextLevel(): void {
    this.player.maxHp = Math.min(8, this.player.maxHp + 1)
    this.player.hp = this.player.maxHp
    this.player.energy = this.weapon.energyMax
    this.player.iframe = 1
    this.loadLevel(Math.min(6, this.levelIdx + 1))
    this.paused = false
    this.lastT = performance.now()
  }

  /** 死亡重试本关：保留武器，血量能量回满，房间重置。 */
  retryLevel(): void {
    this.player.hp = this.player.maxHp
    this.player.energy = this.weapon.energyMax
    this.player.iframe = 1
    this.loadLevel(this.levelIdx)
    this.paused = false
    this.lastT = performance.now()
  }

  /** 均匀环形粒子（强化/换武器的金环）。 */
  private ringBurst(x: number, y: number, color: string, n: number, speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      this.particles.list.push({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 0.5,
        max: 0.5,
        color,
        size: 2,
        gravity: 0,
      })
    }
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
    if (d.kind === 'final') return this.clearedCombat.size < 4
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
    this.drawScorches()
    this.drawMotes()
    this.drawDoors(room)
    this.drawHazards()
    if (room.portal) this.drawPortal(room.portal)
    if (room.chest) this.drawChest(room.chest)
    this.drawPickups()
    for (const e of this.enemies) this.drawEnemy(e)
    if (this.boss) this.drawBoss(this.boss)
    this.drawPlayer()
    this.drawOrbit()
    this.drawBullets()
    this.particles.draw(ctx)
    this.drawBoomRings()
    this.drawFloats()
    ctx.restore()

    // 全屏特效：BOSS 死亡白闪 / 受击红晕 / 低血量脉动
    if (this.whiteFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.85, this.whiteFlash * 1.8)})`
      ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    }
    const hurtA = this.hurtFlash / 0.35
    const lowHp = this.player.hp > 0 && this.player.hp <= 2
    if (hurtA > 0 || lowHp) {
      const a = hurtA * 0.38 + (lowHp ? 0.1 + Math.sin(this.time * 5) * 0.07 : 0)
      const grad = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.35, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.75)
      grad.addColorStop(0, 'rgba(224,69,58,0)')
      grad.addColorStop(1, `rgba(224,69,58,${a})`)
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    }

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

  /** 地面焦痕：三片偏移暗斑，末段渐隐。 */
  private drawScorches(): void {
    const ctx = this.ctx
    for (const s of this.scorches) {
      const a = 0.42 * Math.min(1, s.life / 1.5)
      ctx.fillStyle = `rgba(18,14,10,${a})`
      ctx.beginPath()
      ctx.ellipse(s.x, s.y, s.r * 0.9, s.r * 0.65, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = `rgba(10,8,6,${a * 0.8})`
      ctx.beginPath()
      ctx.ellipse(s.x - s.r * 0.25, s.y + s.r * 0.12, s.r * 0.4, s.r * 0.28, 0.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.ellipse(s.x + s.r * 0.3, s.y - s.r * 0.14, s.r * 0.3, s.r * 0.22, -0.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  /** 预警圈：脉动描边 + 随倒计时充能的红面。 */
  private drawHazards(): void {
    const ctx = this.ctx
    for (const h of this.hazards) {
      const prog = clamp(1 - h.t / h.t0, 0, 1)
      const pulse = 0.45 + Math.abs(Math.sin(this.time * 10)) * 0.35
      ctx.strokeStyle = `rgba(224, 69, 58, ${pulse})`
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(h.x, h.y, h.r * (0.92 - prog * 0.12), 0, Math.PI * 2)
      ctx.stroke()
      if (prog > 0.15) {
        ctx.fillStyle = `rgba(224, 69, 58, ${0.1 + prog * 0.16})`
        ctx.beginPath()
        ctx.arc(h.x, h.y, h.r * 0.85, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.lineWidth = 1
    }
  }

  /** 爆炸冲击环：金色描边圆快速扩散。 */
  private drawBoomRings(): void {
    const ctx = this.ctx
    for (const r of this.boomRings) {
      if (r.t < 0) continue // 负延迟（BOSS 死亡第二环）
      const k = r.t / 0.35
      ctx.globalAlpha = 1 - k
      ctx.strokeStyle = '#ffd23f'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(r.x, r.y, 3 + r.max * k, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.lineWidth = 1
    }
  }

  /** 环境浮尘：缓慢漂浮的微光点。 */
  private drawMotes(): void {
    const ctx = this.ctx
    ctx.globalAlpha = 0.22 + Math.sin(this.time * 2) * 0.06
    ctx.fillStyle = '#e8e4d8'
    for (const m of this.motes) ctx.fillRect(Math.round(m.x), Math.round(m.y), 1, 1)
    ctx.globalAlpha = 1
  }

  private drawPickups(): void {
    const ctx = this.ctx
    for (const it of this.pickups) {
      const bob = Math.sin(it.t * 5) * 1.5
      const spr = spriteCanvas(it.type === 'orb' ? 'orb' : 'heart', this.levelIdx)
      // 能量珠微光
      if (it.type === 'orb') {
        ctx.fillStyle = `rgba(67, 208, 255, ${0.18 + Math.sin(it.t * 6) * 0.08})`
        ctx.fillRect(Math.round(it.x - 6), Math.round(it.y - 6 + bob), 12, 12)
      }
      ctx.drawImage(spr, Math.round(it.x - spr.width / 2), Math.round(it.y - spr.height / 2 + bob))
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
    const frame = Math.floor(e.anim * (e.arch === 'bomb' && e.state === 1 ? 13 : 6)) % 2
    let name = `${e.arch}${frame}`
    if (e.arch === 'roll') name = 'roll'
    const white = e.flash > 0
    const spr = white ? spriteWhite(name, this.levelIdx) : spriteCanvas(name, this.levelIdx)
    // 影子
    ctx.fillStyle = 'rgba(0,0,0,0.22)'
    ctx.beginPath()
    ctx.ellipse(e.x, e.y + e.r * 1.5 - 1, e.r * 1.5, e.r * 0.6, 0, 0, Math.PI * 2)
    ctx.fill()

    const scale =
      (e.elite ? 1.9 : 1.5) *
      (e.arch === 'bomb' && e.state === 1 ? 1 + Math.sin(this.time * 20) * 0.08 : 1)
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
      ctx.fillRect(e.x - w / 2, e.y - e.r - 4, (w * Math.max(0, e.hp)) / e.maxHp, 2)
    }
  }

  private drawBoss(b: Boss): void {
    const ctx = this.ctx
    const def = BOSSES[b.id]!
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

    // 铸神激光：预警线 / 喷射光束
    if (b.id === 'zhushen' && b.pattern === 3 && !b.dead) {
      if (b.step === 0) {
        const a = 0.3 + Math.sin(this.time * 20) * 0.2
        ctx.strokeStyle = `rgba(224, 69, 58, ${a})`
        ctx.setLineDash([6, 4])
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(b.x, b.y)
        ctx.lineTo(b.x + b.aimX * 340, b.y + b.aimY * 340)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.lineWidth = 1
      } else {
        const grad = ctx.createLinearGradient(b.x, b.y, b.x + b.aimX * 340, b.y + b.aimY * 340)
        grad.addColorStop(0, '#ffd23f')
        grad.addColorStop(1, 'rgba(255,120,40,0.1)')
        ctx.strokeStyle = grad
        ctx.lineWidth = 7
        ctx.beginPath()
        ctx.moveTo(b.x, b.y)
        ctx.lineTo(b.x + b.aimX * 340, b.y + b.aimY * 340)
        ctx.stroke()
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.moveTo(b.x, b.y)
        ctx.lineTo(b.x + b.aimX * 340, b.y + b.aimY * 340)
        ctx.stroke()
        ctx.lineWidth = 1
      }
    }

    // 粗激光：纸魔·幽魂凝视（紫） / 钱王·帝瞳金光（金）
    const thick =
      b.id === 'zhimo' && b.pattern === 4
        ? { w: 12, core: 5, col: '#a78bfa', sweep: 0.5, spd: 2.4 }
        : b.id === 'qianwang' && b.pattern === 7
          ? { w: 14, core: 6, col: '#ffd23f', sweep: 0.8, spd: 1.5 }
          : null
    if (thick && !b.dead) {
      const a =
        b.step === 0 ? Math.atan2(b.aimY, b.aimX) : b.angle + Math.sin(this.time * thick.spd) * thick.sweep
      const ex = b.x + Math.cos(a) * 360
      const ey = b.y + Math.sin(a) * 360
      if (b.step === 0) {
        // 宽预警虚线
        ctx.strokeStyle = `rgba(224, 69, 58, ${0.3 + Math.sin(this.time * 20) * 0.2})`
        ctx.setLineDash([8, 5])
        ctx.lineWidth = thick.w
        ctx.beginPath()
        ctx.moveTo(b.x, b.y)
        ctx.lineTo(ex, ey)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.lineWidth = 1
      } else {
        const grad = ctx.createLinearGradient(b.x, b.y, ex, ey)
        grad.addColorStop(0, thick.col)
        grad.addColorStop(1, 'rgba(255,255,255,0.08)')
        ctx.strokeStyle = grad
        ctx.lineWidth = thick.w
        ctx.beginPath()
        ctx.moveTo(b.x, b.y)
        ctx.lineTo(ex, ey)
        ctx.stroke()
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = thick.core
        ctx.beginPath()
        ctx.moveTo(b.x, b.y)
        ctx.lineTo(ex, ey)
        ctx.stroke()
        ctx.lineWidth = 1
      }
    }

    const spr = b.flash > 0 ? spriteWhite(def.sprite, this.levelIdx) : spriteCanvas(def.sprite, this.levelIdx)
    const scale = b.dead ? Math.max(0, 1 - b.deadT / 1.2) : 1 + (b.phase >= 2 ? Math.sin(this.time * 10) * 0.02 : 0)
    ctx.save()
    ctx.translate(Math.round(b.x), Math.round(b.y))
    ctx.scale(scale * 2.1, scale * 2.1)
    if (b.dead) ctx.rotate(b.deadT * 1.5)
    ctx.drawImage(spr, -spr.width / 2, -spr.height / 2)
    ctx.restore()
    if (!b.dead) {
      const w = 160
      const x = (VIEW_W - w) / 2
      ctx.fillStyle = '#1b1c24'
      ctx.fillRect(x - 1, 8, w + 2, 6)
      ctx.fillStyle = b.phase === 3 ? '#ff7840' : b.phase === 2 ? '#e0453a' : '#ffd23f'
      ctx.fillRect(x, 9, (w * Math.max(0, b.hp)) / b.maxHp, 4)
      ctx.fillStyle = '#f5f5f7'
      ctx.font = 'bold 8px "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(def.name, VIEW_W / 2, 7)
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
    ctx.ellipse(p.x, p.y + 9, 9, 3.5, 0, 0, Math.PI * 2)
    ctx.fill()
    // 手臂/武器
    const def = this.weaponDef()
    const gun = def.pattern === 'orbit' || def.pattern === 'slash' || def.pattern === 'slam' ? '#e8e2ff' : def.gun
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(p.aim)
    ctx.fillStyle = '#1f4fb8'
    ctx.fillRect(3, -2, 9, 4)
    ctx.fillStyle = gun
    ctx.fillRect(11, -2, 4, 4)
    ctx.restore()
    ctx.save()
    ctx.translate(Math.round(p.x), Math.round(p.y))
    if (p.faceLeft) ctx.scale(-1.5, 1.5)
    else ctx.scale(1.5, 1.5)
    ctx.drawImage(spr, -spr.width / 2, -spr.height / 2)
    ctx.restore()
  }

  /** 环绕钱刀（视觉跟随玩家旋转）。 */
  private drawOrbit(): void {
    if (!this.orbitOn) return
    const ctx = this.ctx
    const p = this.player
    const spr = spriteCanvas('orbitBlade', this.levelIdx)
    for (let k = 0; k < 4; k++) {
      const a = this.orbitAngle + (k / 4) * Math.PI * 2
      const orbR = k % 2 === 0 ? 33 : 21
      const x = p.x + Math.cos(a) * orbR
      const y = p.y + Math.sin(a) * orbR
      ctx.save()
      ctx.translate(Math.round(x), Math.round(y))
      ctx.rotate(this.orbitAngle * 3 + k * 2)
      ctx.drawImage(spr, -spr.width / 2, -spr.height / 2)
      ctx.restore()
      if (!REDUCED_MOTION && Math.random() < 0.25) this.particles.trail(x, y, 'rgba(224,220,255,0.5)')
    }
  }

  private drawBullets(): void {
    const ctx = this.ctx
    for (const b of this.bullets) {
      if (b.hidden) continue
      const name = b.sprite ?? (b.friendly ? 'proj' : 'ebullet')
      const spr = spriteCanvas(name, this.levelIdx)
      const dy = b.z ? -b.z : 0
      // 抛射阴影
      if (b.z !== undefined && b.z > 2) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)'
        ctx.beginPath()
        ctx.ellipse(b.x, b.y, 3, 1.5, 0, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.save()
      ctx.translate(Math.round(b.x), Math.round(b.y + dy))
      ctx.rotate(b.spin)
      if (b.sprite === 'slash') {
        // 斩击弧光随判定体放大
        ctx.drawImage(spr, -spr.width * 0.675, -spr.height * 0.675, spr.width * 1.35, spr.height * 1.35)
      } else {
        ctx.drawImage(spr, -spr.width / 2, -spr.height / 2)
      }
      ctx.restore()
      if (b.friendly && !REDUCED_MOTION && Math.random() < 0.3) {
        this.particles.trail(b.x, b.y + dy, b.trailC ?? 'rgba(255,210,63,0.5)')
      }
    }
  }

  private drawFloats(): void {
    if (this.floats.length === 0) return
    const ctx = this.ctx
    ctx.textAlign = 'center'
    for (const f of this.floats) {
      ctx.globalAlpha = Math.max(0, 1 - f.t / 0.75)
      ctx.font = `bold ${f.size}px "PingFang SC", "Microsoft YaHei", sans-serif`
      ctx.fillStyle = '#1b1c24'
      ctx.fillText(f.text, Math.round(f.x) + 1, Math.round(f.y) + 1)
      ctx.fillStyle = f.color
      ctx.fillText(f.text, Math.round(f.x), Math.round(f.y))
    }
    ctx.globalAlpha = 1
    ctx.textAlign = 'left'
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
      const y = HUD_Y + 3
      if (i < p.hp) ctx.drawImage(heart, x, y)
      else {
        ctx.globalAlpha = 0.25
        ctx.drawImage(heart, x, y)
        ctx.globalAlpha = 1
      }
    }

    // 能量条（血量下方）
    const def = this.weaponDef()
    const ew = 64
    const ex = 6
    const ey = HUD_Y + 11
    const ratio = clamp(p.energy / this.weapon.energyMax, 0, 1)
    const blink = Math.floor(this.time * 10) % 2 === 0
    const low = this.energyFlash > 0 && blink
    ctx.fillStyle = '#1b1c24'
    ctx.fillRect(ex - 1, ey - 1, ew + 2, 4)
    ctx.fillStyle = low ? '#e0453a' : ratio >= 0.999 ? '#ffd23f' : '#43d0ff'
    ctx.fillRect(ex, ey, Math.round(ew * ratio), 2)
    if (ratio >= 0.999 && !low) {
      // 满能量：条顶亮光线
      ctx.fillStyle = '#aef1ff'
      ctx.fillRect(ex, ey - 1, Math.round(ew), 1)
    }
    if (low) {
      ctx.fillStyle = '#e0453a'
      ctx.font = 'bold 6px "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.fillText('能量不足', ex + ew + 4, ey + 3)
    } else {
      // 微型能量珠标记
      ctx.fillStyle = '#43d0ff'
      ctx.fillRect(ex + ew + 3, ey, 2, 2)
    }

    // 关名 + 当前武器
    ctx.fillStyle = '#f5f5f7'
    ctx.font = 'bold 8px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.textAlign = 'center'
    const lv = LEVELS[this.levelIdx]!
    const wname = def.name
    ctx.fillText(`第${this.levelIdx + 1}关 ${lv.era} · ${wname} 强化×${this.weapon.upgrades}`, VIEW_W / 2, HUD_Y + 9)

    // 小地图（右上）：大厅居中 + 四门房 + 底部关底
    const mm = { x: VIEW_W - 34, y: 4 }
    const cell = 7
    const sideState = (side: 'L' | 'R' | 'T' | 'R2'): string => {
      const key = this.sideRoom[side]
      const r = this.rooms[key]
      if (this.current?.key === key) return 'cur'
      if (r?.cleared) return 'ok'
      return 'un'
    }
    const pos: [number, number, string][] = [
      [1, 0, sideState('T')],
      [0, 1, sideState('L')],
      [2, 1, sideState('R')],
      [2, 2, sideState('R2')],
      [1, 1, this.current?.key === 'hub' ? 'cur' : 'hub'],
      [1, 2, this.current?.key === 'final' || this.current?.key === 'boss' ? 'cur' : this.clearedCombat.size >= 4 ? 'ok' : 'lock'],
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
