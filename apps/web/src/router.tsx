import { createBrowserRouter } from 'react-router-dom'
import App from '@/App'
import Home from '@/pages/Home'
import Browse from '@/pages/Browse'
import CoinDetail from '@/pages/CoinDetail'
import Timeline from '@/pages/Timeline'
import Evolution from '@/pages/Evolution'
import Terms from '@/pages/Terms'
import Compare from '@/pages/Compare'
import Search from '@/pages/Search'
import About from '@/pages/About'
import DesignTokens from '@/pages/DesignTokens'
import NotFound from '@/pages/NotFound'
import Game from '@/pages/Game'

/** 路由表。9 个展示页 + 设计规范对照页 + 一个隐藏小游戏（免壳全屏）。 */
export const router = createBrowserRouter([
  {
    path: '/game',
    element: <Game />,
  },
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Home /> },
      { path: 'coins', element: <Browse /> },
      { path: 'coins/:slug', element: <CoinDetail /> },
      { path: 'timeline', element: <Timeline /> },
      { path: 'evolution', element: <Evolution /> },
      { path: 'terms', element: <Terms /> },
      { path: 'compare', element: <Compare /> },
      { path: 'search', element: <Search /> },
      { path: 'about', element: <About /> },
      { path: 'design', element: <DesignTokens /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
