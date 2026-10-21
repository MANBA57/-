/**
 * 全部像素美术：精灵用字符画定义，启动时渲染到离屏 canvas。
 * 敌人六原型用 l/m/M 三级明暗吃朝代调色板（tintLight/tint/tintDark），实现每关自动换肤；
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
  /** 敌人受光亮色（三级明暗的高光） */
  tintLight: string
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
    tintLight: '#9fc27d',
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
    tintLight: '#cbab63',
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
    tintLight: '#7cc0bd',
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
    tintLight: '#de8465',
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
    tintLight: '#74adcf',
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
    tintLight: '#ab86cd',
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
    tintLight: '#ecd077',
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
  E: '#cdd4e0', // 钢铁亮
  D: '#828b9c', // 钢铁暗
  u: '#96632f', // 木
  U: '#6b421d', // 木暗
}

/* ------------------------------------------------------------ 字符画 */

/** 玩家：戴斗笠的小泉侠（b/B 主角蓝，S 肤，Y 斗笠 + 腰带金扣）14×16 */
const PLAYER_0 = [
  '.....YYYY.....',
  '....YYYYYY....',
  '...YYyYYYYy...',
  '.YyYYYYYYYYyY.',
  '.yyYYYYYYYYyy.',
  '...SSSSSSSS...',
  '...SeSSSSeS...',
  '...SsSSSSsS...',
  '..bBBbbbbBBb..',
  '.SbBbbbbbbBbS.',
  '.SbbbbbbbbbbS.',
  '..bbbYYYYbbb..',
  '..bbbYyyYbbb..',
  '..bbbBbbBbbb..',
  '..bbb....bbb..',
  '..KKK....KKK..',
]

const PLAYER_1 = [
  '.....YYYY.....',
  '....YYYYYY....',
  '...YYyYYYYy...',
  '.YyYYYYYYYYyY.',
  '.yyYYYYYYYYyy.',
  '...SSSSSSSS...',
  '...SeSSSSeS...',
  '...SsSSSSsS...',
  '..bBBbbbbBBb..',
  '.SbBbbbbbbBbS.',
  '.SbbbbbbbbbbS.',
  '..bbbYYYYbbb..',
  '..bbbYyyYbbb..',
  '..bbbBbbBbbb..',
  '..bbbb..bbbb..',
  '...KKK..KKK...',
]

/** 近战追击原型：贝仔（圆滚滚的贝妖，l 受光 / m 主体 / M 背光，两帧挤压弹跳） */
const E_BLOB_0 = [
  '...KKKKKK...',
  '..KllmmmmK..',
  '.KllmmmmmMK.',
  '.KlmemmemMK.',
  '.KlmmmmmmMK.',
  '.KmmmmmmmMK.',
  '.KmmmKKmmMK.',
  '.KmMMMMMMMK.',
  '..KMMMMMMK..',
  '...KKKKKK...',
]

const E_BLOB_1 = [
  '............',
  '..KKKKKKKK..',
  '.KllmmmmmMK.',
  'KllmemmemmMK',
  'KlmmmmmmmmMK',
  'KmmmKKmmmmMK',
  'KmMMMMMMMMMK',
  '.KMMMMMMMMK.',
  '..KKKKKKKK..',
  '............',
]

/** 远程投掷原型：布币匪（兜帽里一双白眼，两帧蓄力/出手） */
const E_THROW_0 = [
  '...KKKKKK...',
  '..KmmmmmmK..',
  '.KmllmmmmmK.',
  '.KmeWKeWKmK.',
  '.KmmeeeemmK.',
  '...KmmmmK...',
  '.KKmmMMmmKK.',
  'KsmmMMMMmmsK',
  'KsmmMMMMmmsK',
  '.KmmMMMMmmK.',
  '.KmmMMMMmmK.',
  '..Kmm..mmK..',
  '..KKK..KKK..',
]

