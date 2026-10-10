import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <section className="container-page" style={{ paddingBlock: 'var(--spacing-section)' }}>
      <p className="marker">404</p>
      <h1 className="mt-2 text-display">没有找到这个页面</h1>
      <p className="mt-4 max-w-[42ch] text-body text-ink-muted">
        链接可能已经失效，或者这个展品还没有入藏。
      </p>
      <Link to="/" className="btn btn-primary mt-8">
        回到首页
      </Link>
    </section>
  )
}
