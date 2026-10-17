/**
 * 全站环境背景：钱币线描剪影以极低透明度缓慢漂移。
 *
 * 规则：
 *  - 纯装饰层 —— pointer-events-none，不参与交互；
 *  - 透明度压在 0.05 左右，远低于文字与卡片，不干扰阅读（Apple 式克制）；
 *  - 动效全部是慢速 transform（46–80s 往返），GPU 合成，无重绘；
 *  - prefers-reduced-motion 下静止。
 */
type MotifKind = 'round' | 'spade' | 'knife' | 'cowrie'

/** 方孔钱：外郭 + 方孔 */
function RoundCoin() {
  return (
    <svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <circle cx="50" cy="50" r="46" stroke="currentColor" strokeWidth="1.6" />
      <rect x="34" y="34" width="32" height="32" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

/** 布币：平首、双肩、方裆双足的铲形 */
function Spade() {
  return (
    <svg viewBox="0 0 100 160" fill="none" aria-hidden="true">
      <path
        d="M38 8h24v34c14 8 22 22 22 40 0 30-16 52-24 68H40c-8-16-24-38-24-68 0-18 8-32 22-40V8z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M42 12h16v30H42z" stroke="currentColor" strokeWidth="1.2" />
      <path d="M50 42v20m0 0-14 14m14-14 14 14M50 62v46" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

/** 刀币：直身弧刃的齐刀意象 */
function Knife() {
  return (
    <svg viewBox="0 0 160 60" fill="none" aria-hidden="true">
      <path
        d="M10 30c0-12 10-20 24-20h96c10 0 18 8 18 20s-8 20-18 20H34c-14 0-24-8-24-20z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        transform="rotate(-18 80 30)"
      />
      <path d="M46 22v32m14-32v32" stroke="currentColor" strokeWidth="1.2" transform="rotate(-18 80 30)" />
    </svg>
  )
}

/** 海贝：齿纹贝化 */
function Cowrie() {
  return (
    <svg viewBox="0 0 100 70" fill="none" aria-hidden="true">
      <path
        d="M50 6C26 6 8 18 8 35s18 29 42 29 42-12 42-29S74 6 50 6z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M50 12v46M32 17l10 42M68 17 58 59M20 26l14 34M80 26 66 60" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

const BY_KIND: Record<MotifKind, () => React.ReactElement> = {
  round: RoundCoin,
  spade: Spade,
  knife: Knife,
  cowrie: Cowrie,
}

/** 布点兼顾首屏与长页滚动：视口内均匀散布，出屏即不可见 */
const MOTIFS: Array<{
  kind: MotifKind
  cls: string
  style: React.CSSProperties
}> = [
  { kind: 'round', cls: 'amb-1', style: { top: '-4%', left: '-6%', width: 460 } },
  { kind: 'spade', cls: 'amb-2', style: { top: '16%', right: '-3%', width: 170 } },
  { kind: 'knife', cls: 'amb-3', style: { top: '52%', left: '-4%', width: 300 } },
  { kind: 'cowrie', cls: 'amb-4', style: { top: '76%', right: '6%', width: 220 } },
  { kind: 'round', cls: 'amb-5', style: { top: '108%', left: '12%', width: 300 } },
  { kind: 'spade', cls: 'amb-6', style: { top: '132%', right: '-6%', width: 200 } },
  { kind: 'cowrie', cls: 'amb-2', style: { top: '38%', left: '44%', width: 150 } },
  { kind: 'round', cls: 'amb-4', style: { top: '92%', left: '55%', width: 340 } },
]

export default function AmbientBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden text-ink"
      style={{ opacity: 0.05 }}
    >
      {MOTIFS.map((m, i) => {
        const Svg = BY_KIND[m.kind]
        return (
          <div key={i} className={`absolute ${m.cls}`} style={m.style}>
            <Svg />
          </div>
        )
      })}
    </div>
  )
}
