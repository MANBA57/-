import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStats } from '@/api/hooks'
import { formatBytes, formatCount } from '@/lib/format'
import { precacheAll, type PrecacheProgress } from '@/lib/pwa'

const TECH = [
  { k: '前端', v: 'React 19 · Vite 8 · TypeScript · Tailwind CSS 4' },
  { k: '后端', v: 'Python 3.12 · FastAPI · SQLite（FTS5 全文检索）' },
  { k: '图片', v: 'AVIF + WebP 双格式 · LQIP 占位 · 长边 1600px' },
  { k: '移动端', v: '移动优先响应式 · Service Worker 离线缓存' },
  { k: '安卓', v: 'Capacitor 打包（HTML5 外壳，非原生重写）' },
  { k: '部署', v: 'Docker Compose · Caddy 自动 HTTPS' },
]

/** 关于页。给评委看的一页：作品定位、数据来源、技术栈、诚信说明。 */
export default function About() {
  const stats = useStats()
  const navigate = useNavigate()
  const [progress, setProgress] = useState<PrecacheProgress | null>(null)
  const [offlineState, setOfflineState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [offlineMsg, setOfflineMsg] = useState('')

  async function handlePrecache() {
    setOfflineState('running')
    setOfflineMsg('')
    setProgress({ done: 0, total: 0 })
    try {
      const n = await precacheAll((p) => setProgress(p))
      setOfflineState('done')
      setOfflineMsg(`已缓存 ${n} 项，现在断网也能浏览全库。`)
    } catch (err) {
      setOfflineState('error')
      setOfflineMsg((err as Error).message)
    }
  }

  return (
    <div className="container-page pt-[72px] pb-section md:pt-[100px]">
      <p className="marker">关于</p>
      <h1 className="mt-2 text-display max-w-[18ch]">一个可检索的先秦货币图谱。</h1>
      <p className="mt-6 max-w-[58ch] text-body text-ink">
        先秦时期（秦统一之前）是中国货币从萌芽走向成熟的阶段。各诸侯国地理环境、
        生产方式与文化传统不同，货币因此分化成布币、刀币、圜钱、贝币四大体系。
        本站把这段货币史整理成可检索、可对比、可沿时间轴浏览的数字展馆。
      </p>

      {/* 数据 */}
      <section className="mt-section">
        <h2 className="text-title text-ink">数据</h2>
        <dl className="mt-6 grid grid-cols-2 gap-card md:grid-cols-4">
          {[
            { k: '钱币条目', v: stats.data ? formatCount(stats.data.coin_count) : '—' },
            { k: '货币体系', v: stats.data ? formatCount(stats.data.category_count) : '—' },
            { k: '图像', v: stats.data ? formatCount(stats.data.image_count) : '—' },
            { k: '术语', v: stats.data ? formatCount(stats.data.term_count) : '—' },
          ].map((s) => (
            <div key={s.k} className="card px-6 py-7">
              <dt className="text-micro text-ink-muted">{s.k}</dt>
              <dd className="mt-1 text-title text-ink">{s.v}</dd>
            </div>
          ))}
        </dl>

        {stats.data ? (
          <p className="mt-6 max-w-[62ch] text-small text-ink-muted">
            原始图片共 {formatBytes(stats.data.source_bytes)}，经 AVIF/WebP 压缩后为{' '}
            {formatBytes(stats.data.image_bytes)}
            {stats.data.compression_ratio ? `（约 ${stats.data.compression_ratio}×）` : ''}，
            在移动网络下也能较快打开。时间跨度：{stats.data.period_span}。
          </p>
        ) : null}
      </section>

      {/* 诚信说明 —— 这是本站刻意做的设计 */}
      <section className="mt-section">
        <h2 className="text-title text-ink">数据来源与推断标注</h2>
        <div className="mt-6 max-w-[62ch] space-y-4 text-body text-ink">
          <p>
            条目的名称、形制描述与配图来自课程整理的原稿。原稿是散文体，其中尺寸、重量、
            国别、时期等信息散落在正文里，由本站的解析管线自动抽取。
          </p>
          <p>
            <strong className="font-semibold">凡是原文没有明确写出的信息，界面上都会标出来：</strong>
          </p>
          <ul className="space-y-3 text-small">
            <li className="card p-5">
              <span className="marker">据原文推断</span>
              <p className="mt-2 text-ink-muted">
                原文只给了「战国」这类泛称，或只给了公元前年份，由此推算出的时期。
              </p>
            </li>
            <li className="card p-5">
              <span className="marker">编辑补充</span>
              <p className="mt-2 text-ink-muted">
                原文完全未提及，由编辑依据史实补写，需要进一步核实。
              </p>
            </li>
          </ul>
          <p className="text-small text-ink-muted">
            没有标注的字段即为原文直接写明的内容。我们认为，展馆类作品宁可把不确定性说清楚，
            也不该把推断包装成史实。
          </p>
        </div>
      </section>

      {/* 技术 */}
      <section className="mt-section">
        <h2 className="text-title text-ink">技术实现</h2>
        <dl className="mt-6 grid grid-cols-1 gap-card md:grid-cols-2">
          {TECH.map((t) => (
            <div key={t.k} className="card flex flex-col gap-1 p-6 md:flex-row md:items-baseline md:gap-6">
              <dt className="w-[72px] shrink-0 text-micro text-ink-muted">{t.k}</dt>
              <dd className="text-small text-ink">{t.v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 max-w-[62ch] text-small text-ink-muted">
          中文全文检索有个坑：SQLite FTS5 的内置分词器对中文都不好用 ——
          <code className="mx-1 rounded bg-capsule px-1.5 py-0.5 text-[12px]">unicode61</code>
          会把整串中文当成一个词，
          <code className="mx-1 rounded bg-capsule px-1.5 py-0.5 text-[12px]">trigram</code>
          又要求查询至少三个字（「刀币」这种双字词直接搜不到）。
          本站的做法是在建索引时把汉字逐字拆开，检索时把「青铜」拼成短语
          <code className="mx-1 rounded bg-capsule px-1.5 py-0.5 text-[12px]">"青 铜"</code>
          ，于是单字、双字、多字查询都能命中。
        </p>
      </section>

      {/* 离线演示 —— 现场答辩断网时的保险 */}
      <section className="mt-section">
        <h2 className="text-title text-ink">离线浏览</h2>
        <p className="mt-4 max-w-[62ch] text-body text-ink">
          本站注册了 Service Worker：看过的页面、钱币图片与接口结果都会留在本地。
          断网后仍能翻已看过的内容 —— 现场演示时网络不稳也不至于开天窗。
        </p>
        <div className="card mt-6 flex flex-col gap-4 p-7 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-subtitle text-ink">一键缓存全库</p>
            <p className="mt-1 text-small text-ink-muted" aria-live="polite">
              {offlineState === 'running' && progress
                ? `正在缓存… ${progress.total ? `${progress.done} / ${progress.total}` : '准备中'}`
                : offlineMsg || `把 ${stats.data?.coin_count ?? '全部'} 条钱币的文字与图片全部存到本地`}
            </p>
            {offlineState === 'running' && progress?.total ? (
              <div className="mt-3 h-1.5 w-full max-w-[320px] overflow-hidden rounded-full bg-capsule">
                <div
                  className="h-full rounded-full transition-[width] duration-200"
                  style={{
                    width: `${Math.round((progress.done / progress.total) * 100)}%`,
                    backgroundColor: 'var(--color-accent)',
                  }}
                />
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-primary shrink-0"
            disabled={offlineState === 'running'}
            onClick={() => void handlePrecache()}
          >
            {offlineState === 'running' ? '缓存中…' : offlineState === 'done' ? '重新缓存' : '开始缓存'}
          </button>
        </div>
      </section>

      <div className="mt-12 flex flex-wrap gap-3">
        <Link to="/coins" className="btn btn-primary">
          进入钱币库
        </Link>
        <Link to="/evolution" className="btn btn-secondary">
          看体系演化
        </Link>
      </div>

      {/* 彩蛋：一枚像素铜钱，点一点有惊喜 */}
      <div className="mt-14 flex justify-center">
        <button
          type="button"
          aria-label="像素铜钱"
          className="game-egg-coin"
          onClick={() => navigate('/game')}
        >
          <svg width="26" height="26" viewBox="0 0 8 8" aria-hidden="true" shapeRendering="crispEdges">
            <g fill="#b9bdc7">
              <rect x="2" y="0" width="4" height="1" />
              <rect x="1" y="1" width="6" height="1" />
              <rect x="0" y="2" width="8" height="4" />
              <rect x="1" y="6" width="6" height="1" />
              <rect x="2" y="7" width="4" height="1" />
            </g>
            <rect x="3" y="3" width="2" height="2" fill="#f5f5f7" />
          </svg>
        </button>
      </div>
    </div>
  )
}
