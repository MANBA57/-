import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEvolution } from '@/api/hooks'
import { ErrorState, Skeleton } from '@/components/States'
import type { EvolutionOut } from '@/api/types'

const SYSTEM_LABEL: Record<string, string> = {
  bu: '布币',
  dao: '刀币',
  yuan: '圜钱',
  bei: '贝币与原始货币',
  cross: '跨体系',
}

const NODE_W = 170
const NODE_H = 44
const SIB_GAP = 26 // 同层兄弟之间的横向间距
const LEVEL_H = 92 // 每层的高度（层间留出连线空间）
const SYS_GAP = 52 // 体系之间的间距
const PAD = 36

type Placed = { label: string; x: number; y: number; isCoin: boolean; slug: string | null }
type Header = { key: string; x: number; width: number }

/**
 * 计算每个节点在演变链上的「深度」（从根出发的最长路径）。
 * 按最长路径分层，而不是按入度：布币一列有两条链（空首布→尖足布→…→方足布、
 * 圆足布→三孔布、空首布→桥足布），按入度会把圆足布顶到最上面，读不出方向。
 */
function depths(nodes: string[], edges: Array<[string, string]>): Map<string, number> {
  const d = new Map(nodes.map((n) => [n, 0]))
  for (let i = 0; i < nodes.length; i++) {
    let changed = false
    for (const [a, b] of edges) {
      if (!d.has(a) || !d.has(b)) continue
      const na = d.get(a)!
      if (d.get(b)! < na + 1) {
        d.set(b, na + 1)
        changed = true
      }
    }
    if (!changed) break // 已收敛
  }
  return d
}

function layout(data: EvolutionOut): {
  placed: Placed[]
  headers: Header[]
  width: number
  height: number
} {
  const systems = [...new Set(data.edges.map((e) => e.system_key))]
  const byLabel = new Map(data.nodes.map((n) => [n.label, n]))

  const placed: Placed[] = []
  const headers: Header[] = []
  let cursorX = PAD
  let maxLevels = 1

  for (const sys of systems) {
    const labels: string[] = []
    const localEdges: Array<[string, string]> = []
    for (const e of data.edges) {
      if (e.system_key !== sys) continue
      for (const l of [e.from_label, e.to_label]) {
        if (!labels.includes(l)) labels.push(l)
      }
      localEdges.push([e.from_label, e.to_label])
    }

    const dep = depths(labels, localEdges)
    const maxDepth = Math.max(...labels.map((l) => dep.get(l)!))
    const levels: string[][] = []
    for (let d = 0; d <= maxDepth; d++) {
      levels.push(labels.filter((l) => dep.get(l) === d))
    }

    // 重心排序：把每层的节点排到其父节点附近，让连线尽量竖直。
    // 不做这一步，父子会左右错开，箭头全变成斜线。
    const parents = new Map<string, string[]>()
    for (const [a, b] of localEdges) {
      if (!parents.has(b)) parents.set(b, [])
      parents.get(b)!.push(a)
    }
    const idx = new Map<string, number>()
    levels.forEach((lv) => lv.forEach((l, i) => idx.set(l, i)))
    for (let iter = 0; iter < 6; iter++) {
      for (let d = 1; d < levels.length; d++) {
        const lv = levels[d]
        const before = new Map(lv.map((l, i) => [l, i]))
        const barycenter = (l: string): number => {
          const ps = parents.get(l) ?? []
          return ps.length
            ? ps.reduce((s, p) => s + (idx.get(p) ?? 0), 0) / ps.length
            : (before.get(l) ?? 0)
        }
        lv.sort((a, b) => barycenter(a) - barycenter(b) || (before.get(a) ?? 0) - (before.get(b) ?? 0))
        lv.forEach((l, i) => idx.set(l, i))
      }
    }

    const cols = Math.max(1, ...levels.map((lv) => lv.length))
    const sysWidth = cols * NODE_W + (cols - 1) * SIB_GAP

    levels.forEach((lv, d) => {
      lv.forEach((label, i) => {
        const meta = byLabel.get(label)
        placed.push({
          label,
          x: cursorX + i * (NODE_W + SIB_GAP),
          y: PAD + d * LEVEL_H,
          isCoin: meta?.is_coin ?? false,
          slug: meta?.slug ?? null,
        })
      })
    })

    headers.push({ key: sys, x: cursorX, width: sysWidth })
    maxLevels = Math.max(maxLevels, levels.length)
    cursorX += sysWidth + SYS_GAP
  }

  return {
    placed,
    headers,
    width: cursorX - SYS_GAP + PAD,
    height: PAD * 2 + maxLevels * LEVEL_H,
  }
}

/**
 * 货币体系演化图。
 *
 * 手绘 SVG —— 21 个节点、14 条边，用不着图布局库。
 * 版式：每个体系一栏；栏内**深度即行号，同层兄弟横向并排**，
 * 再用重心排序让父子上下对齐，箭头因此基本是竖直的，演化方向一眼可读。
 */
