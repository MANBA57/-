/**
 * 后端接口封装。
 *
 * API_BASE 默认为空字符串 —— 走同源相对路径。生产环境由 Caddy 把 /api 反代到后端；
 * 本地用 tools/serve-dist.py 预览时，它也代理 /api 与 /images。
 * 只有打包安卓 APK（前端跑在 Capacitor 的 WebView 里，没有同源后端）时，
 * 才需要在构建时通过 VITE_API_BASE 注入线上地址。
 */

export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function buildQuery(params?: Record<string, unknown>): string {
  if (!params) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/** 把中文 slug 等安全地拼进路径，但保留 / 作为分隔符 */
export function encodePath(path: string): string {
  return path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

async function request<T>(path: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const url = `${API_BASE}${encodePath(path)}${buildQuery(params)}`
  let res: Response
  try {
    res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ApiError(0, '网络连接失败，请检查后端是否已启动')
  }

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
      else if (Array.isArray(body.detail)) {
        detail = body.detail
          .map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).join('.')}: ${d.msg}`)
          .join('；')
      }
    } catch {
      /* 响应不是 JSON，保留原始状态文本 */
    }
    throw new ApiError(res.status, detail)
  }

  return (await res.json()) as T
}

export const api = {
  health: () => request<import('./types').HealthOut>('/api/v1/health'),
  stats: () => request<import('./types').StatsOut>('/api/v1/stats'),
  facets: () => request<import('./types').FacetsOut>('/api/v1/facets'),
  categories: () => request<import('./types').CategoryOut[]>('/api/v1/categories'),
  timeline: () => request<import('./types').TimelineEntry[]>('/api/v1/timeline'),
  evolution: () => request<import('./types').EvolutionOut>('/api/v1/evolution'),
  coins: (q: import('./types').CoinQuery, signal?: AbortSignal) =>
    request<import('./types').CoinListOut>('/api/v1/coins', q as Record<string, unknown>, signal),
  coin: (slug: string) => request<import('./types').CoinDetail>(`/api/v1/coins/${slug}`),
  compare: (slugs: string[]) =>
    request<import('./types').CoinDetail[]>('/api/v1/coins/compare', { slugs: slugs.join(',') }),
  terms: (q?: string) => request<import('./types').TermOut[]>('/api/v1/terms', q ? { q } : undefined),
  search: (q: string, type: 'all' | 'coin' | 'term', limit: number, signal?: AbortSignal) =>
    request<import('./types').SearchOut>('/api/v1/search', { q, type, limit }, signal),
}
