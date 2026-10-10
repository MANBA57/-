/** 数值与文案格式化。 */

import type { Range, SourceKind } from '@/api/types'

/** 12 → "12"，12.5 → "12.5"，去掉无意义的 .0 */
function num(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)))
}

/**
 * 区间格式化：
 *   18~19.5 mm → "18–19.5 毫米"
 *   100~100 mm → "100 毫米"（上下限相同就不写区间）
 */
export function formatRange(range: Range | null, unit: string): string | null {
  if (!range) return null
  if (range.min === range.max) return `${num(range.min)} ${unit}`
  return `${num(range.min)}–${num(range.max)} ${unit}`
}

export const formatMm = (r: Range | null) => formatRange(r, '毫米')
export const formatGram = (r: Range | null) => formatRange(r, '克')

/** 公元前年份：-336 → "公元前 336 年" */
export function formatYear(year: number | null): string | null {
  if (year === null) return null
  return year < 0 ? `公元前 ${Math.abs(year)} 年` : `公元 ${year} 年`
}

export const SOURCE_LABEL: Record<SourceKind, string> = {
  auto: '原文明确',
  inferred: '据原文推断',
  editor: '编辑补充',
}

export const SOURCE_HINT: Record<SourceKind, string> = {
  auto: '原文直接写明了该项信息',
  inferred: '原文只给了泛称或年份，由此推断，供参考',
  editor: '原文未提及，由编辑补充，需进一步核实',
}

/** 把 slug 里的序号剥掉，得到展示用的名称兜底 */
export function slugToName(slug: string): string {
  const m = slug.match(/^\d+-(.+)$/)
  return m ? m[1] : slug
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat('zh-CN').format(n)
}
