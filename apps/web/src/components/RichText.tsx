import { renderInline, splitParagraphs } from '@/lib/richtext'

/** 科普正文。内容实测无 Markdown 结构，只有零星 `**粗体**`。 */
export default function RichText({ text, className = '' }: { text: string; className?: string }) {
  const paragraphs = splitParagraphs(text)
  return (
    <div className={`space-y-4 ${className}`}>
      {paragraphs.map((p, i) => (
        <p
          key={i}
          className="text-body text-ink"
          style={{ textWrap: 'pretty' }}
          dangerouslySetInnerHTML={{ __html: renderInline(p) }}
        />
      ))}
    </div>
  )
}
