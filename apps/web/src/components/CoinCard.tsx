import { Link } from 'react-router-dom'
import type { CoinBrief } from '@/api/types'
import CoinImage from './CoinImage'
import SourceBadge from './SourceBadge'

/**
 * 钱币卡片。对应参考设计里的商品卡片：
 * 白底 + 22px 圆角 + 无边框无阴影，图片区用浅灰底衬托，文字压底部。
 */
export default function CoinCard({
  coin,
  onToggleCompare,
  inCompare,
  compareFull,
}: {
  coin: CoinBrief
  onToggleCompare?: (slug: string) => void
  inCompare?: boolean
  compareFull?: boolean
}) {
  const subtitle = [coin.period_key, coin.states.join('·')].filter(Boolean).join(' · ')

  return (
    <article className="card group relative flex h-full w-full flex-col">
      <Link to={`/coins/${encodeURIComponent(coin.slug)}`} className="block">
        {/* 统一 4:3 图片区：原图长宽比不一，固定容器 + object-contain 保证同排卡片基线对齐 */}
        <div className="relative aspect-[4/3] overflow-hidden rounded-t-card bg-page">
          {coin.thumbnail ? (
            <CoinImage
              image={coin.thumbnail}
              alt={`${coin.name}${coin.alias ? `（${coin.alias}）` : ''}`}
              kind="thumb"
              fill
              className="transition-transform duration-500 ease-out group-hover:scale-[1.04]"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-page">
              <span className="text-micro text-ink-muted">暂无图片</span>
            </div>
          )}
        </div>

        <div className="p-6">
          <div className="flex flex-wrap items-center gap-2">
            {coin.rarity ? <span className="marker">{coin.rarity}</span> : null}
            <SourceBadge source={coin.period_source} />
          </div>

          <h3 className="mt-2 text-subtitle text-ink">{coin.name}</h3>
          {coin.alias ? (
            <p className="mt-1 text-small text-ink-muted">又称 {coin.alias}</p>
          ) : null}
          {subtitle ? <p className="mt-2 text-small text-ink-muted">{subtitle}</p> : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="capsule">{coin.category.name}</span>
            {coin.materials.slice(0, 2).map((m) => (
              <span key={m} className="capsule">
                {m}
              </span>
            ))}
          </div>
        </div>
      </Link>

      {onToggleCompare ? (
        <button
          type="button"
          onClick={() => onToggleCompare(coin.slug)}
          disabled={!inCompare && compareFull}
          title={
            inCompare
              ? '从对比中移除'
              : compareFull
                ? '对比最多 3 枚，请先移除一枚'
                : '加入对比'
          }
          className="absolute right-4 top-4 z-20 rounded-full px-3 py-1.5 text-micro transition-colors disabled:opacity-40"
          style={{
            backgroundColor: inCompare ? 'var(--color-accent)' : 'rgba(255,255,255,.9)',
            color: inCompare ? '#fff' : 'var(--color-ink)',
            backdropFilter: 'blur(8px)',
          }}
        >
          {inCompare ? '已加入' : '对比'}
        </button>
      ) : null}
    </article>
  )
}
