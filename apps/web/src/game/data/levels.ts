/**
 * 关卡配置：7 关时代全景（先秦→清·BOSS）。
 * 房间用 30×16 的 ASCII 模板定义，TILE=16px → 战斗区 480×256，底部 14px 给 HUD。
 * 字符：# 墙  . 地  D 门  C 宝箱锚点  P 出生锚点  X 传送门锚点  B BOSS 锚点
 * 战斗房的障碍岩块由 game.ts 按种子随机盖印（避开门/宝箱/出生区）。
 */

export const TILE = 16
export const ROOM_TW = 30
export const ROOM_TH = 16

export type Arch = 'blob' | 'throw' | 'fly' | 'dash' | 'roll' | 'tank' | 'bomb'

export interface WaveEntry {
  arch: Arch
  count: number
  elite?: boolean
}
export type Wave = WaveEntry[]

export interface LevelConfig {
  /** 0 起 */
  idx: number
  era: string
  sub: string
  years: string
  /** 该关弹丸名（进入该关即进化） */
  projName: string
  /** 开场小故事（逐行显示） */
  story: string[]
  waves: Wave[][]
}

/* ------------------------------------------------------------ 房间模板 */

export const TEMPLATES: Record<string, string[]> = {
  /** 中央大厅：左右上三门通往战斗房，下门通往关底（清完三房才开） */
  hub: [
    '###############T##############',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    'D.............P..............D',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#...........................D',
    '###############F##############',
  ],
  /** 战斗房（门在右墙——由大厅左门进入） */
  combatR: [
    '##############################',
    '#.......o............o.......#',
    '#..............C.............#',
    '#.......o............o.......#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................D',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '##############################',
  ],
  /** 战斗房（门在左墙——由大厅右门进入） */
  combatL: [
    '##############################',
    '#.......o............o.......#',
    '#..............C.............#',
    '#.......o............o.......#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    'D............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '##############################',
  ],
  /** 战斗房（门在下墙——由大厅上门进入） */
  combatB: [
    '##############################',
    '#.......o............o.......#',
    '#..............C.............#',
    '#.......o............o.......#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '###############D##############',
  ],
  /** 关底传送门房（门在上墙） */
  finalT: [
    '###############D##############',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#..............X.............#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '##############################',
  ],
  /** BOSS 房（门在上墙，四根柱） */
  bossT: [
    '###############D##############',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#.......o..........o.........#',
    '#............................#',
    '#..............B.............#',
    '#............................#',
    '#............................#',
    '#.......o..........o.........#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '##############################',
  ],
}

/* ------------------------------------------------------------ 7 关定义 */

