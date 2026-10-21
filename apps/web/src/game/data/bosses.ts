/**
 * BOSS 图鉴：每 2 关一位守关者（第 2/4/6 关关底）+ 第 7 关终极钱王。
 * 形态与技能贴合朝代铸币史；具体弹幕行为在 game.ts 按 id 分支实现。
 */

export type BossId = 'zhushen' | 'shengshou' | 'zhimo' | 'qianwang'

export interface BossDef {
  id: BossId
  /** HUD 血条上的名字 */
  name: string
  hp: number
  r: number
  sprite: string
  /** 出场横幅 */
  banner: string
  /** 半血进二阶段横幅 */
  rageBanner: string
  /** 二阶段额外召唤的原型 */
  summonArch: 'blob' | 'fly' | 'tank'
}

export const BOSSES: Record<BossId, BossDef> = {
  zhushen: {
    id: 'zhushen',
    name: '五铢母范·铸神',
    hp: 92,
    r: 18,
    sprite: 'bossMold',
    banner: '五铢母范·铸神',
    rageBanner: '铸神开炉——铜液横流！',
    summonArch: 'blob',
  },
  shengshou: {
    id: 'shengshou',
    name: '飞轮圣手·开元',
    hp: 132,
    r: 18,
    sprite: 'bossWheel',
    banner: '飞轮圣手·开元',
    rageBanner: '圣手双轮——钱轮不熄！',
    summonArch: 'fly',
  },
  zhimo: {
    id: 'zhimo',
    name: '宝钞幽魂·纸魔',
    hp: 172,
    r: 19,
    sprite: 'bossPaper',
    banner: '宝钞幽魂·纸魔',
    rageBanner: '纸魔临世——宝钞漫天！',
    summonArch: 'fly',
  },
  qianwang: {
    id: 'qianwang',
    name: '铁面钱王·咸丰当百',
    hp: 76,
    r: 20,
    sprite: 'boss',
    banner: '铁面钱王 · 咸丰当百',
    rageBanner: '钱王暴怒——虚值大钱漫天飞舞！',
    summonArch: 'blob',
  },
}

/** 关卡 idx → 关底 BOSS（未列出的关卡关底为传送门）。 */
export const LEVEL_BOSS: Record<number, BossId> = {
  1: 'zhushen', // 第 2 关 · 秦汉
  3: 'shengshou', // 第 4 关 · 隋唐
  5: 'zhimo', // 第 6 关 · 元明
  6: 'qianwang', // 第 7 关 · 清（终极）
}
