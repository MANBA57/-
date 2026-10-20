/**
 * 全部像素美术：精灵用字符画定义，启动时渲染到离屏 canvas。
 * 敌人六原型用 m/M 字符吃朝代调色板（tint/tintDark），实现每关自动换肤；
 * 弹丸随朝代进化（海贝→半两→…→大钱），同样走调色板。
 */

import { makeCanvas } from './engine'

/* ------------------------------------------------------------ 调色板 */

export interface EraPalette {
  /** 关卡视觉主题名 */
  name: string
  wall: string
  wallEdge: string
  floor: string
  floorAlt: string
  door: string
  /** 敌人主色 */
  tint: string
  tintDark: string
  accent: string
  /** 战斗房外底色（收边用） */
  bg: string
}

export const ERA_PALETTES: EraPalette[] = [
  {
    name: '先秦',
    wall: '#7a6a52',
    wallEdge: '#4e4232',
    floor: '#b3a07c',
    floorAlt: '#a8946f',
    door: '#8a7452',
    tint: '#6e8f5a',
    tintDark: '#42582f',
    accent: '#d9b44a',
    bg: '#2a2620',
  },
  {
    name: '秦汉',
    wall: '#55524b',
    wallEdge: '#33312c',
    floor: '#8f8a7d',
    floorAlt: '#857f72',
    door: '#6b6558',
    tint: '#9c7c3c',
    tintDark: '#6a5322',
    accent: '#c9a227',
    bg: '#1d1c19',
  },
  {
    name: '魏晋南北朝',
    wall: '#5f7a72',
    wallEdge: '#3c4f49',
    floor: '#9db8ad',
    floorAlt: '#93aea3',
    door: '#77948a',
    tint: '#4e8a8f',
    tintDark: '#2f5f64',
    accent: '#bfe3d2',
    bg: '#1c2624',
  },
  {
    name: '隋唐五代',
    wall: '#8a6f4e',
    wallEdge: '#5c4629',
    floor: '#c2a878',
    floorAlt: '#b89e6e',
    door: '#a3834f',
    tint: '#b0533a',
    tintDark: '#7e3524',
    accent: '#ffd23f',
    bg: '#282013',
  },
  {
    name: '两宋',
    wall: '#6d7b8c',
    wallEdge: '#47525f',
    floor: '#aeb9c4',
    floorAlt: '#a3aeb9',
    door: '#8494a5',
    tint: '#3f7aa3',
    tintDark: '#2a5a7d',
    accent: '#e8f1f8',
    bg: '#1a2028',
  },
  {
    name: '元明',
    wall: '#4f5a86',
    wallEdge: '#333b5c',
    floor: '#8d94b8',
    floorAlt: '#8389ac',
    door: '#67709c',
    tint: '#7a4f9e',
    tintDark: '#583479',
    accent: '#e8e2ff',
    bg: '#15182a',
  },
  {
    name: '清',
    wall: '#7e3b38',
    wallEdge: '#54211f',
    floor: '#ab8574',
    floorAlt: '#a07c6c',
    door: '#96504b',
    tint: '#caa53d',
    tintDark: '#8f7022',
    accent: '#ffd76a',
    bg: '#241210',
  },
]

/* 固定色（不随朝代变化） */
const FIXED: Record<string, string> = {
  K: '#1b1c24', // 描边墨
  W: '#ffffff',
  e: '#23242e', // 瞳 / 暗部
  S: '#f2c8a2', // 肤
  s: '#d19a6a', // 肤影
  Y: '#f4c542', // 金
  y: '#c8971e', // 金暗
  R: '#e0453a', // 红
  r: '#9c2a22', // 红暗
  G: '#9aa0ab', // 石
  g: '#5f646d', // 石暗
  P: '#f6d7c4', // 贝肉粉
  b: '#2f6fed', // 泉韵蓝（主角）
  B: '#1f4fb8',
  n: '#8d94b8', // 纸钞
  N: '#5c6288',
}

/* ------------------------------------------------------------ 字符画 */

