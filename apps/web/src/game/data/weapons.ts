/**
 * 武器图鉴：13 把武器横跨近战 / 远程 / 爆炸三类，名字与形态贴合朝代钱币史。
 * 数值强化（射速/伤害/弹数/穿透…）挂在玩家身上，换武器不丢强化；
 * pattern 决定 game.ts 开火逻辑分支，其余字段都是该分支的参数。
 */

export type WeaponPattern =
  | 'single' // 单发连射（泉弩）
  | 'fan' // 扇形散射
  | 'lance' // 快速穿透重弹
  | 'burst' // 三连发点射
  | 'homing' // 追踪弹
  | 'boomerang' // 回旋镖（往返双段伤害）
  | 'lob' // 抛射落地爆炸
  | 'cannon' // 直射爆炸弹
  | 'slash' // 近战扇形瞬斩
  | 'orbit' // 钱刀绕体旋转（按住持续）
  | 'slam' // 原地震荡波

export type WeaponClass = '近战' | '远程' | '爆炸'

export interface WeaponDef {
  id: string
  name: string
  cls: WeaponClass
  /** 武器架卡片上的一句话 */
  desc: string
  pattern: WeaponPattern
  /** 每次开火能量（orbit 为每秒消耗） */
  cost: number
  /** 实际间隔 = weapon.interval × intervalMul */
  intervalMul: number
  /** 实际单发伤害 = weapon.dmg × dmgMul */
  dmgMul: number
  /** 弹速（像素/秒） */
  speed?: number
  /** fan 的相邻弹夹角（rad） */
  spread?: number
  /** 该武器内建穿透（叠加在强化穿透上） */
  pierce?: number
  /** 爆炸半径（lob/cannon/slam） */
  blast?: number
  /** 弹碰撞半径 */
  bulletR?: number
  /** 弹寿命（秒） */
  life?: number
  /** 专属弹丸 sprite 名（缺省用按朝代进化的 'proj'） */
  sprite?: string
  /** 拖尾粒子色 */
  trail: string
  /** 手持武器色（玩家手臂枪身） */
  gun: string
}

