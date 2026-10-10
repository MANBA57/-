import type { SourceKind } from '@/api/types'
import { SOURCE_HINT, SOURCE_LABEL } from '@/lib/format'

/**
 * 数据来源标注。
 *
 * 这是本站的诚信设计：凡是不是原文直接写明的信息（推断来的、编辑补的），
 * 都必须在界面上标出来，不能让观众把推断当成史实。
 */
export default function SourceBadge({ source }: { source: SourceKind | null | undefined }) {
  if (!source || source === 'auto') return null
  return (
    <span
      className="capsule"
      style={{ backgroundColor: '#fdf0e6', color: 'var(--color-mark)' }}
      title={SOURCE_HINT[source]}
    >
      {SOURCE_LABEL[source]}
    </span>
  )
}
