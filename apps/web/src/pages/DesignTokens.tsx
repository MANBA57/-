/**
 * 设计规范对照页（/design）
 * 用途：P0 验收时逐项比对方案 §7 的实测 token；后续 P3 迭代时用它防止视觉走样。
 */

const COLORS = [
  { name: '页面背景', token: '--color-page', value: '#f5f5f7', note: '实测占参考商店页 89.7%' },
  { name: '内容面', token: '--color-surface', value: '#ffffff', note: '卡片' },
  { name: '深色区块', token: '--color-dark', value: '#000000', note: '全站唯一用纯黑处' },
  { name: '胶囊底', token: '--color-capsule', value: '#e8e8ed', note: '标签胶囊' },
  { name: '主文字', token: '--color-ink', value: '#1d1d1f', note: '实测主文字，非纯黑' },
  { name: '次级文字', token: '--color-ink-muted', value: '#6e6e73', note: '说明文字' },
  { name: '功能主色', token: '--color-accent', value: '#0071e3', note: '全站唯一高饱和色' },
  { name: '链接色', token: '--color-link', value: '#0066cc', note: '文字链' },
  { name: '强调色', token: '--color-mark', value: '#b64400', note: '仅用于 12px 强调标签' },
  { name: '发丝线', token: '--color-hairline', value: '#d2d2d7', note: '1px 分割线' },
]

const TYPE = [
  { cls: 'text-hero', name: 'hero', spec: '112px / 600 / lh 1.05 / ls -0.02em', sample: '数字钱币库' },
  { cls: 'text-display', name: 'display', spec: '48px / 600 / lh 1.2', sample: '四大货币体系' },
  { cls: 'text-title', name: 'title', spec: '28px / 600 / lh 1.25', sample: '空首布' },
  { cls: 'text-subtitle', name: 'subtitle', spec: '21px / 600 / lh 1.3', sample: '三孔布' },
  { cls: 'text-body', name: 'body', spec: '17px / 400 / lh 1.47', sample: '布币源于农具铲，主要流通于黄河中下游的农业地区。' },
  { cls: 'text-small', name: 'small', spec: '14px / 400 / lh 1.5', sample: '辅助说明文字，用于补充信息。' },
  { cls: 'text-micro', name: 'micro', spec: '12px / 400 / lh 1.33', sample: '导航项与标签' },
]

const RADII = [
  { cls: 'rounded-card', name: 'card', value: '22px', note: '卡片（首像素内缩 23px 反推）' },
  { cls: 'rounded-card-sm', name: 'card-sm', value: '12px', note: '选项卡' },
  { cls: 'rounded-btn', name: 'btn', value: '10px', note: '主按钮（内缩 9px 反推）' },
  { cls: 'rounded-thumb', name: 'thumb', value: '8px', note: '缩略图' },
]

function Swatch({ token, value }: { token: string; value: string }) {
  return (
    <div
      className="h-16 w-full rounded-thumb border border-hairline"
      style={{ background: `var(${token})` }}
      title={value}
    />
  )
}

