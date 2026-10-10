import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useSearch } from '@/api/hooks'
import { EmptyState, ErrorState, Skeleton } from '@/components/States'
import { renderSnippet } from '@/lib/richtext'

const TYPES = [
  { value: 'all', label: '全部' },
  { value: 'coin', label: '钱币' },
  { value: 'term', label: '术语' },
] as const

/** 搜索页。输入即搜（300ms 防抖），命中词由后端标好、前端转义后再高亮。 */
export default function Search() {
  const [params, setParams] = useSearchParams()
  const initial = params.get('q') ?? ''
  const [raw, setRaw] = useState(initial)
  const [q, setQ] = useState(initial)
  const type = (params.get('type') as 'all' | 'coin' | 'term' | null) ?? 'all'

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(raw.trim())
      const next = new URLSearchParams(params)
      if (raw.trim()) next.set('q', raw.trim())
      else next.delete('q')
      setParams(next, { replace: true })
    }, 300)
    return () => clearTimeout(t)
    // 只在输入变化时触发；params/setParams 放进依赖会导致输入被反复重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw])

  const result = useSearch(q, type, 20)

  return (
    <div className="container-page pt-[72px] pb-section md:pt-[100px]">
      <p className="marker">搜索</p>
      <h1 className="mt-2 text-display">找一枚钱，或一个词。</h1>

      <div className="mt-8 max-w-[560px]">
        <label htmlFor="site-search" className="sr-only">
          搜索钱币与术语
        </label>
        <input
          id="site-search"
          type="search"
          autoFocus
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="试试「刀币」「青铜」「纪重铭文」…"
          className="w-full rounded-btn border border-hairline bg-surface px-4 py-3 text-body text-ink placeholder:text-ink-muted"
        />
        <div className="mt-4 flex gap-2">
          {TYPES.map((t) => {
            const on = type === t.value
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => {
                  const next = new URLSearchParams(params)
                  if (t.value === 'all') next.delete('type')
                  else next.set('type', t.value)
                  setParams(next, { replace: true })
                }}
                className="capsule transition-colors"
                style={on ? { backgroundColor: 'var(--color-accent)', color: '#fff' } : undefined}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-10">
        {!q ? (
          <p className="text-small text-ink-muted">输入关键词开始检索。中文支持单字与双字查询。</p>
        ) : result.isError ? (
          <ErrorState
            title="搜索失败"
            detail={(result.error as Error)?.message}
            onRetry={() => void result.refetch()}
          />
        ) : result.isPending ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-card" />
            ))}
          </div>
        ) : result.data.total === 0 ? (
          <EmptyState
            title={`没有找到「${q}」`}
            detail="试试更短的关键词，或只搜其中两个字。"
            action={
              <Link to="/coins" className="btn btn-primary">
                浏览全部钱币
              </Link>
            }
          />
        ) : (
          <>
            <p className="text-small text-ink-muted">
              共 {result.data.total} 条结果 · 耗时 {result.data.took_ms} ms
            </p>

            {result.data.coins.length ? (
              <section className="mt-8">
                <h2 className="text-title text-ink">钱币</h2>
                <ul className="mt-5 space-y-3">
                  {result.data.coins.map((hit) => (
                    <li key={hit.slug}>
                      <Link
                        to={`/coins/${encodeURIComponent(hit.slug!)}`}
                        className="card block p-6 transition-transform duration-200 hover:-translate-y-0.5"
                      >
                        <div className="flex flex-wrap items-baseline gap-3">
                          <span className="text-subtitle text-ink">{hit.name}</span>
                          {hit.category ? <span className="capsule">{hit.category}</span> : null}
                        </div>
                        <p
                          className="mt-3 text-small text-ink-muted"
                          dangerouslySetInnerHTML={{ __html: renderSnippet(hit.snippet) }}
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {result.data.terms.length ? (
              <section className="mt-12">
                <h2 className="text-title text-ink">术语</h2>
                <ul className="mt-5 space-y-3">
                  {result.data.terms.map((hit) => (
                    <li key={hit.name}>
                      <Link to={`/terms?q=${encodeURIComponent(hit.name)}`} className="card block p-6">
                        <div className="flex flex-wrap items-baseline gap-3">
                          <span className="text-subtitle text-ink">{hit.name}</span>
                          {hit.category ? <span className="capsule">{hit.category}</span> : null}
                        </div>
                        <p
                          className="mt-3 text-small text-ink-muted"
                          dangerouslySetInnerHTML={{ __html: renderSnippet(hit.snippet) }}
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
