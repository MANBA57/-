import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useRef } from 'react'
import CompareBar from '@/components/CompareBar'
import AmbientBackground from '@/components/AmbientBackground'
import MusicPlayer from '@/components/MusicPlayer'
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
  const { pathname } = useLocation()
  // 彩蛋：站名连点计数（1.6 秒内连点 7 次进小游戏）
  const nameTap = useRef({ n: 0, t: 0 })

  // 页面间滚动隔离：切到新页面从顶部开始，不继承上一页的滚动位置
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname])

  // 彩蛋：键盘 Konami 秘籍 ↑↑↓↓←→←→BA 进小游戏
  useEffect(() => {
    const seq = [
      'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
      'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
      'KeyB', 'KeyA',
    ]
    let pos = 0
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === seq[pos]) pos += 1
      else pos = e.code === seq[0] ? 1 : 0
      if (pos === seq.length) {
        pos = 0
        navigate('/game')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  return (
    <div className="min-h-dvh bg-page text-ink">
      <AmbientBackground />
      <header className="navbar">
        <nav className="container-page navbar-inner" aria-label="主导航">
          {/* 移动端：只留站名与搜索，导航交给底部 Tab 栏（6 个链接在 390px 下必然溢出） */}
          <button
            type="button"
            className="mr-auto text-micro font-semibold md:hidden"
            aria-label="数字钱币库"
            onClick={() => {
              const s = nameTap.current
              const now = Date.now()
              s.n = now - s.t < 1600 ? s.n + 1 : 1
              s.t = now
              if (s.n >= 7) {
                s.n = 0
                navigate('/game')
              }
            }}
          >
            数字钱币库
          </button>

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

      <main className="relative z-10 pb-[calc(49px+env(safe-area-inset-bottom,0px))] md:pb-0">
        <Outlet />
      </main>

      <CompareBar />

      <MusicPlayer />

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
