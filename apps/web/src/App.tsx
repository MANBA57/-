import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import CompareBar from '@/components/CompareBar'
import { useCompareList } from '@/lib/compare'

const NAV = [
  { to: '/', label: '首页', end: true },
  { to: '/coins', label: '钱币库' },
  { to: '/timeline', label: '时间轴' },
  { to: '/evolution', label: '体系演化' },
  { to: '/terms', label: '术语' },
  { to: '/about', label: '关于' },
]

const TABS = [
  { to: '/', label: '首页', end: true, icon: 'M3 10.5 12 3l9 7.5V21H3z' },
  { to: '/coins', label: '钱币库', icon: 'M4 5h16v14H4zM4 10h16' },
  { to: '/timeline', label: '时间轴', icon: 'M3 12h18M7 8v8M12 6v12M17 8v8' },
  { to: '/terms', label: '词典', icon: 'M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM17 7h2v13H8' },
]

export default function App() {
  const navigate = useNavigate()
  const compareList = useCompareList()

  return (
    <div className="min-h-dvh bg-page text-ink">
      <header className="navbar">
        <nav className="container-page navbar-inner" aria-label="主导航">
          {/* 移动端：只留站名与搜索，导航交给底部 Tab 栏（6 个链接在 390px 下必然溢出） */}
          <span className="mr-auto text-micro font-semibold md:hidden">数字钱币库</span>

          <div className="hidden items-center gap-7 md:flex">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className="navbar-link">
                {item.label}
              </NavLink>
            ))}
            {compareList.length ? (
              <NavLink to="/compare" className="navbar-link">
                对比
                <span
                  className="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] text-white"
                  style={{ backgroundColor: 'var(--color-accent)' }}
                >
                  {compareList.length}
                </span>
              </NavLink>
            ) : null}
          </div>

          <button
            type="button"
            aria-label="搜索"
            className="navbar-link ml-auto md:ml-0"
            onClick={() => navigate('/search')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="m20 20-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </nav>
      </header>

      <main className="pb-[calc(49px+env(safe-area-inset-bottom,0px))] md:pb-0">
        <Outlet />
      </main>

      <CompareBar />

      <nav className="tabbar md:hidden" aria-label="底部导航">
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className="tabbar-item">
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d={tab.icon}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>{tab.label}</span>
          </NavLink>
        ))}
        <NavLink to="/search" className="tabbar-item">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="m20 20-4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span>搜索</span>
        </NavLink>
      </nav>
    </div>
  )
}
