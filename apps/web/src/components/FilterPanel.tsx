import type { FacetsOut } from '@/api/types'

export interface Filters {
  category?: string
  period?: string
  state?: string
  material?: string
}

type Props = {
  facets: FacetsOut
  value: Filters
  onChange: (next: Filters) => void
}

const GROUPS: Array<{ key: keyof Filters; title: string; facet: keyof FacetsOut }> = [
  { key: 'category', title: '货币体系', facet: 'categories' },
  { key: 'period', title: '时期', facet: 'periods' },
  { key: 'state', title: '国别', facet: 'states' },
  { key: 'material', title: '材质', facet: 'materials' },
]

/**
 * 筛选面板。选项与计数全部来自后端 /facets，前端不硬编码任何维度值 ——
 * 后续补新朝代数据时这里不用改。
 */
export default function FilterPanel({ facets, value, onChange }: Props) {
  const activeCount = GROUPS.filter((g) => value[g.key]).length

  return (
    <div className="space-y-8">
      <div className="flex items-baseline justify-between">
        <h2 className="text-subtitle text-ink">筛选</h2>
        {activeCount > 0 ? (
          <button
            type="button"
            className="link text-small"
            onClick={() => onChange({})}
          >
            清除全部（{activeCount}）
          </button>
        ) : null}
      </div>

      {GROUPS.map((group) => {
        const values = facets[group.facet]
        if (!values.length) return null
        const selected = value[group.key]
        return (
          <section key={group.key}>
            <h3 className="text-micro text-ink-muted">{group.title}</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {values.map((v) => {
                const on = selected === v.value
                return (
                  <button
                    key={v.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onChange({ ...value, [group.key]: on ? undefined : v.value })}
                    className="capsule transition-colors"
                    style={
                      on
                        ? { backgroundColor: 'var(--color-accent)', color: '#fff' }
                        : undefined
                    }
                  >
                    {v.value}
                    <span className="ml-1.5 opacity-50">{v.count}</span>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
