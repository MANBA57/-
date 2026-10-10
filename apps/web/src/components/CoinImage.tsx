import { useState } from 'react'
import type { ImageOut } from '@/api/types'

type Props = {
  image: ImageOut
  alt: string
  /** thumb = 卡片缩略图；full = 详情大图 */
  kind?: 'thumb' | 'full'
  className?: string
  priority?: boolean
}

/**
 * 钱币图片。用 <picture> 输出 AVIF 主格式 + WebP 回退。
 *
 * 三个细节：
 *  1. 显式给出 width/height（后端实测值），让浏览器预留高度，避免加载时抖动；
 *  2. LQIP（后端生成的 16px base64）做模糊占位，**真图加载完成后淡出** ——
 *     不能只靠 DOM 顺序指望真图盖在上面：LQIP 带 filter/transform 会自建层叠上下文，
 *     实测它会把真图整个糊住；
 *  3. 全站禁用阴影，层次只靠圆角与底色差。
 */
export default function CoinImage({ image, alt, kind = 'thumb', className = '', priority }: Props) {
  const [loaded, setLoaded] = useState(false)
  const avif = kind === 'thumb' ? image.thumb_avif : image.avif
  const webp = kind === 'thumb' ? image.thumb_webp : image.webp
  const ratio = image.aspect_ratio ?? (image.width && image.height ? image.width / image.height : 1)

  return (
    <div
      className={`relative overflow-hidden bg-page ${className}`}
      style={{ aspectRatio: String(ratio) }}
    >
      {image.lqip ? (
        <img
          src={image.lqip}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl transition-opacity duration-500"
          style={{ opacity: loaded ? 0 : 1 }}
        />
      ) : null}
      <picture>
        <source srcSet={avif} type="image/avif" />
        <source srcSet={webp} type="image/webp" />
        <img
          src={webp}
          alt={alt}
          width={image.width ?? undefined}
          height={image.height ?? undefined}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : 'auto'}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
          className="relative z-10 h-full w-full object-contain"
        />
      </picture>
    </div>
  )
}
