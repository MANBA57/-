import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCoins, useFacets } from '@/api/hooks'
import CoinCard from '@/components/CoinCard'
import FilterPanel, { type Filters } from '@/components/FilterPanel'
import { CardGridSkeleton, EmptyState, ErrorState } from '@/components/States'
import { COMPARE_MAX, compareStore, useCompareList } from '@/lib/compare'

const SORTS = [
  { value: 'order', label: '按录入顺序' },
  { value: 'period', label: '按年代' },
  { value: 'name', label: '按名称' },
  { value: 'weight', label: '按重量' },
] as const

type SortValue = (typeof SORTS)[number]['value']

/**
 * 钱币库。筛选状态全部同步到 URL —— 这样任何一条筛选结果都能直接分享，
 * 刷新也不会丢，是参考设计里「可复制链接」体验的基础。
 */
export default function Browse() {
  const [params, setParams] = useSearchParams()
  const facets = useFacets()
  const compareList = useCompareList()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const filters: Filters = useMemo(
    () => ({
      category: params.get('category') ?? undefined,
      period: params.get('period') ?? undefined,
      state: params.get('state') ?? undefined,
      material: params.get('material') ?? undefined,
    }),
    [params],
  )
  const q = params.get('q') ?? undefined
  const sort = (params.get('sort') as SortValue | null) ?? 'order'
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1)

  const query = { ...filters, q, sort, page, page_size: 12 }
  const coins = useCoins(query)

  function update(next: Record<string, string | undefined>) {
    const merged = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === '') merged.delete(k)
      else merged.set(k, v)
    }
    // 任何筛选变化都要回到第 1 页，否则会停在越界页码上
    if (!('page' in next)) merged.delete('page')
    setParams(merged, { replace: true })
  }

  const activeCount = Object.values(filters).filter(Boolean).length + (q ? 1 : 0)

  return (
    <div className="container-page pt-8 pb-section md:pt-12">
      {/* 标题 + 工具条 */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="marker">钱币库</p>
          <h1 className="mt-2 text-display">
            {q ? `“${q}” 的结果` : '全部钱币'}
          </h1>
          <p className="mt-2 text-small text-ink-muted">
            {coins.data ? `共 ${coins.data.total} 种` : '加载中…'}
            {activeCount > 0 ? ` · 已应用 ${activeCount} 个筛选` : ''}
          </p>
        </div>

        {/* 移动端控件换行到下一行，否则「筛选」按钮会被挤出屏幕 */}
        <div className="flex w-full items-center gap-3 md:w-auto">
          <label className="text-micro text-ink-muted" htmlFor="sort">
            排序
          </label>
          <select
            id="sort"
            value={sort}
            onChange={(e) => update({ sort: e.target.value })}
            className="min-w-0 flex-1 rounded-btn border border-hairline bg-surface px-3 py-2 text-small text-ink md:flex-none"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="btn btn-secondary shrink-0 !min-h-[44px] !px-4 text-small lg:hidden"
            onClick={() => setDrawerOpen(true)}
          >
            筛选{activeCount > 0 ? ` (${activeCount})` : ''}
          </button>
        </div>
      </div>

      <div className="mt-10 flex gap-12">
        {/* 桌面端侧栏 */}
        <aside className="hidden w-[240px] shrink-0 lg:block">
          {facets.data ? (
            <FilterPanel facets={facets.data} value={filters} onChange={(f) => update({ ...f, page: undefined })} />
          ) : null}
        </aside>

        {/* 结果区 */}
        <div className="min-w-0 flex-1">
          {coins.isError ? (
            <ErrorState
              title="钱币列表加载失败"
              detail={(coins.error as Error)?.message}
              onRetry={() => void coins.refetch()}
            />
          ) : coins.isPending ? (
            <CardGridSkeleton count={6} />
          ) : coins.data.items.length === 0 ? (
            <EmptyState
              title="没有符合条件的钱币"
              detail="试试减少筛选条件，或清除关键词。"
              action={
                <button type="button" className="btn btn-primary" onClick={() => setParams({}, { replace: true })}>
                  清除全部条件
                </button>
              }
            />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-card sm:grid-cols-2 xl:grid-cols-3">
                {coins.data.items.map((coin) => (
                  <CoinCard
                    key={coin.slug}
                    coin={coin}
                    inCompare={compareList.includes(coin.slug)}
                    compareFull={compareList.length >= COMPARE_MAX}
                    onToggleCompare={(slug) => compareStore.toggle(slug)}
                  />
                ))}
              </div>

              {coins.data.total_pages > 1 ? (
                <nav className="mt-12 flex items-center justify-center gap-2" aria-label="分页">
                  <button
                    type="button"
                    className="btn btn-secondary !min-h-[44px] !px-4 text-small"
                    disabled={page <= 1}
                    onClick={() => update({ page: String(page - 1) })}
                  >
                    上一页
                  </button>
                  <span className="px-3 text-small text-ink-muted tabular-nums">
                    {page} / {coins.data.total_pages}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary !min-h-[44px] !px-4 text-small"
                    disabled={page >= coins.data.total_pages}
                    onClick={() => update({ page: String(page + 1) })}
                  >
                    下一页
                  </button>
                </nav>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* 移动端筛选抽屉 */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-[90] lg:hidden">
          <button
            type="button"
            aria-label="关闭筛选"
            className="absolute inset-0 bg-black/30"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-card bg-surface p-6 pb-[max(24px,env(safe-area-inset-bottom))]">
            {facets.data ? (
              <FilterPanel facets={facets.data} value={filters} onChange={(f) => update({ ...f, page: undefined })} />
            ) : null}
            <button type="button" className="btn btn-primary mt-8 w-full" onClick={() => setDrawerOpen(false)}>
              查看 {coins.data?.total ?? 0} 种结果
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
