import { Link } from 'react-router-dom'
import { useTimeline } from '@/api/hooks'
import { ErrorState, Skeleton } from '@/components/States'
import { formatYear } from '@/lib/format'

/**
 * 时间轴。横向滚动，每个时期一列；顶部一条贯穿的年代轴。
 * 参考设计里横向溢出、右侧被裁切的轮播就是这个思路。
 */
export default function Timeline() {
  const timeline = useTimeline()

  if (timeline.isError) {
    return (
      <div className="container-page py-section">
        <ErrorState
          title="时间轴加载失败"
          detail={(timeline.error as Error)?.message}
          onRetry={() => void timeline.refetch()}
        />
      </div>
    )
  }

  return (
    <div className="pb-section">
      <section className="container-page pt-[72px] pb-block md:pt-[100px]">
        <p className="marker">时间轴</p>
        <h1 className="mt-2 text-display">从商周到秦统一。</h1>
        <p className="mt-4 max-w-[52ch] text-body text-ink-muted">
          先秦货币从实物货币走向金属铸币，形制在约一千四百年间不断演变。
          左右滑动查看各时期的代表钱币。
        </p>
      </section>

      {timeline.isPending ? (
        <div className="container-page flex gap-card">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[420px] w-[280px] shrink-0 rounded-card" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto pb-6">
          <div className="flex min-w-max gap-card px-[5.3%]">
            {timeline.data.map((entry) => (
              <section key={entry.period_key} className="w-[280px] shrink-0 sm:w-[320px]">
                {/* 年代轴节点 */}
                <div className="flex items-center gap-3">
                  <span
                    className="block h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: 'var(--color-accent)' }}
                  />
                  <span className="h-px flex-1" style={{ backgroundColor: 'var(--color-hairline)' }} />
                </div>

                <h2 className="mt-4 text-title text-ink">{entry.period_key}</h2>
                <p className="mt-1 text-micro text-ink-muted tabular-nums">
                  {formatYear(entry.start_year)} — {formatYear(entry.end_year)}
                  <span className="ml-2">{entry.coins.length} 种</span>
                </p>

                <ul className="mt-5 space-y-2">
                  {entry.coins.map((coin) => (
                    <li key={coin.slug}>
                      <Link
                        to={`/coins/${encodeURIComponent(coin.slug)}`}
                        className="card flex items-center gap-4 p-3 transition-transform duration-200 hover:-translate-y-0.5"
                      >
                        <span className="h-14 w-14 shrink-0 overflow-hidden rounded-thumb bg-page">
                          {coin.thumbnail ? (
                            <img
                              src={coin.thumbnail.thumb_webp}
                              alt=""
                              loading="lazy"
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            <span className="flex h-full w-full items-center justify-center text-[10px] text-ink-muted">
                              无图
                            </span>
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-small text-ink">{coin.name}</span>
                          <span className="mt-0.5 block truncate text-micro text-ink-muted">
                            {[coin.states.join('·'), coin.materials[0]].filter(Boolean).join(' · ') ||
                              coin.category.name}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
