#!/usr/bin/env node
/**
 * 构建期预渲染：为每条路由生成带独立元数据与正文的静态 HTML，
 * 并产出 sitemap.xml 与 robots.txt。
 *
 * 为什么不做完整 SSR：
 *   完整 SSR 要在构建时把 React 组件渲染成 HTML，需要预取接口数据，
 *   于是前端构建就依赖后端正在运行 —— 构建变脆，收益却有限
 *   （本站是展馆型内容，主要靠分享链接与搜索收录，不靠首屏 SEO 转化）。
 *   这里改为：
 *     1. 每条路由一份独立的 <title>/<meta>/canonical/OG/Twitter/JSON-LD；
 *     2. <noscript> 里放该页的正文，不执行 JS 的爬虫也能读到内容；
 *     3. sitemap.xml + robots.txt。
 *   路由元数据由数据管线的 build_db.py 产出（content/generated/prerender.json），
 *   前端构建因此完全不依赖运行时服务。
 *
 * 用法（package.json 的 build 里已串好）：
 *   node scripts/prerender.mjs
 * 环境变量：
 *   SITE_ORIGIN   站点源，用于 canonical / OG / sitemap，默认 http://localhost:4173
 *   PRERENDER_JSON 元数据路径，默认 ../../services/api/content/generated/prerender.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = resolve(HERE, '..')
const DIST = join(WEB, 'dist')

const SITE_ORIGIN = (process.env.SITE_ORIGIN || 'http://localhost:4173').replace(/\/$/, '')
const META_PATH = resolve(
  process.env.PRERENDER_JSON || join(WEB, '..', '..', 'services', 'api', 'content', 'generated', 'prerender.json'),
)

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const templatePath = join(DIST, 'index.html')
if (!existsSync(templatePath)) {
  console.error('[prerender] ✗ 找不到 dist/index.html，请先执行 vite build')
  process.exit(1)
}
const template = readFileSync(templatePath, 'utf8')

if (!existsSync(META_PATH)) {
  console.warn(`[prerender] ⚠ 找不到 ${META_PATH}，跳过预渲染。`)
  console.warn('[prerender]   先跑：python services/api/scripts/run_pipeline.py')
  process.exit(0)
}
const meta = JSON.parse(readFileSync(META_PATH, 'utf8'))
const site = meta.site || {}
const routes = meta.routes || []

/** 把一条路由的元数据注入模板 */
function buildHtml(route) {
  const url = `${SITE_ORIGIN}${route.path === '/' ? '/' : route.path}`
  const fullTitle = route.title || site.name
  const desc = route.description || site.description || ''

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': route.contentHtml ? 'Thing' : 'WebPage',
    name: fullTitle,
    description: desc,
    inLanguage: site.lang || 'zh-CN',
    isPartOf: { '@type': 'WebSite', name: site.name, url: `${SITE_ORIGIN}/` },
    url,
  }

  const extra = `
    <link rel="canonical" href="${esc(url)}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="${esc(site.name)}" />
    <meta property="og:title" content="${esc(fullTitle)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${esc(url)}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${esc(fullTitle)}" />
    <meta name="twitter:description" content="${esc(desc)}" />
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`

  let html = template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(fullTitle)}</title>`)
    .replace(
      /<meta\s+name="description"[\s\S]*?\/>/,
      `<meta name="description" content="${esc(desc)}" />`,
    )
    .replace('</head>', `${extra}\n  </head>`)

  // 不执行 JS 的爬虫也能读到正文；放在 #root 之外，避免 hydration 不匹配
  if (route.contentHtml) {
    html = html.replace(
      '</body>',
      `  <noscript><h1>${esc(fullTitle)}</h1>${route.contentHtml}</noscript>\n  </body>`,
    )
  }
  return html
}

let written = 0
for (const route of routes) {
  const html = buildHtml(route)
  const outDir = route.path === '/' ? DIST : join(DIST, route.path.replace(/^\//, ''))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'index.html'), html, 'utf8')
  written += 1
}

// ---------------------------------------------------------------- sitemap
const today = new Date().toISOString().slice(0, 10)
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes
  .map(
    (r) => `  <url>
    <loc>${esc(`${SITE_ORIGIN}${r.path}`)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${r.changefreq || 'monthly'}</changefreq>
    <priority>${r.priority || '0.5'}</priority>
  </url>`,
  )
  .join('\n')}
</urlset>
`
writeFileSync(join(DIST, 'sitemap.xml'), sitemap, 'utf8')

writeFileSync(
  join(DIST, 'robots.txt'),
  `User-agent: *\nAllow: /\nDisallow: /design\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`,
  'utf8',
)

console.log(`[prerender] ✓ ${written} 条路由已预渲染  sitemap: ${routes.length} 条`)
console.log(`[prerender]   站点源 ${SITE_ORIGIN}${SITE_ORIGIN.includes('localhost') ? '（本地默认值，部署时应设 SITE_ORIGIN）' : ''}`)