/** 玩家：戴斗笠的小泉侠（b/B 主角蓝，S 肤，Y 斗笠） */
const PLAYER_0 = [
  '....YYYY....',
  '..YYYYYYYY..',
  '.YYyYYYYyYY.',
  '.YYYYYYYYYY.',
  '..SSSSSSSS..',
  '..SeSSSSeS..',
  '..SSSssSSS..',
  '.bBBbbbbBBb.',
  'bBbbbbbbbbBb',
  'SbbbbbbbbbbS',
  '.bbbByYBbbb.',
  '.bbb....bbb.',
  '.KKK....KKK.',
]

const PLAYER_1 = [
  '....YYYY....',
  '..YYYYYYYY..',
  '.YYyYYYYyYY.',
  '.YYYYYYYYYY.',
  '..SSSSSSSS..',
  '..SeSSSSeS..',
  '..SSSssSSS..',
  '.bBBbbbbBBb.',
  'bBbbbbbbbbBb',
  'SbbbbbbbbbbS',
  '.bbbByYBbbb.',
  '..bbb..bbb..',
  '..KKK..KKK..',
]

/** 近战追击原型：贝仔（圆滚滚的贝妖，m/M 吃朝代色） */
const E_BLOB = [
  '...KKKKKK...',
  '..KmmmmmmK..',
  '.KmmmmmmmmK.',
  '.KmWemmWemK.',
  '.KmmmmmmmmK.',
  '.KmMmmmmMmK.',
  '.KmMMmmMMmK.',
  '..KmMMMMmK..',
  '...KKKKKK...',
]

/** 远程投掷原型：布币匪（小人，投掷物是铲币，代码里单独画） */
const E_THROW_0 = [
  '....KKKK....',
  '...KmmmmK...',
  '...KmemeK...',
  '...KmmmmK...',
  '....KmmK....',
  '..KKmmmmKK..',
  '.KmmmMMmmmK.',
  '.KmmMMMMmmK.',
  '..KsmMMmsK..',
  '..KmmmmmmK..',
  '..Kmm..mmK..',
  '..KMM..MMK..',
]
const E_THROW_1 = [
  '....KKKK....',
  '...KmmmmK...',
  '...KmemeK...',
  '...KmmmmK...',
  '....KmmK....',
  '..KKmmmmKK..',
  '.KmmmMMmmmK.',
  '.KmmMMMMmmK.',
  '.KsmmMMmsK..',
  '..KmmmmmmK..',
  '..Kmm..mmK..',
  '..KMM..MMK..',
]

/** 冲锋原型：刀币客（楔形刀头，冲锋时整枚飞出） */
const E_DASH = [
  '.....KK.....',
  '....KmmK....',
  '...KmMMmK...',
  '..KmMWMMmK..',
  '..KmMMMMmK..',
  '.KmmMMMMmmK.',
  '.KmmMMMMmmK.',
  '.KmmMMMMmmK.',
  '..KmMMMMmK..',
  '..KKKKKKKK..',
]

/** 蜂群飞行原型：五铢飞虫（翅膀两帧扇动，10×8） */
const E_FLY_0 = [
  'KK......KK',
  'WWK....KWW',
  '.KWKKKKWK.',
  '..KmmmmK..',
  '.KmemmemK.',
  '.KmmmmmmK.',
  '..KMmmMK..',
  '...KKKK...',
]
const E_FLY_1 = [
  '..........',
  '.KK....KK.',
  'WWWKKKKWWW',
  'W.KmmmmK.W',
  '..KmemmeK.',
  '.KmmmmmmK.',
  '..KMmmMK..',
  '...KKKK...',
]

/** 滚轮原型：开元飞轮（厚币轮，代码里按角度旋转绘制） */
const E_ROLL = [
  '...KKKKKK...',
  '..KmmmmmmK..',
  '.KmmKKKKmmK.',
  '.KmMK..KMmK.',
  'KmMK....KMmK',
  'KmMK....KMmK',
  'KmMK....KMmK',
  'KmMK....KMmK',
  '.KmMK..KMmK.',
  '.KmmKKKKmmK.',
  '..KmmmmmmK..',
  '...KKKKKK...',
]

/** 重装坦克原型：铁钱傀儡（方脑袋 + 厚身板） */
const E_TANK = [
  '..KKKKKKKK..',
  '.KmmmmmmmmK.',
  '.KmWemmWemK.',
  '.KmmmmmmmmK.',
  '.KKKKKKKKKK.',
  'KKmmMMMMmmKK',
  'KmmMMMMMMmmK',
  'KmmMeMMeMmmK',
  'KmmMMMMMMmmK',
  'KKmmmMMmmmKK',
  '.KMMMMMMMMK.',
  '.KKK....KKK.',
]

