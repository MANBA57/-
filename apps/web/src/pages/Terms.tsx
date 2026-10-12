import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCoin, useCompare, useTerms } from '@/api/hooks'
import type { TermOut } from '@/api/types'
import CoinImage from '@/components/CoinImage'
import RichText from '@/components/RichText'
import { CardGridSkeleton, EmptyState, ErrorState } from '@/components/States'

/**
 * 术语词典。
 *
 * 排列方式是显式声明的：按类别分组（记重单位 → 形制 → 铸地 → 俗称 → 相关货币），
 * 组内按拼音排序 —— 组头带词条数与一句说明，不再让读者猜顺序。
 * 每条术语配一枚「圜钱」徽章：单字术语的字就是钱文（如釿、朋、垣），
 * 多字术语则展示圆形方孔素钱。相关钱币直接带实物缩略图。
 */

const CATEGORY_ORDER = ['记重单位', '形制', '铸地', '俗称', '相关货币']

const CATEGORY_META: Record<string, string> = {
  记重单位: '钱文里的重量与面值',
  形制: '钱币的形态、部位与款式',
  铸地: '面文里的战国城邑 —— 这枚钱在哪里铸造',
  俗称: '后人叫开的名字',
  相关货币: '与铜币并存的姊妹货币',
}

/** 圜钱徽章：单字即钱文居中；无字时露出中央方孔（圆形方孔的素钱）。 */
function CoinMedallion({ term }: { term: TermOut }) {
  const single = term.name.length === 1
  return (
    <div
      className="relative grid h-16 w-16 shrink-0 place-items-center rounded-full border border-hairline bg-capsule"
      aria-hidden
    >
      {single ? (
        <span className="text-title leading-none text-ink">{term.name}</span>
      ) : (
        <span className="h-3.5 w-3.5 rounded-[3px] border border-hairline bg-surface" />
      )}
    </div>
  )
}

/** 相关钱币：实物缩略图横滑条。单条走详情接口（compare 要求 2~3 枚），多条走 compare。 */
function TermCoins({ slugs }: { slugs: string[] }) {
  const multi = useCompare(slugs)
  const single = useCoin(slugs.length === 1 ? slugs[0] : '')
  const data = slugs.length === 1 ? (single.data ? [single.data] : undefined) : multi.data
  if (!data?.length) return null
  return (
    <div className="mt-5">
      <p className="text-micro text-ink-muted">相关钱币</p>
      <div className="no-scrollbar mt-3 flex gap-3 overflow-x-auto pb-1">
        {data.map((c) => (
          <Link
            key={c.slug}
            to={`/coins/${encodeURIComponent(c.slug)}`}
            className="group w-[112px] shrink-0"
          >
            <div className="relative aspect-[4/3] overflow-hidden rounded-thumb bg-page">
              {c.thumbnail ? (
                <CoinImage
                  image={c.thumbnail}
                  alt={c.name}
                  kind="thumb"
                  fill
                  className="transition-transform duration-500 ease-out group-hover:scale-[1.05]"
                />
              ) : null}
            </div>
            <p className="mt-1.5 truncate text-micro text-ink">{c.name}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}

function TermCard({ term }: { term: TermOut }) {
  return (
    <article className="card flex w-full p-7">
      <CoinMedallion term={term} />
      <div className="min-w-0 flex-1 pl-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-title text-ink">{term.name}</h2>
          {term.pinyin ? <span className="text-small text-ink-muted">{term.pinyin}</span> : null}
          {term.category ? <span className="capsule">{term.category}</span> : null}
        </div>

        <div className="mt-3">
          <RichText text={term.definition_md} className="[&_p]:text-small" />
        </div>

        {term.source ? (
          <p className="mt-4 text-micro text-ink-muted">出处：{term.source}</p>
        ) : null}

        {term.related_slugs.length ? <TermCoins slugs={term.related_slugs} /> : null}
      </div>
    </article>
  )
}

export default function Terms() {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')

  // 防抖：必须用 useEffect —— useMemo 不执行返回的清理函数，定时器会泄漏
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])

  const terms = useTerms(debounced || undefined)

  // 分组 + 组内拼音序。分类固定的先后顺序 = 页面顶部声明的那句排列规则
  const groups = useMemo(() => {
    const data = terms.data ?? []
    const byCat = new Map<string, TermOut[]>()
    for (const t of data) {
      const cat = t.category ?? '其他'
      if (!byCat.has(cat)) byCat.set(cat, [])
      byCat.get(cat)!.push(t)
    }
    const known = CATEGORY_ORDER.filter((c) => byCat.has(c))
    const extra = [...byCat.keys()].filter((c) => !CATEGORY_ORDER.includes(c)).sort()
    return [...known, ...extra].map((cat) => ({
      category: cat,
      items: byCat.get(cat)!.sort((a, b) =>
        (a.pinyin ?? a.name).localeCompare(b.pinyin ?? b.name, 'zh'),
      ),
    }))
  }, [terms.data])

  const total = terms.data?.length ?? 0

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

      {total > 0 ? (
        <p className="mt-6 text-micro text-ink-muted">
          共 {total} 条 · 按类别分组（记重单位 → 形制 → 铸地 → 俗称 → 相关货币），组内按拼音排序
        </p>
      ) : null}

      <div className="mt-8">
        {terms.isError ? (
          <ErrorState
            title="术语加载失败"
            detail={(terms.error as Error)?.message}
            onRetry={() => void terms.refetch()}
          />
        ) : terms.isPending ? (
          <CardGridSkeleton count={6} />
        ) : total === 0 ? (
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
          groups.map((g) => (
            <section key={g.category} className="mt-12 first:mt-0">
              <div className="hairline-b flex flex-wrap items-baseline justify-between gap-2 pb-3">
                <h2 className="text-title text-ink">{g.category}</h2>
                <p className="text-small text-ink-muted">
                  {g.items.length} 条 · {CATEGORY_META[g.category] ?? ''}
                </p>
              </div>
              <div className="mt-6 grid grid-cols-1 gap-card md:grid-cols-2">
                {g.items.map((t) => (
                  <TermCard key={t.name} term={t} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  )
}
