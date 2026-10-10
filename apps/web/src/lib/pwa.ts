/**
 * Service Worker 注册与「离线缓存全库」的调用封装。
 *
 * 只在生产构建下注册：开发时 SW 会拦截请求，反而让 HMR 行为变得难以预测。
 * Capacitor 的 WebView 里同样适用（它支持 SW），但后端在远端时预缓存意义不大，
 * 因此这里不区分环境，由调用方决定要不要触发全库缓存。
 */

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      // 注册失败不应影响站点主流程，只记录
      console.warn('[sw] 注册失败:', err)
    })
  })
}

export type PrecacheProgress = { done: number; total: number }

/**
 * 让 SW 把全库内容抓下来缓存，供断网时浏览。
 * 返回一个可 await 的函数；通过 onProgress 回报进度。
 */
export async function precacheAll(onProgress?: (p: PrecacheProgress) => void): Promise<number> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('当前浏览器不支持 Service Worker')
  }

  // 1) 先把接口数据拿全，才能知道有哪些图片要缓存
  const urls = new Set<string>([
    '/',
    '/coins',
    '/timeline',
    '/evolution',
    '/terms',
    '/about',
    '/api/v1/stats',
    '/api/v1/facets',
    '/api/v1/categories',
    '/api/v1/timeline',
    '/api/v1/evolution',
    '/api/v1/terms',
    '/api/v1/coins?page_size=100',
  ])

  const listRes = await fetch('/api/v1/coins?page_size=100')
  const list = (await listRes.json()) as { items: Array<{ slug: string; thumbnail: unknown }> }

  for (const item of list.items) {
    urls.add(`/api/v1/coins/${encodeURIComponent(item.slug)}`)
    const detailRes = await fetch(`/api/v1/coins/${encodeURIComponent(item.slug)}`)
    const detail = (await detailRes.json()) as {
      images: Array<{ avif: string; webp: string; thumb_avif: string; thumb_webp: string }>
    }
    for (const im of detail.images ?? []) {
      urls.add(im.thumb_webp)
      urls.add(im.thumb_avif)
      urls.add(im.webp)
      urls.add(im.avif)
    }
  }

  // 2) 交给 SW 逐条抓取（页面侧抓会占用主线程，且 SW 能直接写入它自己的缓存）
  const reg = await navigator.serviceWorker.ready
  const target = reg.active ?? reg.waiting ?? reg.installing
  if (!target) throw new Error('Service Worker 尚未就绪')

  const donePromise = new Promise<number>((resolve) => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data
      if (d?.type === 'PRECACHE_PROGRESS') onProgress?.({ done: d.done, total: d.total })
      if (d?.type === 'PRECACHE_DONE') {
        navigator.serviceWorker.removeEventListener('message', onMessage)
        resolve(d.total)
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
  })

  target.postMessage({ type: 'PRECACHE', urls: [...urls] })
  return donePromise
}