const E_THROW_1 = [
  '............',
  '...KKKKKK...',
  '..KmmmmmmK..',
  '.KmeWKeWKmK.',
  '.KmmeeeemmK.',
  '..KKmmmmKK..',
  '.KmmMMMMmmK.',
  '..smMMMMms..',
  '.KmmMMMMmmK.',
  '.KmmMMMMmmK.',
  '..Kmm..mmK..',
  '..KMM..MMK..',
  '..KKK..KKK..',
]

/** 冲锋原型：刀币客（竖直刀币成精，下端圆环，两帧前倾） */
const E_DASH_0 = [
  '....KKKK....',
  '...KllmmK...',
  '...KlmemK...',
  '..KllmmmK...',
  '..KllmmmMK..',
  '..KllmmmMK..',
  '.KllmmmMMK..',
  '.KlmmmMMMK..',
  '...KmmMK....',
  '....KmmK....',
  '...KKKKKK...',
  '..KKK..KKK..',
]

const E_DASH_1 = [
  '.....KKKK...',
  '....KllmmK..',
  '....KlmemK..',
  '...KllmmmK..',
  '...KllmmmMK.',
  '..KllmmmMK..',
  '..KllmmMMK..',
  '..KlmmMMMK..',
  '....KmmMK...',
  '....KmmK....',
  '...KKKKKK...',
  '..KKK..KKK..',
]

/** 蜂群飞行原型：五铢飞虫（方孔钱身 + 薄翅两帧扇动） */
const E_FLY_0 = [
  '.KKK....KKK.',
  'KWKlK..KlKWK',
  'KKKllKKllKKK',
  '.KKKmmmmKKK.',
  '...KmWemK...',
  '..KmmmmmmK..',
  '..KmMKKMmK..',
  '...KmmmmK...',
  '....KKKK....',
]

const E_FLY_1 = [
  '............',
  '.KKK....KKK.',
  'KWllKKKKllWK',
  'KKKmmmmmmKKK',
  '...KmWemK...',
  '..KmmmmmmK..',
  '..KmMKKMmK..',
  '...KmmmmK...',
  '....KKKK....',
]

/** 滚轮原型：开元飞轮（轮辐十字 + 金芯，代码里按角度旋转绘制） */
const E_ROLL = [
  '...KKKKKK...',
  '..KllmmmmK..',
  '.KllKKKKmMK.',
  '.KlK...KMmK.',
  'KllK.YY.KMmK',
  'KlmKYYYYKMmK',
  'KmmK.YY.KMmK',
  'KmmK....KMmK',
  '.KmmK..KMmK.',
  '.KmMKKKKMmK.',
  '..KmMMMMmK..',
  '...KKKKKK...',
]

/** 重装坦克原型：铁钱傀儡（覆盔铆甲，盔缝里金眼，两帧踏步） */
const E_TANK_0 = [
  '..KKKKKKKKKK..',
  '.KllmmmmmmmMK.',
  '.KlmKKKKKKmMK.',
  '.KlmKYKKYKmMK.',
  '.KKKKKKKKKKKK.',
  'KKmmMMMMMMmmKK',
  'KlmmMeMMeMmmMK',
  'KlmmMMMMMMmmMK',
  'KEmmMMMMMMmmEK',
  'KKmmmMMMMmmmKK',
  '.KMMMMMMMMMMK.',
  '.KMMK....KMMK.',
  '.KKKK....KKKK.',
]

const E_TANK_1 = [
  '..KKKKKKKKKK..',
  '.KllmmmmmmmMK.',
  '.KlmKKKKKKmMK.',
  '.KlmKYKKYKmMK.',
  '.KKKKKKKKKKKK.',
  'KKmmMMMMMMmmKK',
  'KlmmMeMMeMmmMK',
  'KlmmMMMMMMmmMK',
  'KEmmMMMMMMmmEK',
  'KKmmmMMMMmmmKK',
  '.KMMMMMMMMMMK.',
  '..KMMK..KMMK..',
  '..KKKK..KKKK..',
]

