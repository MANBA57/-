/**
 * 与后端 Pydantic 响应模型一一对应的 TypeScript 类型。
 * 改动后端 schemas.py 时这里必须同步。
 */

export interface Range {
  min: number
  max: number
}

export interface CategoryBrief {
  key: string
  name: string
}

export interface ImageOut {
  order: number
  role: string
  width: number | null
  height: number | null
  aspect_ratio: number | null
  lqip: string | null
  avif: string
  webp: string
  thumb_avif: string
  thumb_webp: string
}

/** auto = 原文明确；inferred = 由泛称或年份推断；editor = 人工补充 */
export type SourceKind = 'auto' | 'inferred' | 'editor'

export interface CoinBrief {
  slug: string
  name: string
  alias: string | null
  category: CategoryBrief
  period_key: string | null
  period_source: SourceKind | null
  states: string[]
  materials: string[]
  rarity: string | null
  image_count: number
  thumbnail: ImageOut | null
}

export interface CoinDetail extends CoinBrief {
  period: string | null
  year_mentioned: number | null
  description_md: string
  units: string[]
  diameter_mm: Range | null
  length_mm: Range | null
  weight_g: Range | null
  inscription_front: string | null
  inscription_back: string | null
  images: ImageOut[]
  related: CoinBrief[]
  overridden_fields: string[]
}

export interface CoinListOut {
  items: CoinBrief[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export interface FacetValue {
  value: string
  count: number
}

export interface FacetsOut {
  categories: FacetValue[]
  periods: FacetValue[]
  states: FacetValue[]
  materials: FacetValue[]
  units: FacetValue[]
}

export interface CategoryOut {
  key: string
  name: string
  intro_md: string | null
  intro_source: SourceKind | null
  coin_count: number
  images: ImageOut[]
}

export interface TimelineEntry {
  period_key: string
  period_label: string
  start_year: number | null
  end_year: number | null
  coins: CoinBrief[]
}

export interface EvolutionNode {
  label: string
  system_key: string
  is_coin: boolean
  slug: string | null
}

export interface EvolutionEdge {
  from_label: string
  to_label: string
  kind: string | null
  note: string | null
  system_key: string
}

export interface EvolutionOut {
  nodes: EvolutionNode[]
  edges: EvolutionEdge[]
}

export interface TermOut {
  name: string
  pinyin: string | null
  category: string | null
  definition_md: string
  source: string | null
  related_slugs: string[]
}

export interface SearchHit {
  type: 'coin' | 'term'
  slug: string | null
  name: string
  snippet: string
  category: string | null
}

export interface SearchOut {
  query: string
  match_expression: string
  total: number
  took_ms: number
  coins: SearchHit[]
  terms: SearchHit[]
}

export interface StatsOut {
  coin_count: number
  category_count: number
  image_count: number
  term_count: number
  evolution_edge_count: number
  period_span: string
  period_buckets: FacetValue[]
  image_bytes: number
  source_bytes: number
  compression_ratio: number | null
}

export interface HealthOut {
  status: string
  version: string
  database: { path: string; exists: boolean; coins?: number; images?: number; error?: string }
}

export interface CoinQuery {
  category?: string
  period?: string
  state?: string
  material?: string
  q?: string
  sort?: 'order' | 'period' | 'name' | 'weight'
  page?: number
  page_size?: number
}