export default function DesignTokens() {
  return (
    <div className="container-page" style={{ paddingBlock: 'var(--spacing-section)' }}>
      <p className="marker">设计规范</p>
      <h1 className="mt-2 text-display">设计系统对照页</h1>
      <p className="mt-4 max-w-[62ch] text-body text-ink-muted">
        全部数值来自对参考截图的像素实测，而非目测。规范铁律：
        <strong className="font-medium text-ink">零阴影、零渐变、全站仅 1 个高饱和色</strong>
        ，层次只靠「圆角 + 1px 发丝线 + 底色差」建立。
      </p>

      {/* 配色 */}
      <h2 className="mt-block text-title">1. 配色</h2>
      <div className="mt-6 grid grid-cols-2 gap-card sm:grid-cols-3 lg:grid-cols-5">
        {COLORS.map((c) => (
          <div key={c.token} className="card p-4">
            <Swatch token={c.token} value={c.value} />
            <p className="mt-3 text-micro text-ink">{c.name}</p>
            <p className="mt-1 font-mono text-[11px] text-ink-muted">{c.value}</p>
            <p className="mt-1 text-[11px] text-ink-muted">{c.note}</p>
          </div>
        ))}
      </div>

      {/* 字体层级 */}
      <h2 className="mt-block text-title">2. 字体层级</h2>
      <div className="mt-6 space-y-4">
        {TYPE.map((t) => (
          <div key={t.name} className="card flex flex-col gap-2 p-6 md:flex-row md:items-baseline md:gap-8">
            <div className="w-[190px] shrink-0">
              <p className="font-mono text-micro text-ink">.{t.cls}</p>
              <p className="mt-1 text-[11px] text-ink-muted">{t.spec}</p>
            </div>
            <p className={`${t.cls} min-w-0 text-ink`}>{t.sample}</p>
          </div>
        ))}
      </div>

      {/* 圆角 */}
      <h2 className="mt-block text-title">3. 圆角</h2>
      <div className="mt-6 grid grid-cols-2 gap-card lg:grid-cols-4">
        {RADII.map((r) => (
          <div key={r.name} className="card p-5">
            <div className={`h-20 w-full bg-page ${r.cls}`} />
            <p className="mt-3 font-mono text-micro text-ink">.{r.cls}</p>
            <p className="mt-1 text-[11px] text-ink-muted">
              {r.value} · {r.note}
            </p>
          </div>
        ))}
      </div>

      {/* 组件 */}
      <h2 className="mt-block text-title">4. 组件</h2>
      <div className="mt-6 grid grid-cols-1 gap-card lg:grid-cols-2">
        <div className="card p-7">
          <p className="text-micro text-ink-muted">按钮 · 主按钮高 53px / 圆角 10px / 无阴影</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-primary">
              加入对比
            </button>
            <button type="button" className="btn btn-secondary">
              查看大图
            </button>
          </div>
        </div>

        <div className="card p-7">
          <p className="text-micro text-ink-muted">标签 · 胶囊 12px / 强调标记 12px 600</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="capsule">布币</span>
            <span className="capsule">战国</span>
            <span className="capsule">青铜</span>
            <span className="marker">存世极少</span>
          </div>
        </div>

        <div className="hairline-box p-7">
          <p className="text-micro text-ink-muted">选项卡 · 1px #d2d2d7 细边框</p>
          <p className="mt-3 text-subtitle text-ink">同体系钱币</p>
          <p className="mt-2 text-small text-ink-muted">空首布 · 桥足布 · 尖足布 · 方足布</p>
        </div>

        <div className="card p-7">
          <p className="text-micro text-ink-muted">文字链接</p>
          <div className="mt-4 flex flex-col gap-2">
            <a className="link text-body" href="#top">
              浏览全部钱币 ›
            </a>
            <a className="link text-small" href="#top">
              查看数据来源 ›
            </a>
          </div>
        </div>
      </div>

      {/* 间距 */}
      <h2 className="mt-block text-title">5. 间距与留白</h2>
      <div className="card mt-6 p-7">
        <ul className="space-y-3 text-small text-ink">
          <li>
            <code className="font-mono text-micro">--spacing-section: 100px</code> —— 区块竖向留白（实测
            80–120px），移动端降级为 48px
          </li>
          <li>
            <code className="font-mono text-micro">--spacing-block: 40px</code> —— 区块内主要间距
          </li>
          <li>
            <code className="font-mono text-micro">--spacing-card: 22px</code> —— 卡片间隙（实测 29px /
            卡宽 470px ≈ 6%）
          </li>
          <li>
            <code className="font-mono text-micro">.container-page</code> —— 左右留白 5.3%（实测 131px /
            2473px），内容最大宽 1680px
          </li>
        </ul>
      </div>
    </div>
  )
}
