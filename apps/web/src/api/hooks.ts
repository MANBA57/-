/** react-query 数据钩子。 */

import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { CoinQuery } from './types'

/** 静态内容：站点生命周期内基本不变，缓存久一点 */
const STATIC = { staleTime: 30 * 60 * 1000 }

export function useStats() {
  return useQuery({ queryKey: ['stats'], queryFn: api.stats, ...STATIC })
}

export function useFacets() {
  return useQuery({ queryKey: ['facets'], queryFn: api.facets, ...STATIC })
}

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: api.categories, ...STATIC })
}

export function useTimeline() {
  return useQuery({ queryKey: ['timeline'], queryFn: api.timeline, ...STATIC })
}

export function useEvolution() {
  return useQuery({ queryKey: ['evolution'], queryFn: api.evolution, ...STATIC })
}

export function useTerms(q?: string) {
  return useQuery({
    queryKey: ['terms', q ?? ''],
    queryFn: () => api.terms(q),
    ...STATIC,
  })
}

export function useCoins(query: CoinQuery) {
  return useQuery({
    queryKey: ['coins', query],
    queryFn: ({ signal }) => api.coins(query, signal),
    placeholderData: (prev) => prev, // 翻页/改筛选时不闪白
  })
}

export function useCoin(slug: string) {
  return useQuery({
    queryKey: ['coin', slug],
    queryFn: () => api.coin(slug),
    enabled: Boolean(slug),
    ...STATIC,
  })
}

export function useCompare(slugs: string[]) {
  return useQuery({
    queryKey: ['compare', slugs],
    queryFn: () => api.compare(slugs),
    enabled: slugs.length > 0, // 术语页的相关钱币卡片只有一条也要取
    ...STATIC,
  })
}

export function useSearch(q: string, type: 'all' | 'coin' | 'term' = 'all', limit = 20) {
  const trimmed = q.trim()
  return useQuery({
    queryKey: ['search', trimmed, type, limit],
    queryFn: ({ signal }) => api.search(trimmed, type, limit, signal),
    enabled: trimmed.length > 0,
    ...STATIC,
  })
}
