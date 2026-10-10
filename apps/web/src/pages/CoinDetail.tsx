import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useCoin } from '@/api/hooks'
import CoinImage from '@/components/CoinImage'
import ImageViewer from '@/components/ImageViewer'
import RichText from '@/components/RichText'
import SourceBadge from '@/components/SourceBadge'
import CoinCard from '@/components/CoinCard'
import { ErrorState, Skeleton } from '@/components/States'
import { COMPARE_MAX, compareStore, useCompareList } from '@/lib/compare'
import { formatGram, formatMm, formatYear, SOURCE_HINT } from '@/lib/format'

/**
 * 钱币详情。版式照搬参考的商品详情页：**左信息 / 右大图** 双栏，
 * 移动端堆叠为单列，操作按钮固定底部。
 */
export default function CoinDetail() {
  const { slug = '' } = useParams()
  const decoded = decodeURIComponent(slug)
  const coin = useCoin(decoded)
  const compareList = useCompareList()
  const [searchParams, setSearchParams] = useSearchParams()
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [activeImage, setActiveImage] = useState(0)

  // 深链：?image=2 直接打开第 2 张图的查看器（也方便分享某个细节图）
  const imageParam = searchParams.get('image')
  useEffect(() => {
    if (imageParam === null) return
    const n = Number(imageParam)
    if (Number.isInteger(n) && n >= 1) {
      setActiveImage(n - 1)
      setViewerIndex(n - 1)
    }
  }, [imageParam])

  const closeViewer = () => {
    setViewerIndex(null)
    if (searchParams.has('image')) {
      const next = new URLSearchParams(searchParams)
      next.delete('image')
      setSearchParams(next, { replace: true })
    }
  }

  if (coin.isError) {
    const notFound = (coin.error as { status?: number })?.status === 404
    return (
      <div className="container-page py-section">
        <ErrorState
          title={notFound ? '没有找到这枚钱币' : '钱币详情加载失败'}
          detail={notFound ? `slug「${decoded}」在库中不存在。` : (coin.error as Error)?.message}
          onRetry={() => void coin.refetch()}
        />
      </div>
    )
  }

  if (coin.isPending || !coin.data) {
    return (
      <div className="container-page py-section">
        <div className="grid gap-12 md:grid-cols-[minmax(0,44%)_minmax(0,56%)]">
          <div>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-4 h-10 w-3/4" />
            <Skeleton className="mt-6 h-5 w-1/2" />
            <Skeleton className="mt-10 h-40 w-full" />
          </div>
          <Skeleton className="h-[380px] w-full rounded-card" />
        </div>
      </div>
    )
  }

  const c = coin.data
  const inCompare = compareList.includes(c.slug)
  const params: Array<{ label: string; value: string | null }> = [
    { label: '直径', value: formatMm(c.diameter_mm) },
    { label: '通长', value: formatMm(c.length_mm) },
    { label: '重量', value: formatGram(c.weight_g) },
    { label: '材质', value: c.materials.length ? c.materials.join(' · ') : null },
    { label: '国别', value: c.states.length ? c.states.join(' · ') : null },
    { label: '记重单位', value: c.units.length ? c.units.join(' · ') : null },
    { label: '面文', value: c.inscription_front },
    { label: '背文', value: c.inscription_back },
    { label: '存世', value: c.rarity },
    { label: '文献提及年份', value: formatYear(c.year_mentioned) },
  ].filter((p) => p.value)

  const active = c.images[activeImage] ?? c.images[0]

  return (
    <div className="pb-section">
      {/* 面包屑 */}
      <nav className="container-page pt-8 text-small text-ink-muted" aria-label="面包屑">
        <Link to="/coins" className="link">
          钱币库
        </Link>
        <span className="mx-2">/</span>
        <Link to={`/coins?category=${c.category.key}`} className="link">
          {c.category.name}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-ink">{c.name}</span>
      </nav>

      <div className="container-page mt-8 grid gap-12 md:grid-cols-[minmax(0,44%)_minmax(0,56%)] md:gap-16">
        {/* ===== 左：信息栏 ===== */}
        <div className="md:sticky md:top-[72px] md:self-start">
          <div className="flex flex-wrap items-center gap-2">
            {c.rarity ? <span className="marker">{c.rarity}</span> : null}
            <SourceBadge source={c.period_source} />
          </div>

          <h1 className="mt-3 text-display text-ink">{c.name}</h1>
          {c.alias ? <p className="mt-2 text-body text-ink-muted">又称 {c.alias}</p> : null}

          <p className="mt-4 text-subtitle text-ink">
            {[c.period_key, c.states.join('·')].filter(Boolean).join(' · ')}
          </p>
          {c.period_source && c.period_source !== 'auto' ? (
            <p className="mt-2 text-small text-ink-muted" title={SOURCE_HINT[c.period_source]}>
              时期标注：{SOURCE_HINT[c.period_source]}
            </p>
          ) : null}

          {/* 参数表：只有有值的字段才展示，不留空白项 */}
          {params.length ? (
            <dl className="mt-8 divide-y" style={{ borderColor: 'var(--color-hairline-soft)' }}>
              {params.map((p) => (
                <div key={p.label} className="flex justify-between gap-6 py-3">
                  <dt className="text-small text-ink-muted">{p.label}</dt>
                  <dd className="text-right text-small text-ink">{p.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          <div className="mt-8 flex flex-wrap gap-3">
            {c.images.length ? (
              <button type="button" className="btn btn-primary" onClick={() => setViewerIndex(activeImage)}>
                查看大图
              </button>
            ) : (
              <span className="text-small text-ink-muted">原文未提供配图</span>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!inCompare && compareList.length >= COMPARE_MAX}
              onClick={() => compareStore.toggle(c.slug)}
            >
              {inCompare ? '移出对比' : '加入对比'}
            </button>
          </div>

          {c.overridden_fields.length ? (
            <p className="mt-6 text-small text-ink-muted">
              以下字段由编辑补充、原文未提及：{c.overridden_fields.join('、')}
            </p>
          ) : null}
        </div>

        {/* ===== 右：图片区 ===== */}
        <div>
          {active ? (
            <>
              <button
                type="button"
                className="card block w-full cursor-zoom-in"
                onClick={() => setViewerIndex(activeImage)}
                aria-label="查看大图"
              >
                <CoinImage image={active} alt={c.name} kind="full" priority className="rounded-card" />
              </button>
              {c.images.length > 1 ? (
                <div className="mt-4 flex gap-3">
                  {c.images.map((im, i) => (
                    <button
                      key={im.order}
                      type="button"
                      aria-label={`查看第 ${i + 1} 张`}
                      onClick={() => setActiveImage(i)}
                      className="h-16 w-16 overflow-hidden rounded-thumb bg-page"
                      style={{
                        outline: i === activeImage ? '2px solid var(--color-accent)' : 'none',
                        outlineOffset: 2,
                      }}
                    >
                      <img src={im.thumb_webp} alt="" className="h-full w-full object-contain" />
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="card flex h-[320px] items-center justify-center">
              <span className="text-small text-ink-muted">原文未提供配图</span>
            </div>
          )}
        </div>
      </div>

      {/* ===== 科普正文 ===== */}
      <section className="container-page mt-section">
        <h2 className="text-title text-ink">简介</h2>
        <div className="mt-6 max-w-[68ch]">
          <RichText text={c.description_md} />
        </div>
      </section>

      {/* ===== 同体系钱币 ===== */}
      {c.related.length ? (
        <section className="mt-section">
          <div className="container-page flex flex-wrap items-end justify-between gap-4">
            <h2 className="text-title text-ink">同体系钱币</h2>
            <Link to={`/coins?category=${c.category.key}`} className="link text-small">
              查看「{c.category.name}」全部 ›
            </Link>
          </div>
          <div className="container-page mt-8 grid grid-cols-1 gap-card sm:grid-cols-2 lg:grid-cols-4">
            {c.related.map((r) => (
              <CoinCard
                key={r.slug}
                coin={r}
                inCompare={compareList.includes(r.slug)}
                compareFull={compareList.length >= COMPARE_MAX}
                onToggleCompare={(s) => compareStore.toggle(s)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {viewerIndex !== null ? (
        <ImageViewer
          images={c.images}
          index={viewerIndex}
          alt={c.name}
          onClose={closeViewer}
          onIndexChange={(i) => {
            setViewerIndex(i)
            setActiveImage(i)
          }}
        />
      ) : null}
    </div>
  )
}
