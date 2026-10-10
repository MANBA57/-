import { useCallback, useEffect, useRef, useState } from 'react'
import type { ImageOut } from '@/api/types'

const MIN_SCALE = 1
const MAX_SCALE = 5

type Props = {
  images: ImageOut[]
  index: number
  alt: string
  onClose: () => void
  onIndexChange: (i: number) => void
}

/**
 * 图片查看器：滚轮/双指缩放、拖拽平移、键盘翻页。
 * 不引入第三方库 —— 需要的交互就这么点。
 */
export default function ImageViewer({ images, index, alt, onClose, onIndexChange }: Props) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const boxRef = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; scale: number } | null>(null)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  const image = images[index]

  const reset = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  // 切图时复位
  useEffect(() => {
    reset()
  }, [index, reset])

  const clampOffset = useCallback(
    (next: { x: number; y: number }, s: number) => {
      const box = boxRef.current
      if (!box) return next
      const maxX = ((s - 1) * box.clientWidth) / 2
      const maxY = ((s - 1) * box.clientHeight) / 2
      return {
        x: Math.max(-maxX, Math.min(maxX, next.x)),
        y: Math.max(-maxY, Math.min(maxY, next.y)),
      }
    },
    [],
  )

  const zoomTo = useCallback(
    (next: number, origin?: { x: number; y: number }) => {
      const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next))
      setScale(s)
      setOffset((prev) => (s === 1 ? { x: 0, y: 0 } : clampOffset(origin ?? prev, s)))
    },
    [clampOffset],
  )

  // 键盘：Esc 关闭、左右翻页
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' && index < images.length - 1) onIndexChange(index + 1)
      if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1)
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [index, images.length, onClose, onIndexChange])

  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale }
    } else if (pointers.current.size === 1) {
      drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      zoomTo((pinch.current.scale * dist) / pinch.current.dist)
      return
    }

    if (pointers.current.size === 1 && drag.current && scale > 1) {
      const dx = e.clientX - drag.current.x
      const dy = e.clientY - drag.current.y
      setOffset(clampOffset({ x: drag.current.ox + dx, y: drag.current.oy + dy }, scale))
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) drag.current = null
  }

  if (!image) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${alt} 图片查看器`}
      className="fixed inset-0 z-[100] flex flex-col bg-dark"
      style={{ touchAction: 'none' }}
    >
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-4 py-3 text-on-dark md:px-8">
        <div className="text-small text-on-dark/70">
          {alt}
          {images.length > 1 ? (
            <span className="ml-3 tabular-nums">
              {index + 1} / {images.length}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-full px-3 py-1.5 text-small text-on-dark/80 hover:bg-white/10"
            onClick={() => zoomTo(scale > 1 ? 1 : 2.5)}
          >
            {scale > 1 ? '还原' : '放大'}
          </button>
          <button
            type="button"
            aria-label="关闭"
            className="rounded-full px-3 py-1.5 text-small text-on-dark/80 hover:bg-white/10"
            onClick={onClose}
          >
            关闭 ✕
          </button>
        </div>
      </div>

      {/* 图片区 */}
      <div
        ref={boxRef}
        className="relative flex flex-1 select-none items-center justify-center overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => zoomTo(scale > 1 ? 1 : 2.5)}
        onWheel={(e) => {
          e.preventDefault()
          zoomTo(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15))
        }}
      >
        <picture>
          <source srcSet={image.avif} type="image/avif" />
          <img
            src={image.webp}
            alt={alt}
            draggable={false}
            className="max-h-full max-w-full object-contain transition-transform duration-100"
            style={{
              transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
              cursor: scale > 1 ? 'grab' : 'zoom-in',
            }}
          />
        </picture>

        {images.length > 1 ? (
          <>
            <button
              type="button"
              aria-label="上一张"
              disabled={index === 0}
              onClick={() => onIndexChange(index - 1)}
              className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/15 px-4 py-6 text-on-dark disabled:opacity-20 hover:bg-white/25"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="下一张"
              disabled={index === images.length - 1}
              onClick={() => onIndexChange(index + 1)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/15 px-4 py-6 text-on-dark disabled:opacity-20 hover:bg-white/25"
            >
              ›
            </button>
          </>
        ) : null}
      </div>

      {/* 缩略图条 */}
      {images.length > 1 ? (
        <div className="flex justify-center gap-3 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-4">
          {images.map((im, i) => (
            <button
              key={im.order}
              type="button"
              aria-label={`第 ${i + 1} 张`}
              onClick={() => onIndexChange(i)}
              className="h-14 w-14 overflow-hidden rounded-thumb"
              style={{ outline: i === index ? '2px solid #fff' : 'none', outlineOffset: 2 }}
            >
              <img src={im.thumb_webp} alt="" className="h-full w-full object-contain" />
            </button>
          ))}
        </div>
      ) : (
        <div className="pb-[max(16px,env(safe-area-inset-bottom))]" />
      )}
    </div>
  )
}
