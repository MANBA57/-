import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useCompareList } from '@/lib/compare'

const PREF_KEY = 'coinmuseum:bgm'

/**
 * 背景音乐《泉韵》—— 古琴意象的原创合成曲（public/music/bgm.m4a）。
 * 封面即用户提供的红底方孔钱视觉。唱片式缓旋表达播放态。
 * 记忆开关状态；自动播放被 WebView 拦截时，等用户第一次点页面再续播。
 */
export default function MusicPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const compareList = useCompareList()
  const { pathname } = useLocation()

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)

    const ac = new AbortController()
    if (localStorage.getItem(PREF_KEY) === 'on') {
      el.play().catch(() => {
        // 自动播放被拒：等一次任意手势后开播（once 触发即自动移除）
        window.addEventListener('pointerdown', () => void el.play(), {
          once: true,
          signal: ac.signal,
        })
      })
    }
    return () => {
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      ac.abort()
    }
  }, [])

  const toggle = () => {
    const el = audioRef.current
    if (!el) return
    if (el.paused) {
      localStorage.setItem(PREF_KEY, 'on')
      void el.play()
    } else {
      localStorage.setItem(PREF_KEY, 'off')
      el.pause()
    }
  }

  // 对比条出现时上移避让（它横跨底部居中）
  const lift = compareList.length > 0 && pathname !== '/compare'

  return (
    <>
      <audio ref={audioRef} src="/music/bgm.m4a" loop preload="auto" />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? '暂停背景音乐' : '播放背景音乐《泉韵》'}
        title="《泉韵》 · 古琴"
        className={[
          'fixed right-4 z-40 h-11 w-11 overflow-hidden rounded-full',
          'transition-[bottom] duration-300 md:right-7',
          lift
            ? 'bottom-[calc(49px+env(safe-area-inset-bottom,0px)+78px)] md:bottom-[100px]'
            : 'bottom-[calc(49px+env(safe-area-inset-bottom,0px)+12px)] md:bottom-7',
          playing ? 'disc-spin' : '',
        ].join(' ')}
        style={{ border: '1px solid var(--color-hairline)', boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}
      >
        <img
          src="/music/cover.jpg"
          alt=""
          className={`h-full w-full object-cover ${playing ? '' : 'opacity-90'}`}
        />
        <span
          className="absolute inset-0 flex items-center justify-center bg-black/25 text-white transition-opacity"
          style={{ opacity: playing ? 0 : 1 }}
          aria-hidden="true"
        >
          <svg width="14" height="14" viewBox="0 0 24 24">
            <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
          </svg>
        </span>
        {playing ? (
          <span
            className="absolute inset-0 flex items-center justify-center bg-black/10 text-white opacity-0 transition-opacity hover:opacity-100"
            aria-hidden="true"
          >
            <svg width="13" height="13" viewBox="0 0 24 24">
              <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" />
            </svg>
          </span>
        ) : null}
      </button>
    </>
  )
}
