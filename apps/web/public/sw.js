/* eslint-env serviceworker */
/**
 * Service Worker：让展馆在断网时仍可浏览已看过的内容。
 *
 * 缓存策略按资源性质分开 —— 一刀切要么永远看到旧页面，要么离线什么都打不开：
 *   HTML（导航请求）  network-first  ：优先拿新版本，断网回退缓存
 *   /assets/*        cache-first    ：Vite 产物带内容哈希，永不失效
 *   /images/*        cache-first    ：钱币图片，带容量上限的 LRU
 *   /api/*           network-first  ：数据要新；断网回退到上次成功响应
 *   其余             直接放行
 *
 * 不用 Workbox：策略就这么四条，手写更透明，也省一个依赖和几十 KB。
 */

const VERSION = 'v1'
const SHELL = `shell-${VERSION}`
const ASSETS = `assets-${VERSION}`
const IMAGES = `images-${VERSION}`
const API = `api-${VERSION}`

const SHELL_PRECACHE = ['/', '/index.html', '/manifest.webmanifest']

// 图片缓存上限。单张缩略图约 8 KB、原图约 150 KB，
// 400 条大约 30 MB 量级，对手机是合理上限。
const IMAGE_CACHE_MAX = 400

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL)
      // 逐个 add：任一失败不应让整次安装失败
      await Promise.all(
        SHELL_PRECACHE.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => undefined)),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, ASSETS, IMAGES, API])
      const names = await caches.keys()
      await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

async function trimCache(name, max) {
  const cache = await caches.open(name)
  const keys = await cache.keys()
  if (keys.length <= max) return
  // 按插入顺序淘汰最早的若干条
  await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)))
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName)
  try {
    const res = await fetch(request)
    if (res && res.ok) cache.put(request, res.clone())
    return res
  } catch (err) {
    const hit = await cache.match(request)
    if (hit) return hit
    if (fallbackUrl) {
      const shell = await caches.open(SHELL)
      const fb = await shell.match(fallbackUrl)
      if (fb) return fb
    }
    throw err
  }
}

async function cacheFirst(request, cacheName, max) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit) return hit
  const res = await fetch(request)
  if (res && res.ok) {
    await cache.put(request, res.clone())
    if (max) trimCache(cacheName, max)
  }
  return res
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // SPA 导航：network-first，断网时回退到缓存的外壳
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL, '/index.html'))
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, ASSETS))
    return
  }
  if (url.pathname.startsWith('/images/')) {
    event.respondWith(cacheFirst(request, IMAGES, IMAGE_CACHE_MAX))
    return
  }
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, API))
    return
  }
  if (url.pathname === '/manifest.webmanifest' || url.pathname === '/favicon.svg') {
    event.respondWith(cacheFirst(request, SHELL))
  }
})

/**
 * 「一键离线缓存全库」：关于页的按钮会发来一批 URL。
 * 逐个抓取并写进对应的缓存，边抓边回报进度。
 */
self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || data.type !== 'PRECACHE' || !Array.isArray(data.urls)) return

  const target = event.source
  event.waitUntil(
    (async () => {
      let done = 0
      const total = data.urls.length
      for (const u of data.urls) {
        try {
          const res = await fetch(u, { cache: 'reload' })
          if (res && res.ok) {
            const name = u.startsWith('/api/') ? API : u.startsWith('/images/') ? IMAGES : SHELL
            const cache = await caches.open(name)
            await cache.put(new Request(u), res.clone())
          }
        } catch {
          /* 单条失败不影响整批 */
        }
        done += 1
        if (done % 5 === 0 || done === total) {
          target?.postMessage({ type: 'PRECACHE_PROGRESS', done, total })
        }
      }
      await trimCache(IMAGES, IMAGE_CACHE_MAX)
      target?.postMessage({ type: 'PRECACHE_DONE', total })
    })(),
  )
})
