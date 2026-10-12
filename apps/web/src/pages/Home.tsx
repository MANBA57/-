import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCategories, useCoins, useStats, useTimeline } from '@/api/hooks'
import type { CategoryOut } from '@/api/types'
import CoinCard from '@/components/CoinCard'
import CoinImage from '@/components/CoinImage'
import CountUp from '@/components/CountUp'
import Reveal from '@/components/Reveal'
import { CardGridSkeleton, ErrorState, Skeleton } from '@/components/States'
import { compareStore, useCompareList, COMPARE_MAX } from '@/lib/compare'

/**
 * 首页。动效语言参考 apple.com：
 * 居中首屏（入场依次上浮清晰）→ 大数字统计（滚动 + 数字滚动）
 * → 深色体系货架（带实物图，snap 横滑）→ 朝代年轮横滑条 → 精选网格 → 收束语。
 * 所有入场动画在 prefers-reduced-motion 下关闭（见 index.css 动效层）。
 */

/** 年份显示：负数为公元前 */
function yearLabel(y: number | null): string {
  if (y == null) return '—'
  return y < 0 ? `前${-y}` : String(y)
}

/**
 * 首屏钱币舞台：五大体系各取一张代表图，交叉淡入淡出轮换。
 * 悬停暂停轮换、露出切换圆点；说明文字随切换重放入场。
 */
function HeroStage({ categories }: { categories: CategoryOut[] }) {
  const slides = categories.filter((c) => c.images.length > 0)
  const [idx, setIdx] = useState(0)
  const paused = useRef(false)

  useEffect(() => {
    if (slides.length < 2) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setInterval(() => {
      if (!paused.current) setIdx((i) => (i + 1) % slides.length)
    }, 4800)
    return () => window.clearInterval(timer)
  }, [slides.length])

  if (!slides.length) {
    return (
      <div className="mx-auto mt-14 aspect-square w-full max-w-[600px]">
        <Skeleton className="h-full w-full rounded-card" />
      </div>
    )
  }
  const active = slides[idx % slides.length]

  return (
    <div
      className="relative mx-auto mt-14 w-full max-w-[600px]"
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
    >
      <div className="relative aspect-square overflow-hidden rounded-card">
        {slides.map((c, i) => (
          <Link
            key={c.key}
            to={`/coins?category=${c.key}`}
            aria-label={`查看${c.name}体系`}
            className="absolute inset-0 transition-[opacity,transform] duration-[1100ms]"
            style={{
              transitionTimingFunction: 'var(--ease-apple)',
              opacity: i === idx ? 1 : 0,
              transform: i === idx ? 'scale(1)' : 'scale(1.04)',
              pointerEvents: i === idx ? 'auto' : 'none',
            }}
          >
            <CoinImage
              image={c.images[0]}
              alt={c.name}
              kind="full"
              priority={i === 0}
              fill
              className={`bg-surface!${i === idx ? ' float-soft' : ''}`}
            />
          </Link>
        ))}
      </div>

      <p key={active.key} className="caption-in mt-6 text-center text-small text-ink-muted">
        <span className="font-semibold text-ink">{active.name}</span>
        <span className="mx-2 text-hairline">·</span>
        {active.coin_count} 种
      </p>

      <div className="mt-4 flex justify-center gap-2">
        {slides.map((c, i) => (
          <button
            key={c.key}
            type="button"
            aria-label={`第 ${i + 1} 张：${c.name}`}
            onClick={() => setIdx(i)}
            className="h-[7px] w-[7px] cursor-pointer rounded-full transition-colors duration-300"
            style={{ backgroundColor: i === idx ? 'var(--color-ink)' : 'var(--color-hairline)' }}
          />
        ))}
      </div>
    </div>
  )
}