/** BOSS：铁面钱王·咸丰当百（24×24，方孔里一张怒脸） */
const BOSS = [
  '.........KKKKKK.........',
  '.......KMMMMMMMMK.......',
  '......KMMmmmmmmMMK......',
  '.....KMMmmmmmmmmMMK.....',
  '....KMMmmmmmmmmmmMMK....',
  '...KMMmmmmmmmmmmmmMMK...',
  '...KMmmmmmmmmmmmmmmMK...',
  '..KMmmmmmmmmmmmmmmmmMK..',
  '..KMmmmmKKKKKKKKmmmmMK..',
  '..KMmmmmKRRKKRRKmmmmMK..',
  '..KMmmmmKRRKKRRKmmmmMK..',
  '..KMmmmmKKKKKKKKmmmmMK..',
  '..KMmmmmKKKRRKKKmmmmMK..',
  '..KMmmmmKKRRRRKKmmmmMK..',
  '..KMmmmmKKKRRKKKmmmmMK..',
  '..KMmmmmKKKKKKKKmmmmMK..',
  '..KMmmmmmmmmmmmmmmmmMK..',
  '..KMmmmmmmmmmmmmmmmmMK..',
  '..KMmmmmmmmmmmmmmmmmMK..',
  '...KMmmmmmmmmmmmmmmMK...',
  '...KMMmmmmmmmmmmmmMMK...',
  '....KMMmmmmmmmmmmMMK....',
  '.....KMMmmmmmmmmMMK.....',
  '.......KMMMMMMMMK.......',
]

/** 宝箱（关） */
const CHEST_C = [
  '....KKKKKKKK....',
  '..KKYYYYYYYYKK..',
  '.KYyyyyyyyyyyYK.',
  '.KYyYYYYYYYYyYK.',
  '.KKKKKKKKKKKKKK.',
  '.KYyYYYKKYYYyYK.',
  '.KYyYYyKKyYYyYK.',
  '.KYyYYYyyYYYyYK.',
  '.KYyyyyyyyyyyYK.',
  '.KYyyyyyyyyyyYK.',
  '.KKKKK....KKKKK.',
]

/** 宝箱（开，内里已空） */
const CHEST_O = [
  '.KYyyyyyyyyyyYK.',
  '.KKKKKKKKKKKKKK.',
  '.KeeeeeeeeeeeeK.',
  '.KeeeeeeeeeeeeK.',
  '.KYyyyyyyyyyyYK.',
  '.KYyYYYYYYYYyYK.',
  '.KYyYYYYYYYYyYK.',
  '.KYyyyyyyyyyyYK.',
  '.KYyyyyyyyyyyYK.',
  '.KYyyyyyyyyyyYK.',
  '.KKKKK....KKKKK.',
]

/** 回复红心（8×7） */
const HEART = [
  '.KK..KK.',
  'KRRKKRRK',
  'KRWRRRRK',
  'KRRRRRRK',
  '.KRRRRK.',
  '..KRRK..',
  '...KK...',
]

/** 弹丸：圆形方孔钱（m/M 吃朝代色） */
const PROJ_COIN = [
  '..KKKK..',
  '.KmMMmK.',
  'KmMKKMmK',
  'KmKKKKmK',
  'KmKKKKmK',
  'KmMKKMmK',
  '.KmMMmK.',
  '..KKKK..',
]

/** 弹丸：海贝（先秦关） */
const PROJ_SHELL = [
  '..KKKK..',
  '.KWWWWK.',
  'KWPWWPWK',
  'KWWWWWWK',
  'KWWPPWWK',
  'KWPPPPWK',
  '.KPPPPK.',
  '..KKKK..',
]

/** 弹丸：宝钞（元明关，小纸票） */
const PROJ_NOTE = [
  'KKKKKKKK',
  'KnnnnnnK',
  'KnNWWNnK',
  'KnNWWNnK',
  'KnnnnnnK',
  'KnnNNnnK',
  'KnnnnnnK',
  'KKKKKKKK',
]