/** BOSS：铁面钱王·咸丰当百（26×26，双圈郭 + 方孔怒脸 + 当百金记） */
const BOSS = [
  '..........KKKKK...........',
  '.......KKKlllllKKK........',
  '......KlllllllllllK.......',
  '....KKllllKKKKKlllmKK.....',
  '...KKlllKKlllllKKmmmKK....',
  '...KlWKKlllmmmlllKKmmK....',
  '..KllKKllmmmmmmmmmKKmmK...',
  '.KlllKlmmmmmmmmmmmmKmmmK..',
  '.KllKllmmmmmmmmmmmmmKMMK..',
  '.KllKlmmmeeeeeeemmmmKMMK..',
  'KllKllmmmRRReRRRmmmmmKMMK.',
  'KllKlmYmmeReeeRemmYmmKMMK.',
  'KllKlmYmmeWeeeWemmYmmKMMK.',
  'KllKlmYmmWWeeeWWmmYmmKMMK.',
  'KllKllmmmeKKKKKemmmmmKMMK.',
  '.KllKlmmmeeeeeeemmmmKMMK..',
  '.KllKlmmmmmmmmmmmmmmKMMK..',
  '.KllmKmmmmmmmmmmmmmKMMMK..',
  '..KmmKKmmmmmmmmmmmKKMMK...',
  '...KmmKKmmmmmmmmmKKMMK....',
  '...KKmmmKKmmmmmKKMMMKK....',
  '....KKmmMMKKKKKMMMMKK.....',
  '......KmMMMMMMMMMMK.......',
  '.......KKKMMMMMKKK........',
  '..........KKKKK...........',
  '..........................',
]

/** 宝箱（关）：木身金带，锁孔暗红 */
const CHEST_C = [
  '....KKKKKKKK....',
  '..KKuuuuuuuuKK..',
  '.KuuUuuuuuuUuuK.',
  '.KYyyyyyyyyyyYK.',
  '.KuuuuKKKKuuuuK.',
  '.KuUuuKRRKuuUuK.',
  '.KuuuuKRrKuuuuK.',
  '.KuuuuKKKKuuuuK.',
  '.KUUUUUUUUUUUUK.',
  '.KKKKKKKKKKKKKK.',
  '.KKKKK....KKKKK.',
]

