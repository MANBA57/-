import { useEffect, useRef, useState } from 'react'

/**
 * 数字滚动：进入视口后从 0 缓动到目标值（ease-out quart，参考 apple.com 的统计数字）。
 *
 * 动画用定时器驱动而非 requestAnimationFrame —— 渲染帧被挂起的环境（后台 WebView）
 * 里 rAF 不回调，数字会永远停在 0；定时器不受影响。
 * 进入视口的判定同样是 IO 优先、几何轮询兜底。reduced-motion 直接显示终值。
 */
export default function CountUp({ value, className }: { value: number | undefined; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    if (value == null) return
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value)
      return
    }

    let started = false
    let tick = 0
    let fallback = 0
    let stopFallback = 0

    const cleanup = () => {
      io.disconnect()
      window.clearInterval(tick)
      window.clearInterval(fallback)
      window.clearTimeout(stopFallback)
    }
    const run = () => {
      if (started) return
      started = true
      window.clearInterval(fallback)
      io.disconnect()
      const t0 = Date.now()
      tick = window.setInterval(() => {
        const p = Math.min(1, (Date.now() - t0) / 1400)
        setDisplay(Math.round(value * (1 - Math.pow(1 - p, 4))))
        if (p >= 1) window.clearInterval(tick)
      }, 16)
    }
    const inView = () => {
      const r = el.getBoundingClientRect()
      return r.top < window.innerHeight * 0.9 && r.bottom > 0
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) run()
      },
      { threshold: 0.4 },
    )
    io.observe(el)

    fallback = window.setInterval(() => {
      if (inView()) run()
    }, 350)
    stopFallback = window.setTimeout(() => window.clearInterval(fallback), 15_000)

    return cleanup
  }, [value])

  return (
    <span ref={ref} className={className}>
      {value == null ? '—' : display.toLocaleString()}
    </span>
  )
}
