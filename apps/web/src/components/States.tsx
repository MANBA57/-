import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/** 骨架屏：与设计系统一致，只用底色差，不用阴影 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-thumb bg-capsule ${className}`} />
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-card sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-6">
          <Skeleton className="h-[210px] w-full rounded-card-sm" />
          <Skeleton className="mt-5 h-3 w-24" />
          <Skeleton className="mt-3 h-5 w-32" />
          <Skeleton className="mt-3 h-5 w-40" />
        </div>
      ))}
    </div>
  )
}

export function ErrorState({
  title = '加载失败',
  detail,
  onRetry,
}: {
  title?: string
  detail?: ReactNode
  onRetry?: () => void
}) {
  return (
    <div className="card p-8 text-center">
      <p className="marker">出错了</p>
      <p className="mt-2 text-subtitle text-ink">{title}</p>
      {detail ? <p className="mt-3 text-small text-ink-muted">{detail}</p> : null}
      <div className="mt-6 flex justify-center gap-3">
        {onRetry ? (
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            重试
          </button>
        ) : null}
        <Link to="/" className="btn btn-secondary">
          回到首页
        </Link>
      </div>
    </div>
  )
}

export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string
  detail?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="card p-10 text-center">
      <p className="text-subtitle text-ink">{title}</p>
      {detail ? <p className="mt-3 text-small text-ink-muted">{detail}</p> : null}
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  )
}