/** 宝箱（开）：内里金光已散，只余余晖 */
const CHEST_O = [
  '.....KKKKKK.....',
  '..KKuuuuuuuuKK..',
  '.KKKKKKKKKKKKKK.',
  '.KeWWWWWWWWWWeK.',
  '.KyuuuuuuuuuuyK.',
  '.KUUUUUUUUUUUUK.',
  '.KuuuuuuuuuuuuK.',
  '.KuUuuuuuuuuUuK.',
  '.KUUUUUUUUUUUUK.',
  '.KKKKKKKKKKKKKK.',
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

/** 弹丸：圆形方孔钱（l 受光 / m 主体 / M 背光） */
const PROJ_COIN = [
  '..KKKK..',
  '.KllmMK.',
  'KllmmMmK',
  'KlmKKmMK',
  'KmmKKmMK',
  'KmmmMMMK',
  '.KmMMMK.',
  '..KKKK..',
]

/** 弹丸：海贝（先秦关，白瓷底粉斑） */
const PROJ_SHELL = [
  '..KKKK..',
  '.KWWWWK.',
  'KWsWWsWK',
  'KWWWWWWK',
  'KWPWWPWK',
  'KWPPPPWK',
  '.KPPPPK.',
  '..KKKK..',
]

/** 弹丸：宝钞（元明关，小纸票朱印） */
const PROJ_NOTE = [
  'KKKKKKKK',
  'KnnnnnnK',
  'KnNNNNnK',
  'KnNRRNnK',
  'KnNRRNnK',
  'KnNNNNnK',
  'KnnnnnnK',
  'KKKKKKKK',
]

/** 敌方弹丸（5×5，白芯红焰） */
const EBULLET = [
  '.KKK.',
  'KWRWK',
  'KRrRK',
  'KRrrK',
  '.KKK.',
]

/** 铲币（投掷原型的手持物/投掷物，5×7 青铜） */
const SPADE = [
  '.KKK.',
  'KYlYK',
  'KYyYK',
  'KyyyK',
  'KyyyK',
  'KyyyK',
  '.KKK.',
]

/* ------------------------------------------------------------ 瓦片（16×16） */

/** 砖墙：丁砌错缝，砖顶受光 h、灰缝 d */
const WALL_16 = [
  'hhhhhhhdhhhhhhhd',
  'aaaaaaadaaaaaaad',
  'aaaaaaadaaaaaaad',
  'dddddddddddddddd',
  'hhhdhhhhhhhdhhhh',
  'aaadaaaaaadaaaaa',
  'aaadaaaaaadaaaaa',
  'dddddddddddddddd',
  'hhhhhhhdhhhhhhhd',
  'aaaaaaadaaaaaaad',
  'aaaaaaadaaaaaaad',
  'dddddddddddddddd',
  'hhhdhhhhhhhdhhhh',
  'aaadaaaaaadaaaaa',
  'aaadaaaaaadaaaaa',
  'dddddddddddddddd',
]

/** 地砖 A：右/下灰缝 + 零星斑点 */
const FLOOR_A = [
  'ffffffffffffffff',
  'ffffffdfffffffff',
  'ffffffffffffffff',
  'ffffffffffffffdf',
  'ffffffffffffffff',
  'fdffffffffffffff',
  'fffffffffdfffffd',
  'ffffffffffffffff',
  'ffffffffffffffff',
  'ffffffdfffffffff',
  'fffffffffffffffd',
  'fdfffffffffffffd',
  'ffffffffffffffff',
  'fffffffffdffffff',
  'ffffffffffffffff',
  'dddddddddddddddd',
]

/** 地砖 B：同砖格不同斑纹，夹一枚亮斑 */
const FLOOR_B = [
  'ffffffffffffffff',
  'ffffffffffffdfff',
  'ffffffdfffffffff',
  'ffffffffffffffff',
  'ffffdffffffffffd',
  'ffffffffffffffff',
  'ffffffffffffffdf',
  'dfffffffffffffff',
  'ffffffffffffffff',
  'ffffffffhffffffd',
  'ffffffdfffffffff',
  'ffffffffffffffff',
  'fdffffffffffffff',
  'ffffffffffffffdf',
  'ffffffffffffffff',
  'dddddddddddddddd',
]

/** 拱门：加厚门楣，楣心一枚金币纹 */
const DOOR_16 = [
  '....KKKKKKKK....',
  '..KKddddddddKK..',
  '.KddddddddddddK.',
  '.KddKKKKKKKKddK.',
  'KddKK.YYYY.KKddK',
  'KddK..yyyy..KddK',
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
    l: p.tintLight,
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
      cv = build(E_BLOB_0, pal)
      break
    case 'blob1':
      cv = build(E_BLOB_1, pal)
      break
    case 'throw0':
      cv = build(E_THROW_0, pal)
      break
    case 'throw1':
      cv = build(E_THROW_1, pal)
      break
    case 'dash0':
      cv = build(E_DASH_0, pal)
      break
    case 'dash1':
      cv = build(E_DASH_1, pal)
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
      cv = build(E_TANK_0, pal)
      break
    case 'tank1':
      cv = build(E_TANK_1, pal)
      break
    case 'boss':
      cv = build(BOSS, { ...pal, m: '#b08544', M: '#7a5a26', l: '#d9b778' })
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