/** 敌方弹丸（5×5） */
const EBULLET = [
  '.KKK.',
  'KRRWK',
  'KRRRK',
  'KRRRK',
  '.KKK.',
]

/** 铲币（投掷原型的手持物/投掷物，5×7） */
const SPADE = [
  '.KKK.',
  'KYyYK',
  'KYyYK',
  'KYyYK',
  'KyyyK',
  'KyyyK',
  '.KKK.',
]

/* ------------------------------------------------------------ 瓦片（16×16） */

const WALL_16 = [
  'aaaaaaadaaaaaaad',
  'haaaaaadaaaaaaad',
  'aaaaaaadaaaaaaad',
  'aaaaaaadaaaaaaad',
  'dddddddddddddddd',
  'aaadaaaaaadaaaaa',
  'haadaaaaaadaaaaa',
  'aaadaaaaaadaaaaa',
  'aaaaaaadaaaaaaad',
  'haaaaaadaaaaaaad',
  'aaaaaaadaaaaaaad',
  'aaaaaaadaaaaaaad',
  'dddddddddddddddd',
  'aaadaaaaaadaaaaa',
  'haadaaaaaadaaaaa',
  'aaadaaaaaadaaaaa',
]

const FLOOR_A = [
  'ffffffffffffffff',
  'ffffffffffffffff',
  'ffffffffffffffff',
  'ffffffffdfffffff',
  'ffffffffffffffff',
  'ffffffdfffffffff',
  'ffffffffffffffff',
  'ffffffffffffffdf',
  'ffffffffffffffff',
  'ffffffffffffffff',
  'fdffffffffffffff',
  'ffffffffffffffff',
  'ffffffffffffffdf',
  'ffffffffffffffff',
  'ffffffdfffffffff',
  'ffffffffffffffff',
]

const FLOOR_B = [
  'ffffffffffffffff',
  'ffffffffffffffff',
  'fffffffffdffffff',
  'ffffffffffffffff',
  'ffffdfffffffffff',
  'ffffffffffffffff',
  'ffffffffffffffdf',
  'ffffffffffffffff',
  'ffffffffffffffff',
  'ffffffdfffffffff',
  'ffffffffffffffff',
  'ffffffffffdfffff',
  'ffffffffffffffff',
  'fdffffffffffffff',
  'ffffffffffffffff',
  'fffffffffffffffd',
]

const DOOR_16 = [
  '....KKKKKKKK....',
  '..KKddddddddKK..',
  '.KddddddddddddK.',
  '.KddKKKKKKKKddK.',
  'KddKK......KKddK',
  'KddK........KddK',
  'KddK........KddK',
  'KddK........KddK',
  'KddK........KddK',
  'KddK........KddK',
  'KddK........KddK',
  'KddK........KddK',
  'KddKK......KKddK',
  '.KddKKKKKKKKddK.',
  '..KKddddddddKK..',
  '....KKKKKKKK....',
]

const ROCK_0 = [
  '......KKKK......',
  '....KKGGGGKK....',
  '...KGWGGGGGGK...',
  '..KGGGGGGGGGGK..',
  '..KGGGGGgGGGGK..',
  '.KGGGGGGGGgGGGK.',
  '.KGgGGGGGGGgGGK.',
  '.KGgGGGGGGGGGGK.',
  '.KGgGGGGGGgGGGK.',
  '..KGgGGGGgGGGK..',
  '..KGGgGGGgGGGK..',
  '...KKGgGGgKKK...',
  '.....KKKKKK.....',
]

const ROCK_1 = [
  '     KKKKK      ',
  '   KKGGGGGKK    ',
  '  KGWGGGGGGGK   ',
  ' KGGGGGGGGGGGK  ',
  ' KGGGgGGGGGGGK  ',
  'KGGGGGGGgGGGGGK ',
  'KGgGGGGGGGgGGGK ',
  'KGgGGGGGGGGGGGK ',
  'KGgGGGGgGGGGGGK ',
  ' KGGgGGGgGGGGK  ',
  ' KGGGgGGgGGGGK  ',
  '  KKGgGGgKKKK   ',
  '    KKKKKK      ',
]

/* ------------------------------------------------------------ 构建 */

type PixelMap = readonly string[]

const cache = new Map<string, HTMLCanvasElement>()

