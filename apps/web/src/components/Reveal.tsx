import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

/**
 * 滚动入场动画容器：进入视口后上浮 + 失焦到清晰（参考 apple.com 的区块入场）。
 *
 * 触发有两条通道，谁先到谁生效：
 *  1. IntersectionObserver —— 正常浏览器的标准路径；
 *  2. 定时器 + getBoundingClientRect 直接几何判断 —— 兜底。
 *     部分挂起渲染帧的环境（后台 WebView、极端省电模式）里 IO/rAF 永不回调，
 *     若无兜底内容会永久停留在 opacity:0。
 * 只播一次；prefers-reduced-motion 下不注册任何观察器，内容直接可见。
 */
export default function Reveal({
  children,
  delay = 0,
  className = '',
  style,
}: {
  children: ReactNode
  /** 交错延迟（毫秒），用于网格内按次序入场 */
  delay?: number
  className?: string
  style?: CSSProperties
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisible(true)
      return
    }

    let done = false
    let timer = 0
    let stopFallback = 0

    const cleanup = () => {
      io.disconnect()
      window.clearInterval(timer)
      window.clearTimeout(stopFallback)
    }
    const reveal = () => {
      if (done) return
      done = true
      cleanup()
      setVisible(true)
    }
    const inView = () => {
      const r = el.getBoundingClientRect()
      // 与 IO 的 rootMargin(底边 -6%) 保持同一条触发线
      return r.top < window.innerHeight * 0.94 && r.bottom > 0
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) reveal()
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    )
    io.observe(el)

    timer = window.setInterval(() => {
      if (inView()) reveal()
    }, 350)
    // 页面久置后停止轮询，避免常驻定时器
    stopFallback = window.setTimeout(() => window.clearInterval(timer), 15_000)

    return cleanup
  }, [])

  return (
    <div
      ref={ref}
      className={`reveal ${visible ? 'is-visible' : ''} ${className}`.trim()}
      style={{ transitionDelay: `${delay}ms`, ...style }}
    >
      {children}
    </div>
  )
}
