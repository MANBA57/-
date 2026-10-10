import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTerms } from '@/api/hooks'
import RichText from '@/components/RichText'
import { CardGridSkeleton, EmptyState, ErrorState } from '@/components/States'
import { slugToName } from '@/lib/format'

/** 术语词典。按名称/释义过滤在服务端做（走 FTS5）。 */
export default function Terms() {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')

  // 防抖：必须用 useEffect —— useMemo 不执行返回的清理函数，定时器会泄漏
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])

  const terms = useTerms(debounced || undefined)

  return (
    <div className="container-page pt-[72px] pb-section md:pt-[100px]">
      <p className="marker">术语词典</p>
      <h1 className="mt-2 text-display">读懂钱文里的字。</h1>
      <p className="mt-4 max-w-[52ch] text-body text-ink-muted">
        釿、寽、朋、朱 —— 这些记重单位决定了先秦钱币的面值，
        也是理解当时货币制度的关键。
      </p>

      <div className="mt-8 max-w-[420px]">
        <label htmlFor="term-search" className="sr-only">
          检索术语
        </label>
        <input
          id="term-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="检索术语或释义…"
          className="w-full rounded-btn border border-hairline bg-surface px-4 py-3 text-body text-ink placeholder:text-ink-muted"
        />
      </div>

      <div className="mt-10">
        {terms.isError ? (
          <ErrorState
            title="术语加载失败"
            detail={(terms.error as Error)?.message}
            onRetry={() => void terms.refetch()}
          />
        ) : terms.isPending ? (
          <CardGridSkeleton count={6} />
        ) : terms.data.length === 0 ? (
          <EmptyState
            title={`没有匹配「${debounced}」的术语`}
            detail="试试更短的关键词。"
            action={
              <button type="button" className="btn btn-primary" onClick={() => setQ('')}>
                清除关键词
              </button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-card md:grid-cols-2">
            {terms.data.map((t) => (
              <article key={t.name} className="card p-7">
                <div className="flex flex-wrap items-baseline gap-3">
                  <h2 className="text-title text-ink">{t.name}</h2>
                  {t.pinyin ? <span className="text-small text-ink-muted">{t.pinyin}</span> : null}
                  {t.category ? <span className="capsule">{t.category}</span> : null}
                </div>

                <div className="mt-4">
                  <RichText text={t.definition_md} className="[&_p]:text-small" />
                </div>

                {t.source ? (
                  <p className="mt-4 text-micro text-ink-muted">出处：{t.source}</p>
                ) : null}

                {t.related_slugs.length ? (
                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    <span className="text-micro text-ink-muted">相关钱币</span>
                    {t.related_slugs.map((slug) => (
                      <Link
                        key={slug}
                        to={`/coins/${encodeURIComponent(slug)}`}
                        className="capsule"
                        style={{ backgroundColor: 'var(--color-page)' }}
                      >
                        {slugToName(slug)}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
