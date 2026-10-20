import { useNavigate, useSearchParams } from 'react-router-dom'
import GameCanvas from '@/game/GameCanvas'

/** 秘境寻泉：隐藏像素小游戏。?debug=level:N 可直跳关卡（验证用）。 */
export default function Game() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const raw = params.get('debug')
  const n = raw !== null && raw.startsWith('level:') ? Number.parseInt(raw.slice(6), 10) : Number.NaN
  const start = Number.isFinite(n) ? Math.min(6, Math.max(0, n - 1)) : 0

  return (
    <GameCanvas
      startLevel={start}
      onExit={() => {
        if (window.history.length > 1) navigate(-1)
        else navigate('/', { replace: true })
      }}
    />
  )
}
