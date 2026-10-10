import { Link } from 'react-router-dom'
import { useCompare } from '@/api/hooks'
import CoinImage from '@/components/CoinImage'
import RichText from '@/components/RichText'
import SourceBadge from '@/components/SourceBadge'
import { EmptyState, ErrorState, Skeleton } from '@/components/States'
import { COMPARE_MAX, compareStore, useCompareList } from '@/lib/compare'
import { formatGram, formatMm, formatYear } from '@/lib/format'
import type { CoinDetail } from '@/api/types'

type Row = { label: string; value: (c: CoinDetail) => string | null }

const ROWS: Row[] = [
  { label: '货币体系', value: (c) => c.category.name },
  { label: '时期', value: (c) => c.period_key },
  { label: '国别', value: (c) => (c.states.length ? c.states.join(' · ') : null) },
  { label: '材质', value: (c) => (c.materials.length ? c.materials.join(' · ') : null) },
  { label: '记重单位', value: (c) => (c.units.length ? c.units.join(' · ') : null) },
  { label: '直径', value: (c) => formatMm(c.diameter_mm) },
  { label: '通长', value: (c) => formatMm(c.length_mm) },
  { label: '重量', value: (c) => formatGram(c.weight_g) },
  { label: '面文', value: (c) => c.inscription_front },
  { label: '背文', value: (c) => c.inscription_back },
  { label: '存世', value: (c) => c.rarity },
  { label: '文献提及年份', value: (c) => formatYear(c.year_mentioned) },
]

/** 对比页。差异项高亮 —— 这是对比存在的意义，不 highlight 就只是并排两列。 */
export default function Compare() {
  const slugs = useCompareList()
  const compare = useCompare(slugs)

  if (slugs.length < 2) {
    return (
      <div className="container-page pt-[72px] pb-section md:pt-[100px]">
        <p className="marker">对比</p>
        <h1 className="mt-2 text-display">并排看差异。</h1>
        <div className="mt-10">
          <EmptyState
            title={`请先选择 2~${COMPARE_MAX} 枚钱币`}
            detail={
              slugs.length === 1
                ? '已选 1 枚，再去钱币库挑一枚就能开始对比。'
                : '在钱币库里点击卡片右上角的「对比」即可加入。'
            }
            action={
              <Link to="/coins" className="btn btn-primary">
                去钱币库挑选
              </Link>
            }
          />
        </div>
      </div>
    )
  }

  if (compare.isError) {
    return (
      <div className="container-page py-section">
        <ErrorState
          title="对比数据加载失败"
          detail={(compare.error as Error)?.message}
          onRetry={() => void compare.refetch()}
        />
      </div>
    )
  }

  return (
    <div className="container-page pt-[72px] pb-section md:pt-[100px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="marker">对比</p>
          <h1 className="mt-2 text-display">并排看差异。</h1>
          <p className="mt-3 text-small text-ink-muted">有差异的字段以蓝色底纹标出。</p>
        </div>
        <button type="button" className="btn btn-secondary !min-h-[44px] text-small" onClick={() => compareStore.clear()}>
          清空对比
        </button>
      </div>

      {compare.isPending ? (
        <Skeleton className="mt-10 h-[520px] w-full rounded-card" />
      ) : (
        <div className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse md:min-w-[640px]">
            <thead>
              <tr>
                {/* 行标题列：移动端必须收窄并禁止换行，
                    否则「货币体系」会被逐字竖排成一个字一行的窄条。 */}
                <th className="w-[84px] whitespace-nowrap p-3 text-left align-bottom text-micro text-ink-muted md:w-[130px] md:p-4 md:text-small">
                  项目
                </th>
                {compare.data.map((c) => (
                  <th key={c.slug} className="p-3 text-left align-bottom md:p-4">
                    <div className="w-[150px] md:w-[200px]">
                      <div className="overflow-hidden rounded-card-sm bg-page">
                        {c.thumbnail ? (
                          <CoinImage image={c.thumbnail} alt={c.name} kind="thumb" />
                        ) : (
                          <div className="flex h-[100px] items-center justify-center text-micro text-ink-muted md:h-[140px]">
                            暂无图片
                          </div>
                        )}
                      </div>
                      <Link
                        to={`/coins/${encodeURIComponent(c.slug)}`}
                        className="link mt-3 block text-subtitle"
                      >
                        {c.name}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <SourceBadge source={c.period_source} />
                        <button
                          type="button"
                          className="text-micro text-ink-muted hover:text-ink"
                          onClick={() => compareStore.remove(c.slug)}
                        >
                          移除
                        </button>
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => {
                const values = compare.data.map((c) => row.value(c))
                const present = values.filter((v): v is string => Boolean(v))
                const differs = new Set(present).size > 1
                return (
                  <tr key={row.label} className="border-t" style={{ borderColor: 'var(--color-hairline-soft)' }}>
                    <th className="whitespace-nowrap p-3 text-left align-top text-micro font-normal text-ink-muted md:p-4 md:text-small">
                      {row.label}
                    </th>
                    {values.map((v, i) => (
                      <td
                        key={compare.data[i].slug}
                        className="p-3 align-top text-small text-ink md:p-4"
                        style={differs && v ? { backgroundColor: 'rgba(0,113,227,.06)' } : undefined}
                      >
                        {v ?? <span className="text-ink-muted">—</span>}
                      </td>
                    ))}
                  </tr>
                )
              })}
              <tr className="border-t" style={{ borderColor: 'var(--color-hairline-soft)' }}>
                <th className="whitespace-nowrap p-3 text-left align-top text-micro font-normal text-ink-muted md:p-4 md:text-small">
                  简介
                </th>
                {compare.data.map((c) => (
                  <td key={c.slug} className="p-3 align-top md:p-4">
                    <RichText text={c.description_md} className="[&_p]:text-small [&_p]:text-ink-muted" />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