function build(map: PixelMap, palette: Record<string, string>, scale = 1): HTMLCanvasElement {
  const w = Math.max(...map.map((r) => r.length))
  const h = map.length
  const cv = makeCanvas(w * scale, h * scale)
  const ctx = cv.getContext('2d')!
  for (let y = 0; y < h; y++) {
    const row = map[y]!
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!
      if (ch === '.' || ch === ' ') continue
      const color = palette[ch]
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(x * scale, y * scale, scale, scale)
    }
  }
  return cv
}

function whiten(src: HTMLCanvasElement): HTMLCanvasElement {
  const cv = makeCanvas(src.width, src.height)
  const ctx = cv.getContext('2d')!
  ctx.drawImage(src, 0, 0)
  ctx.globalCompositeOperation = 'source-atop'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, cv.width, cv.height)
  return cv
}

function eraPalette(p: EraPalette): Record<string, string> {
  return {
    ...FIXED,
    m: p.tint,
    M: p.tintDark,
    a: p.wall,
    d: p.wallEdge,
    // 砖块上的 'h' 借用地板亮色，做砖顶受光
    h: p.floor,
    f: p.floor,
  }
}

/**
 * 取精灵画布（带缓存）。白色受击闪烁版走 spriteWhite()。
 * eraIdx 影响吃调色板的精灵（敌人 / 弹丸 / 瓦片 / 门）。
 */
export function spriteCanvas(name: string, eraIdx: number): HTMLCanvasElement {
  const key = `${name}:${eraIdx}`
  const hit = cache.get(key)
  if (hit) return hit

  const p = ERA_PALETTES[eraIdx % ERA_PALETTES.length]!
  const pal = eraPalette(p)
  let cv: HTMLCanvasElement

  switch (name) {
    case 'player0':
      cv = build(PLAYER_0, pal)
      break
    case 'player1':
      cv = build(PLAYER_1, pal)
      break
    case 'blob0':
      cv = build(E_BLOB, pal)
      break
    case 'blob1':
      cv = build(E_BLOB, pal)
      break
    case 'throw0':
      cv = build(E_THROW_0, pal)
      break
    case 'throw1':
      cv = build(E_THROW_1, pal)
      break
    case 'dash0':
      cv = build(E_DASH, pal)
      break
    case 'dash1':
      cv = build(E_DASH, pal)
      break
    case 'fly0':
      cv = build(E_FLY_0, pal)
      break
    case 'fly1':
      cv = build(E_FLY_1, pal)
      break
    case 'roll':
      cv = build(E_ROLL, pal)
      break
    case 'tank0':
      cv = build(E_TANK, pal)
      break
    case 'tank1':
      cv = build(E_TANK, pal)
      break
    case 'boss':
      cv = build(BOSS, { ...pal, m: '#b08544', M: '#7a5a26' })
      break
    case 'chest-c':
      cv = build(CHEST_C, pal)
      break
    case 'chest-o':
      cv = build(CHEST_O, pal)
      break
    case 'heart':
      cv = build(HEART, pal)
      break
    case 'ebullet':
      cv = build(EBULLET, pal)
      break
    case 'spade':
      cv = build(SPADE, pal)
      break
    case 'rock0':
      cv = build(ROCK_0, pal)
      break
    case 'rock1':
      cv = build(ROCK_1, pal)
      break
    case 'wall':
      cv = build(WALL_16, pal)
      break
    case 'floorA':
      cv = build(FLOOR_A, pal)
      break
    case 'floorB':
      cv = build(FLOOR_B, pal)
      break
    case 'door':
      cv = build(DOOR_16, pal)
      break
    case 'proj':
      cv = eraIdx === 0 ? build(PROJ_SHELL, pal) : eraIdx === 5 ? build(PROJ_NOTE, pal) : build(PROJ_COIN, pal)
      break
    default:
      cv = build(PROJ_COIN, pal)
  }

  cache.set(key, cv)
  return cv
}

/** 白色受击闪烁版。 */
export function spriteWhite(name: string, eraIdx: number): HTMLCanvasElement {
  const key = `${name}:white:${eraIdx}`
  const hit = cache.get(key)
  if (hit) return hit
  const cv = whiten(spriteCanvas(name, eraIdx))
  cache.set(key, cv)
  return cv
}