export default function Home() {
  const stats = useStats()
  const categories = useCategories()
  const timeline = useTimeline()
  const featured = useCoins({ page_size: 6, sort: 'order' })
  const compareList = useCompareList()

  return (
    <>
      {/* ===== 居中首屏：文字依次上浮入场，钱币舞台交叉轮换 ===== */}
      <section className="container-page pb-section pt-[84px] text-center md:pt-[128px]">
        <p className="hero-enter hero-d1 text-micro font-semibold tracking-[0.22em] text-ink-muted">
          数字钱币库
        </p>
        <h1 className="hero-enter hero-d2 mt-5 text-hero text-ink">三千五百年，方寸之间。</h1>
        <p className="hero-enter hero-d3 mx-auto mt-6 max-w-[46ch] text-body text-ink-muted">
          从商代的海贝，到民国的铜元，一次看全。
        </p>
        <div className="hero-enter hero-d4 mt-8 flex flex-wrap items-center justify-center gap-5">
          <Link to="/coins" className="btn btn-primary">
            浏览全部钱币
          </Link>
          <Link to="/timeline" className="link text-body">
            按时间轴查看 ›
          </Link>
        </div>

        <div className="hero-enter hero-d4">
          <HeroStage categories={categories.data ?? []} />
        </div>
      </section>

      {/* ===== 大数字统计：无边框卡片，纯排版 + 数字滚动 ===== */}
      <section className="container-page pb-section">
        <dl className="grid grid-cols-2 gap-x-card gap-y-10 md:grid-cols-4">
          {[
            { k: '钱币条目', v: stats.data?.coin_count },
            { k: '货币体系', v: stats.data?.category_count },
            { k: '收录时期', v: stats.data?.period_buckets.length },
            { k: '高清图像', v: stats.data?.image_count },
          ].map((s, i) => (
            <Reveal
              key={s.k}
              delay={i * 90}
              className="md:pl-8 md:first:pl-0 md:[&:not(:first-child)]:border-l md:[&:not(:first-child)]:border-hairline"
            >
              <dt className="text-micro text-ink-muted">{s.k}</dt>
              <dd className="mt-2 text-display text-ink">
                <CountUp value={s.v} />
              </dd>
            </Reveal>
          ))}
        </dl>
        <Reveal delay={360}>
          <p className="mt-10 text-small text-ink-muted">
            自公元前 1600 年商代贝币，至 1949 年。
          </p>
        </Reveal>
      </section>

      {/* ===== 深色体系货架：全站唯一使用纯黑的区块，卡片带实物图 ===== */}
      <section className="bg-dark py-section text-on-dark">
        <div className="container-page">
          <Reveal>
            <h2 className="text-display">五大货币体系。</h2>
            <p className="mt-4 max-w-[56ch] text-body text-on-dark/70">
              农具铲变为布币，削刀变为刀币，纺轮与玉璧变为圜钱，海贝变为铜贝；
              秦统一天下后，方孔圆钱一用就是两千多年。
            </p>
          </Reveal>
        </div>

        <Reveal delay={140}>
          <div className="no-scrollbar mt-12 flex snap-x snap-mandatory gap-card overflow-x-auto px-[5.3%] pb-2">
            {categories.isPending
              ? Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="w-[78vw] shrink-0 rounded-card bg-[#1d1d1f] sm:w-[400px]">
                    <Skeleton className="h-64 w-full rounded-b-none sm:h-72" />
                    <div className="p-7">
                      <Skeleton className="h-3 w-16" />
                      <Skeleton className="mt-4 h-7 w-24" />
                      <Skeleton className="mt-4 h-3 w-full" />
                      <Skeleton className="mt-2 h-3 w-4/5" />
                    </div>
                  </div>
                ))
              : null}

            {categories.data?.map((c) => (
              <Link
                key={c.key}
                to={`/coins?category=${c.key}`}
                className="group w-[78vw] shrink-0 snap-start overflow-hidden rounded-card bg-[#1d1d1f] transition-transform duration-500 ease-out hover:-translate-y-1.5 sm:w-[400px]"
              >
                <div className="relative h-64 overflow-hidden bg-page sm:h-72">
                  {c.images[0] ? (
                    <CoinImage
                      image={c.images[0]}
                      alt={c.name}
                      kind="full"
                      fill
                      className="transition-transform duration-700 ease-out group-hover:scale-[1.05]"
                    />
                  ) : (
                    <div className="h-full w-full bg-white/5" />
                  )}
                </div>
                <div className="p-7">
                  <p className="text-micro text-on-dark/50">{c.coin_count} 种</p>
                  <h3 className="mt-3 text-title text-on-dark">{c.name}</h3>
                  <p className="mt-3 line-clamp-3 text-small text-on-dark/70">{c.intro_md}</p>
                </div>
              </Link>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ===== 朝代年轮：一条发丝线串起三十三个时期，点击进入该期检索 ===== */}
      <section className="py-section">
        <div className="container-page flex flex-wrap items-end justify-between gap-4">
          <Reveal>
            <h2 className="text-display">从先秦到民国。</h2>
            <p className="mt-3 text-body text-ink-muted">
              三十三个时期依次排开，点任一段查看该时期的钱币。
            </p>
          </Reveal>
          <Reveal delay={100}>
            <Link to="/timeline" className="link text-small">
              完整时间轴 ›
            </Link>
          </Reveal>
        </div>

        <Reveal delay={160}>
          <div className="no-scrollbar mt-12 overflow-x-auto">
            <div className="relative flex w-max snap-x snap-proximity gap-12 pl-[5.3%] pr-[12vw] pb-2">
              <div aria-hidden className="absolute inset-x-0 top-[7px] h-px bg-hairline" />
              {timeline.isPending
                ? Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} className="w-[130px] shrink-0 pt-7">
                      <Skeleton className="h-7 w-20" />
                      <Skeleton className="mt-3 h-4 w-14" />
                    </div>
                  ))
                : null}
              {timeline.data?.map((t) => (
                <Link
                  key={t.period_key}
                  to={`/coins?period=${encodeURIComponent(t.period_key)}`}
                  className="group relative w-[130px] shrink-0 snap-start pt-7"
                >
                  <span
                    aria-hidden
                    className="absolute left-0 top-[3px] h-[9px] w-[9px] rounded-full bg-hairline transition-all duration-300 group-hover:scale-125 group-hover:bg-accent"
                  />
                  <p className="text-title text-ink transition-colors duration-300 group-hover:text-accent">
                    {yearLabel(t.start_year)}
                  </p>
                  <p className="mt-1 text-small font-semibold text-ink">{t.period_key}</p>
                  <p className="mt-0.5 text-small text-ink-muted">{t.coins.length} 种</p>
                </Link>
              ))}
            </div>
          </div>
        </Reveal>
      </section>

      {/* ===== 精选钱币网格：滚动到视口后按次序入场 ===== */}
      <section className="pb-section">
        <div className="container-page flex flex-wrap items-end justify-between gap-4">
          <Reveal>
            <h2 className="text-display">精选钱币。</h2>
            <p className="mt-3 text-body text-ink-muted">按体系顺序挑选的代表品种。</p>
          </Reveal>
          <Reveal delay={100}>
            <Link to="/coins" className="link text-small">
              查看全部 {stats.data?.coin_count ?? ''} 种 ›
            </Link>
          </Reveal>
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
              {featured.data.items.map((coin, i) => (
                <Reveal key={coin.slug} delay={i * 70} className="flex">
                  <CoinCard
                    coin={coin}
                    inCompare={compareList.includes(coin.slug)}
                    compareFull={compareList.length >= COMPARE_MAX}
                    onToggleCompare={(slug) => compareStore.toggle(slug)}
                  />
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ===== 收束语 ===== */}
      <section className="pb-section">
        <Reveal className="container-page text-center">
          <p className="text-display text-ink">钱文即史文。</p>
          <p className="mx-auto mt-4 max-w-[40ch] text-body text-ink-muted">
            每一个年号、每一种书体，都是朝代更替留下的手迹。
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-x-7 gap-y-3">
            <Link to="/evolution" className="link text-small">
              体系如何演化 ›
            </Link>
            <Link to="/terms" className="link text-small">
              术语词典 ›
            </Link>
            <Link to="/about" className="link text-small">
              关于本馆 ›
            </Link>
          </div>
        </Reveal>
      </section>
    </>
  )
}