export const LEVELS: LevelConfig[] = [
  {
    idx: 0,
    era: '先秦',
    sub: '贝布刀圜，货币之始',
    years: '商 — 前221',
    projName: '海贝弹',
    story: [
      '一枚海贝坠入泉眼，秘境的大门为你敞开。',
      '刀币布币散落在回廊深处，贝仔与铲币怪守着它们。',
      '搜集钱影，磨利弹丸——更深处的铸范已隐隐作响。',
    ],
    waves: [
      [
        [{ arch: 'blob', count: 2 }],
        [{ arch: 'blob', count: 1 }, { arch: 'throw', count: 1 }],
      ],
      [
        [{ arch: 'blob', count: 2 }, { arch: 'throw', count: 1 }],
        [{ arch: 'dash', count: 1 }, { arch: 'blob', count: 1 }],
      ],
      [
        [{ arch: 'blob', count: 2 }, { arch: 'throw', count: 2 }],
        [{ arch: 'dash', count: 2 }, { arch: 'throw', count: 1 }, { arch: 'blob', count: 2 }],
      ],
      [
        [{ arch: 'blob', count: 2 }],
        [{ arch: 'dash', count: 1 }, { arch: 'throw', count: 1 }],
      ],
    ],
  },
  {
    idx: 1,
    era: '秦汉',
    sub: '半两五铢，方孔定型',
    years: '前221 — 220',
    projName: '半两弹',
    story: [
      '秦始皇一统币制，半两钱定下方孔千年的模样。',
      '秘境深处的铸范自行开合，贝仔从铜液里涌出。',
      '击败五铢母范·铸神，才能拿到通往六朝的钥匙。',
    ],
    waves: [
      [
        [{ arch: 'fly', count: 3 }],
        [{ arch: 'blob', count: 2 }, { arch: 'throw', count: 1 }],
      ],
      [
        [{ arch: 'fly', count: 2 }, { arch: 'throw', count: 2 }],
        [{ arch: 'dash', count: 2 }, { arch: 'fly', count: 2 }],
      ],
      [
        [{ arch: 'blob', count: 3 }, { arch: 'throw', count: 2 }],
        [{ arch: 'dash', count: 2 }, { arch: 'fly', count: 3 }, { arch: 'throw', count: 2 }],
      ],
      [
        [{ arch: 'fly', count: 3 }, { arch: 'throw', count: 1 }],
        [{ arch: 'dash', count: 2 }, { arch: 'blob', count: 2 }],
      ],
    ],
  },
  {
    idx: 2,
    era: '魏晋南北朝',
    sub: '六朝纷钱，年号初现',
    years: '220 — 589',
    projName: '五铢弹',
    story: [
      '乱世钱轻，六朝的年号钱在风里打转。',
      '钱库里滚着点了引信的爆竹钱妖——离它们远一点。',
      '收好这一路的五铢，隋唐的钟声就在前方。',
    ],
    waves: [
      [
        [{ arch: 'blob', count: 2 }, { arch: 'roll', count: 1 }],
        [{ arch: 'throw', count: 2 }, { arch: 'fly', count: 2 }],
      ],
      [
        [{ arch: 'roll', count: 2 }, { arch: 'throw', count: 2 }],
        [{ arch: 'dash', count: 2 }, { arch: 'roll', count: 1 }, { arch: 'fly', count: 2 }, { arch: 'bomb', count: 1 }],
      ],
      [
        [{ arch: 'roll', count: 2 }, { arch: 'dash', count: 2 }, { arch: 'throw', count: 2 }],
        [{ arch: 'blob', count: 3 }, { arch: 'fly', count: 3 }, { arch: 'roll', count: 2 }, { arch: 'throw', count: 1 }, { arch: 'bomb', count: 1 }],
        [{ arch: 'roll', count: 1 }, { arch: 'throw', count: 2 }, { arch: 'fly', count: 2 }],
      ],
      [
        [{ arch: 'roll', count: 2 }, { arch: 'dash', count: 1 }],
        [{ arch: 'tank', count: 1 }, { arch: 'fly', count: 3 }],
      ],
    ],
  },
  {
    idx: 3,
    era: '隋唐五代',
    sub: '开元通宝，宝文纪元',
    years: '581 — 979',
    projName: '开元弹',
    story: [
      '开元通宝开了宝文纪元，长安西市的灯昼夜不熄。',
      '飞轮圣手在钱市中央抛掷轮钱，出手便是八轮齐飞。',
      '接住他的轮子，或从轮缝里活下来。',
    ],
    waves: [
      [
        [{ arch: 'tank', count: 1 }, { arch: 'throw', count: 2 }],
        [{ arch: 'blob', count: 2 }, { arch: 'fly', count: 3 }],
      ],
      [
        [{ arch: 'tank', count: 1 }, { arch: 'dash', count: 2 }],
        [{ arch: 'throw', count: 3 }, { arch: 'roll', count: 1 }, { arch: 'tank', count: 1 }, { arch: 'bomb', count: 1 }],
      ],
      [
        [{ arch: 'tank', count: 2 }, { arch: 'roll', count: 2 }],
        [{ arch: 'dash', count: 3 }, { arch: 'fly', count: 4 }, { arch: 'throw', count: 2 }, { arch: 'tank', count: 1 }, { arch: 'bomb', count: 1 }],
        [{ arch: 'dash', count: 2 }, { arch: 'fly', count: 2 }],
      ],
      [
        [{ arch: 'tank', count: 2 }, { arch: 'roll', count: 1 }],
        [{ arch: 'dash', count: 3 }, { arch: 'fly', count: 3 }, { arch: 'throw', count: 2 }, { arch: 'bomb', count: 1 }],
        [{ arch: 'tank', count: 1 }, { arch: 'roll', count: 2 }, { arch: 'throw', count: 2 }],
      ],
    ],
  },
  {
    idx: 4,
    era: '两宋',
    sub: '御书年号，对钱之美',
    years: '960 — 1279',
    projName: '年号钱弹',
    story: [
      '御书钱文铁画银钩，对钱在掌心映出两宋的月亮。',
      '铁钱重得压手，宝钞轻得像一句谎话。',
      '穿过钱监与钞局，元明的纸影已在招手。',
    ],
    waves: [
      [
        [{ arch: 'fly', count: 4 }, { arch: 'throw', count: 2 }, { arch: 'bomb', count: 1 }],
        [{ arch: 'roll', count: 2 }, { arch: 'blob', count: 2 }],
      ],
      [
        [{ arch: 'tank', count: 1 }, { arch: 'dash', count: 2 }, { arch: 'throw', count: 2 }],
        [{ arch: 'fly', count: 4 }, { arch: 'roll', count: 2 }, { arch: 'tank', count: 1 }, { arch: 'bomb', count: 2 }],
      ],
      [
        [{ arch: 'tank', count: 2 }, { arch: 'dash', count: 3 }, { arch: 'throw', count: 3 }],
        [{ arch: 'fly', count: 4 }, { arch: 'roll', count: 3 }, { arch: 'dash', count: 2 }, { arch: 'tank', count: 1 }, { arch: 'throw', count: 2 }],
        [{ arch: 'tank', count: 1 }, { arch: 'roll', count: 2 }, { arch: 'bomb', count: 1 }],
      ],
      [
        [{ arch: 'tank', count: 2 }, { arch: 'dash', count: 2 }, { arch: 'throw', count: 2 }],
        [{ arch: 'fly', count: 5 }, { arch: 'roll', count: 3 }, { arch: 'tank', count: 1 }, { arch: 'bomb', count: 2 }],
        [{ arch: 'dash', count: 3 }, { arch: 'throw', count: 3 }, { arch: 'fly', count: 4 }],
      ],
    ],
  },
  {
    idx: 5,
    era: '元明',
    sub: '宝钞通宝，纸铜相争',
    years: '1206 — 1644',
    projName: '宝钞飞刃',
    story: [
      '一张宝钞换千文铜钱，纸与铜的战争烧进了秘境。',
      '宝钞幽魂·纸魔把整座钱库折成了他的纸境。',
      '撕开纸雨与幻影，最后一扇门通向大钱时代。',
    ],
    waves: [
      [
        [{ arch: 'throw', count: 3 }, { arch: 'fly', count: 4 }],
        [{ arch: 'roll', count: 2 }, { arch: 'tank', count: 1, elite: true }, { arch: 'dash', count: 2 }, { arch: 'bomb', count: 1 }],
      ],
      [
        [{ arch: 'tank', count: 2 }, { arch: 'dash', count: 2, elite: true }, { arch: 'throw', count: 2 }],
        [{ arch: 'fly', count: 5 }, { arch: 'roll', count: 2 }, { arch: 'throw', count: 3 }, { arch: 'bomb', count: 2 }],
      ],
      [
        [{ arch: 'tank', count: 2 }, { arch: 'roll', count: 3 }, { arch: 'dash', count: 2 }],
        [{ arch: 'fly', count: 4 }, { arch: 'throw', count: 4 }, { arch: 'dash', count: 3 }, { arch: 'tank', count: 1 }, { arch: 'bomb', count: 2 }],
        [{ arch: 'fly', count: 3 }, { arch: 'dash', count: 2 }],
      ],
      [
        [{ arch: 'tank', count: 2 }, { arch: 'roll', count: 3 }, { arch: 'throw', count: 3 }],
        [{ arch: 'dash', count: 4 }, { arch: 'fly', count: 4 }, { arch: 'tank', count: 1 }, { arch: 'bomb', count: 2 }],
        [{ arch: 'roll', count: 3 }, { arch: 'throw', count: 3 }, { arch: 'dash', count: 3, elite: true }],
      ],
    ],
  },
  {
    idx: 6,
    era: '清',
    sub: '大钱时代，铁面钱王',
    years: '1636 — 1912',
    projName: '咸丰大钱弹',
    story: [
      '咸丰当百，一枚大钱压弯了挑夫的扁担。',
      '铁面钱王坐在钱山之巅，当百大钱是他的甲胄。',
      '这是秘境的最后一战——把钱王的财库轰开。',
    ],
    waves: [
      [
        [{ arch: 'roll', count: 3 }, { arch: 'throw', count: 3 }],
        [{ arch: 'fly', count: 4 }, { arch: 'dash', count: 3 }, { arch: 'bomb', count: 1 }],
      ],
      [
        [{ arch: 'tank', count: 2 }, { arch: 'roll', count: 2 }, { arch: 'throw', count: 3 }],
        [{ arch: 'dash', count: 4 }, { arch: 'fly', count: 4 }, { arch: 'tank', count: 1 }, { arch: 'bomb', count: 2 }],
      ],
      [
        [{ arch: 'tank', count: 2 }, { arch: 'roll', count: 3 }, { arch: 'dash', count: 3 }, { arch: 'throw', count: 2 }, { arch: 'bomb', count: 2 }],
        [{ arch: 'fly', count: 5 }, { arch: 'dash', count: 4, elite: true }, { arch: 'throw', count: 3 }, { arch: 'tank', count: 2 }],
        [{ arch: 'tank', count: 1 }, { arch: 'roll', count: 2 }, { arch: 'throw', count: 2 }, { arch: 'bomb', count: 1 }],
      ],
      [
        [{ arch: 'tank', count: 2 }, { arch: 'roll', count: 3 }, { arch: 'dash', count: 3 }, { arch: 'throw', count: 2 }],
        [{ arch: 'fly', count: 5 }, { arch: 'dash', count: 4, elite: true }, { arch: 'throw', count: 3 }, { arch: 'tank', count: 2 }, { arch: 'bomb', count: 2 }],
        [{ arch: 'dash', count: 4 }, { arch: 'fly', count: 5 }, { arch: 'tank', count: 2 }, { arch: 'roll', count: 3 }, { arch: 'bomb', count: 2 }],
      ],
    ],
  },
]

/** 宝箱答对时的强化种类（applyUpgrade 按此分支）。 */
export type UpgradeKind = 'rate' | 'dmg' | 'proj' | 'pierce' | 'speed' | 'crit' | 'emax' | 'eregen'

/** 28 次宝箱答题全对时的武器强化顺序（7 关 × 4 箱）：前期保射速/伤害爽感，中后期混入新维度。 */
export const UPGRADE_CYCLE: UpgradeKind[] = [
  'rate', 'dmg', 'rate', 'dmg', 'proj', 'crit', 'rate',
  'dmg', 'pierce', 'eregen', 'rate', 'proj', 'emax', 'speed',
  'dmg', 'rate', 'crit', 'dmg', 'proj', 'pierce', 'rate',
  'dmg', 'emax', 'speed', 'crit', 'dmg', 'rate', 'eregen',
]

export const UPGRADE_LABEL: Record<UpgradeKind, string> = {
  rate: '射速提升',
  dmg: '伤害提升',
  proj: '弹数 +1',
  pierce: '穿透 +1',
  speed: '弹速提升',
  crit: '暴击率 +8%',
  emax: '能量上限 +25',
  eregen: '能量回复 +18%',
}
