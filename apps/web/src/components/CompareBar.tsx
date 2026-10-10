import { Link, useLocation } from 'react-router-dom'
import { COMPARE_MAX, compareStore, useCompareList } from '@/lib/compare'
import { slugToName } from '@/lib/format'

/**
 * 对比栏。选中 1 枚以上就浮在底部（移动端要避开底部 Tab 栏）。
 * 对应参考设计里的购买页底部固定操作条。
 */
export default function CompareBar() {
  const slugs = useCompareList()
  const { pathname } = useLocation()

  // 对比页自身不显示
  if (slugs.length === 0 || pathname === '/compare') return null

  return (
    <div
      className="fixed inset-x-0 z-40 flex justify-center px-4"
      style={{ bottom: 'calc(49px + env(safe-area-inset-bottom, 0px) + 12px)' }}
    >
      <div
        className="flex w-full max-w-[560px] items-center gap-3 rounded-card px-4 py-3"
        style={{
          backgroundColor: 'rgba(245,245,247,.92)',
          backdropFilter: 'saturate(180%) blur(20px)',
          WebkitBackdropFilter: 'saturate(180%) blur(20px)',
          border: '1px solid var(--color-hairline)',
        }}
      >
        <div className="min-w-0 flex-1">
          <p className="text-micro text-ink-muted">
            已选 {slugs.length} / {COMPARE_MAX}
          </p>
          <p className="truncate text-small text-ink">
            {slugs.map(slugToName).join(' · ')}
          </p>
        </div>
        <button
          type="button"
          className="link shrink-0 text-small"
          onClick={() => compareStore.clear()}
        >
          清空
        </button>
        <Link
          to="/compare"
          className="btn btn-primary shrink-0 !min-h-[40px] !px-4 text-small"
          aria-disabled={slugs.length < 2}
          onClick={(e) => {
            if (slugs.length < 2) e.preventDefault()
          }}
          style={slugs.length < 2 ? { opacity: 0.4, pointerEvents: 'none' } : undefined}
        >
          开始对比
        </Link>
      </div>
    </div>
  )
}