export default function Evolution() {
  const evolution = useEvolution()
  const navigate = useNavigate()
  const [hovered, setHovered] = useState<string | null>(null)

  const { placed, headers, width, height } = useMemo(
    () =>
      evolution.data
        ? layout(evolution.data)
        : { placed: [], headers: [], width: 0, height: 0 },
    [evolution.data],
  )
  const pos = useMemo(() => new Map(placed.map((p) => [p.label, p])), [placed])

  if (evolution.isError) {
    return (
      <div className="container-page py-section">
        <ErrorState
          title="演化图加载失败"
          detail={(evolution.error as Error)?.message}
          onRetry={() => void evolution.refetch()}
        />
      </div>
    )
  }

  return (
    <div className="pb-section">
      <section className="container-page pt-[72px] pb-block md:pt-[100px]">
        <p className="marker">体系演化</p>
        <h1 className="mt-2 text-display">钱是怎么长成这样的。</h1>
        <p className="mt-4 max-w-[56ch] text-body text-ink-muted">
          农具铲变布币，削刀变刀币，玉璧纺轮变圜钱 —— 每一类货币都从一件实用器物出发，
          再被交易需求推着改变形制。从上到下即演变方向。
        </p>
      </section>

      {evolution.isPending ? (
        <div className="container-page">
          <Skeleton className="h-[520px] w-full rounded-card" />
        </div>
      ) : (
        <div className="overflow-x-auto pb-6">
          <div className="min-w-max px-[5.3%]">
            <div className="card p-4" style={{ width: width + 32 }}>
              <svg
                width={width}
                height={height}
                viewBox={`0 0 ${width} ${height}`}
                role="img"
                aria-label="先秦货币体系演化关系图"
              >
                <defs>
                  <marker
                    id="arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-hairline)" />
                  </marker>
                  <marker
                    id="arrow-active"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-accent)" />
                  </marker>
                </defs>

                {/* 栏标题 */}
                {headers.map((h) => (
                  <text
                    key={h.key}
                    x={h.x}
                    y={PAD - 14}
                    fontSize="12"
                    fill="var(--color-ink-muted)"
                  >
                    {SYSTEM_LABEL[h.key] ?? h.key}
                  </text>
                ))}

                {/* 边：从父节点底部中点弯到子节点顶部中点，基本竖直 */}
                {evolution.data.edges.map((e, i) => {
                  const a = pos.get(e.from_label)
                  const b = pos.get(e.to_label)
                  if (!a || !b) return null
                  const active = hovered === e.from_label || hovered === e.to_label
                  const x1 = a.x + NODE_W / 2
                  const y1 = a.y + NODE_H
                  const x2 = b.x + NODE_W / 2
                  const y2 = b.y
                  const midY = (y1 + y2) / 2
                  return (
                    <g key={i}>
                      <path
                        d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                        fill="none"
                        stroke={active ? 'var(--color-accent)' : 'var(--color-hairline)'}
                        strokeWidth={active ? 2 : 1.5}
                        markerEnd={active ? 'url(#arrow-active)' : 'url(#arrow)'}
                      />
                      {e.kind ? (
                        <text
                          x={(x1 + x2) / 2 + 8}
                          y={midY + 3}
                          fontSize="10"
                          fill="var(--color-ink-muted)"
                        >
                          {e.kind}
                        </text>
                      ) : null}
                    </g>
                  )
                })}

                {/* 节点。不在 SVG 里嵌 <Link>（跨命名空间渲染不可靠），统一用 useNavigate。 */}
                {placed.map((p) => {
                  const active = hovered === p.label
                  const clickable = p.isCoin && p.slug
                  return (
                    <g
                      key={p.label}
                      style={{ cursor: clickable ? 'pointer' : 'default' }}
                      onMouseEnter={() => setHovered(p.label)}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => {
                        if (clickable && p.slug) navigate(`/coins/${encodeURIComponent(p.slug)}`)
                      }}
                    >
                      <rect
                        x={p.x}
                        y={p.y}
                        width={NODE_W}
                        height={NODE_H}
                        rx={12}
                        fill={active ? 'var(--color-accent)' : 'var(--color-surface)'}
                        stroke={clickable ? 'var(--color-hairline)' : 'var(--color-capsule)'}
                        strokeWidth={1}
                      />
                      <text
                        x={p.x + NODE_W / 2}
                        y={p.y + NODE_H / 2 + 5}
                        textAnchor="middle"
                        fontSize="13"
                        fontWeight={clickable ? 600 : 400}
                        fill={active ? '#fff' : 'var(--color-ink)'}
                      >
                        {p.label.length > 12 ? `${p.label.slice(0, 12)}…` : p.label}
                      </text>
                    </g>
                  )
                })}
              </svg>
            </div>

            <p className="mt-4 text-micro text-ink-muted">
              带边框的节点可点击进入钱币详情；灰色箭头为演变方向，标注文字为演变类型。
            </p>
          </div>
        </div>
      )}

      {/* 边的说明：SVG 里放不下长句 */}
      {evolution.data ? (
        <section className="container-page mt-section">
          <h2 className="text-title text-ink">演变说明</h2>
          <ul className="mt-6 grid grid-cols-1 gap-card md:grid-cols-2">
            {evolution.data.edges.map((e, i) => (
              <li key={i} className="card p-6">
                <p className="text-small text-ink">
                  <span className="font-semibold">{e.from_label}</span>
                  <span className="mx-2 text-ink-muted">→</span>
                  <span className="font-semibold">{e.to_label}</span>
                  {e.kind ? <span className="capsule ml-3">{e.kind}</span> : null}
                </p>
                {e.note ? <p className="mt-3 text-small text-ink-muted">{e.note}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
