import { Link } from 'react-router-dom'
import { useCategories, useStats } from '@/api/hooks'
import CoinCard from '@/components/CoinCard'
import { CardGridSkeleton, ErrorState, Skeleton } from '@/components/States'
import { useCoins } from '@/api/hooks'
import { compareStore, useCompareList, COMPARE_MAX } from '@/lib/compare'

/**
 * 首页。排版骨架照搬参考设计：
 * 巨型标题区（左标题 / 右辅助文案）→ 统计数字 → 深色体系轮播 → 精选钱币网格。
 */
export default function Home() {
  const stats = useStats()
  const categories = useCategories()
  const featured = useCoins({ page_size: 6, sort: 'order' })
  const compareList = useCompareList()

  return (
    <>
      {/* ===== 巨型标题区 ===== */}
      <section className="container-page pt-[72px] pb-block md:pt-[120px]">
        <div className="flex flex-col gap-10 md:flex-row md:items-end md:justify-between md:gap-16">
          <h1 className="text-hero text-ink">数字钱币库</h1>
          <div className="md:max-w-[34ch] md:pb-3 md:text-right">
            <p className="text-subtitle font-semibold text-ink">
              先秦四大货币体系，
              <br />
              一次看全。
            </p>
            <p className="mt-3 text-small text-ink-muted">
              布币、刀币、圜钱、贝币 —— 从农具、削刀、纺轮与海贝演变而来的中国最早一批金属铸币。
            </p>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 md:justify-end">
              <Link to="/coins" className="link text-small">
                浏览全部钱币 ›
              </Link>
              <Link to="/timeline" className="link text-small">
                按时间轴查看 ›
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ===== 统计数字 ===== */}
      <section className="container-page pb-block">
        <dl className="grid grid-cols-2 gap-card md:grid-cols-4">
          {[
            { k: '钱币条目', v: stats.data ? String(stats.data.coin_count) : '—' },
            { k: '货币体系', v: stats.data ? String(stats.data.category_count) : '—' },
            { k: '高清图像', v: stats.data ? String(stats.data.image_count) : '—' },
            { k: '时间跨度', v: stats.data?.period_span ?? '—' },
          ].map((s) => (
            <div key={s.k} className="card px-6 py-7">
              <dt className="text-micro text-ink-muted">{s.k}</dt>
              {/* 时间跨度这类长文案降一级字号，否则四张卡片高度会被它撑歪 */}
              <dd className={`mt-1 text-ink ${s.v.length > 8 ? 'text-subtitle' : 'text-title'}`}>
                {s.v}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ===== 深色体系轮播：全站唯一使用纯黑的区块 ===== */}
      <section className="bg-dark py-section text-on-dark">
        <div className="container-page">
          <h2 className="text-display">四大货币体系。</h2>
          <p className="mt-3 max-w-[52ch] text-body text-on-dark/70">
            各诸侯国地理环境、生产方式与文化传统不同，货币因此分化成互不相同的四大体系。
          </p>
        </div>

        <div className="mt-10 flex snap-x snap-mandatory gap-card overflow-x-auto px-[5.3%] pb-3">
          {categories.isPending
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="w-[78vw] shrink-0 rounded-card bg-[#1d1d1f] p-7 sm:w-[380px]">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="mt-4 h-6 w-20" />
                  <Skeleton className="mt-4 h-3 w-full" />
                  <Skeleton className="mt-2 h-3 w-5/6" />
                </div>
              ))
            : null}

          {categories.data?.map((c) => (
            <Link
              key={c.key}
              to={`/coins?category=${c.key}`}
              className="w-[78vw] shrink-0 snap-start rounded-card bg-[#1d1d1f] p-7 transition-transform duration-300 hover:-translate-y-1 sm:w-[380px]"
            >
              <p className="marker">
                {c.coin_count} 种
                {c.intro_source === 'editor' ? (
                  <span className="ml-2 text-on-dark/40">导语据原文补写</span>
                ) : null}
              </p>
              <h3 className="mt-3 text-title text-on-dark">{c.name}</h3>
              <p className="mt-3 line-clamp-4 text-small text-on-dark/70">{c.intro_md}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* ===== 精选钱币网格 ===== */}
      <section className="py-section">
        <div className="container-page flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-display">精选钱币。</h2>
            <p className="mt-3 text-body text-ink-muted">按体系顺序挑选的代表品种。</p>
          </div>
          <Link to="/coins" className="link text-small">
            查看全部 {stats.data?.coin_count ?? ''} 种 ›
          </Link>
        </div>

        <div className="container-page mt-10">
          {featured.isError ? (
            <ErrorState
              title="钱币数据加载失败"
              detail={(featured.error as Error)?.message}
              onRetry={() => void featured.refetch()}
            />
          ) : featured.isPending ? (
            <CardGridSkeleton count={6} />
          ) : (
            <div className="grid grid-cols-1 gap-card sm:grid-cols-2 lg:grid-cols-3">
              {featured.data.items.map((coin) => (
                <CoinCard
                  key={coin.slug}
                  coin={coin}
                  inCompare={compareList.includes(coin.slug)}
                  compareFull={compareList.length >= COMPARE_MAX}
                  onToggleCompare={(slug) => compareStore.toggle(slug)}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  )
}