export const WEAPONS: Record<string, WeaponDef> = {
  rapid: {
    id: 'rapid',
    name: '泉弩',
    cls: '远程',
    desc: '随身连发弩机，射速与手感均衡，海贝为矢。',
    pattern: 'single',
    cost: 5,
    intervalMul: 1,
    dmgMul: 1,
    speed: 250,
    bulletR: 3.5,
    life: 1.6,
    trail: 'rgba(255,210,63,0.5)',
    gun: '#f4c542',
  },
  daobi: {
    id: 'daobi',
    name: '刀币斩月',
    cls: '近战',
    desc: '挥出齐刀弧光，斩得远、劈得快，还能击碎敌弹。',
    pattern: 'slash',
    cost: 6,
    intervalMul: 1.25,
    dmgMul: 2.4,
    trail: 'rgba(245,245,247,0.7)',
    gun: '#e8e2ff',
  },
  banliang: {
    id: 'banliang',
    name: '半两散华',
    cls: '远程',
    desc: '一次撒出五枚半两钱，近处泼洒成雨。',
    pattern: 'fan',
    cost: 13,
    intervalMul: 1.35,
    dmgMul: 0.62,
    speed: 230,
    spread: 0.34,
    bulletR: 3,
    life: 0.8,
    trail: 'rgba(126,207,169,0.55)',
    gun: '#7ecfa9',
  },
  wuzhu: {
    id: 'wuzhu',
    name: '五铢贯矢',
    cls: '远程',
    desc: '高速五铢重矢，天生穿二敌，一线贯穿。',
    pattern: 'lance',
    cost: 9,
    intervalMul: 1.5,
    dmgMul: 1.7,
    speed: 380,
    pierce: 2,
    bulletR: 4,
    life: 1,
    sprite: 'projBig',
    trail: 'rgba(255,236,150,0.6)',
    gun: '#ffe98f',
  },
  huanqian: {
    id: 'huanqian',
    name: '环钱旋舞',
    cls: '近战',
    desc: '四枚环钱刀高速绕旋，绞敌亦削弹雨。',
    pattern: 'orbit',
    cost: 20,
    intervalMul: 1,
    dmgMul: 0.85,
    trail: 'rgba(224,220,255,0.6)',
    gun: '#ab86cd',
  },
  zhouzhou: {
    id: 'zhouzhou',
    name: '咒铢追踪',
    cls: '远程',
    desc: '被诅咒的五铢会咬人——自动追咬最近的敌人。',
    pattern: 'homing',
    cost: 8,
    intervalMul: 1.15,
    dmgMul: 0.95,
    speed: 210,
    bulletR: 3.5,
    life: 1.8,
    sprite: 'projEye',
    trail: 'rgba(191,120,220,0.55)',
    gun: '#bf78dc',
  },
  baolei: {
    id: 'baolei',
    name: '六铢爆雷',
    cls: '爆炸',
    desc: '抛出一枚灌铅铢钱，落地炸开一片铜雨。',
    pattern: 'lob',
    cost: 15,
    intervalMul: 1.7,
    dmgMul: 2.2,
    speed: 170,
    blast: 30,
    bulletR: 4,
    life: 0.62,
    sprite: 'projBomb',
    trail: 'rgba(255,150,80,0.55)',
    gun: '#ff9650',
  },
  lianzhu: {
    id: 'lianzhu',
    name: '开元连珠',
    cls: '远程',
    desc: '开元通宝三连珠，点射节奏紧凑，火力绵密。',
    pattern: 'burst',
    cost: 11,
    intervalMul: 2.6,
    dmgMul: 0.78,
    speed: 260,
    bulletR: 3.5,
    life: 1.4,
    trail: 'rgba(255,190,120,0.55)',
    gun: '#de8465',
  },
  chongning: {
    id: 'chongning',
    name: '崇宁重贯',
    cls: '远程',
    desc: '御书大钱重若千钧，慢而极利，天生穿三敌。',
    pattern: 'lance',
    cost: 14,
    intervalMul: 1.9,
    dmgMul: 2.3,
    speed: 340,
    pierce: 3,
    bulletR: 5.5,
    life: 1.2,
    sprite: 'projBig',
    trail: 'rgba(232,241,248,0.6)',
    gun: '#e8f1f8',
  },
  baochao: {
    id: 'baochao',
    name: '宝钞飞刃',
    cls: '远程',
    desc: '大明宝钞掷出又飞回，去回两程都伤敌。',
    pattern: 'boomerang',
    cost: 12,
    intervalMul: 1.6,
    dmgMul: 0.9,
    speed: 300,
    pierce: 99, // 往返都要能穿过敌群
    bulletR: 4,
    life: 1.5,
    sprite: 'projNote',
    trail: 'rgba(200,210,255,0.5)',
    gun: '#8d94b8',
  },
  hongwu: {
    id: 'hongwu',
    name: '洪武火铳',
    cls: '爆炸',
    desc: '洪武年间的火器，弹丸触敌即炸，轰轰烈烈。',
    pattern: 'cannon',
    cost: 16,
    intervalMul: 1.8,
    dmgMul: 1.8,
    speed: 300,
    blast: 26,
    bulletR: 4,
    life: 1.2,
    sprite: 'projBomb',
    trail: 'rgba(255,120,60,0.6)',
    gun: '#ff7840',
  },
  tiechui: {
    id: 'tiechui',
    name: '铁钱重锤',
    cls: '近战',
    desc: '砸地震荡大范围波及，击退敌群并震碎弹雨。',
    pattern: 'slam',
    cost: 15,
    intervalMul: 1.8,
    dmgMul: 2.4,
    blast: 52,
    trail: 'rgba(205,212,224,0.6)',
    gun: '#cdd4e0',
  },
  xianfeng: {
    id: 'xianfeng',
    name: '咸丰当百炮',
    cls: '爆炸',
    desc: '虚值大钱的终极致敬——当百巨弹，炸裂成海。',
    pattern: 'cannon',
    cost: 22,
    intervalMul: 2.4,
    dmgMul: 3,
    speed: 260,
    blast: 40,
    bulletR: 6,
    life: 1.3,
    sprite: 'projBig',
    trail: 'rgba(255,215,106,0.65)',
    gun: '#ffd76a',
  },
}

/** 武器架档口：过关进入下一关（idx）时给出的三把新武器。 */
export const WEAPON_OFFERS: Record<number, string[]> = {
  1: ['daobi', 'banliang', 'wuzhu'], // 进第 2 关 · 秦汉
  2: ['huanqian', 'zhouzhou', 'baolei'], // 进第 3 关 · 魏晋
  3: ['lianzhu', 'zhouzhou', 'tiechui'], // 进第 4 关 · 隋唐
  4: ['chongning', 'baochao', 'baolei'], // 进第 5 关 · 两宋
  5: ['hongwu', 'baochao', 'tiechui'], // 进第 6 关 · 元明
  6: ['xianfeng', 'chongning', 'hongwu'], // 进第 7 关 · 清
}
