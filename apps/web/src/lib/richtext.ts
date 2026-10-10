/**
 * 极简富文本渲染。
 *
 * 内容是我们自己的（非用户生成），且实测只用到了 `**粗体**` 一种语法，
 * 所以没必要引入 marked 之类的解析器。但**所有输出必须先转义**，
 * 因为搜索摘要里会混进用户输入的查询词。
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c)
}

/** 转义后把 `**粗体**` 还原成 <strong> */
export function renderInline(text: string): string {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}

/** 按空行切段（原文是整段散文，通常只有一段） */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
}

/**
 * 渲染全文检索的摘要。
 * 后端用 << >> 标记命中处，这里先整体转义、再替换成 <mark>，
 * 顺序不能反 —— 反了就是 XSS。
 */
export function renderSnippet(snippet: string): string {
  return escapeHtml(snippet)
    .replace(/&lt;&lt;/g, '<mark>')
    .replace(/&gt;&gt;/g, '</mark>')
}
