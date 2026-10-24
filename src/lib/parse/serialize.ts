import type { Delimiter } from '../data/types'

export interface SerializeOptions {
  delimiter: Delimiter
  quoting: 'minimal' | 'always'
  newline: '\n' | '\r\n'
}

/**
 * 필드 하나를 CSV 규칙으로 인용한다.
 * 'minimal'에서는 구분자·따옴표·개행이 있거나 앞뒤 공백이 있을 때만 인용한다
 * (앞뒤 공백을 인용하지 않으면 라운드트립에서 유실될 수 있는 도구가 많다).
 */
export function quoteField(v: string, opts: SerializeOptions): string {
  if (opts.quoting === 'always') return `"${v.replace(/"/g, '""')}"`
  if (v === '') return ''
  const needs =
    v.includes(opts.delimiter) ||
    v.includes('"') ||
    v.includes('\n') ||
    v.includes('\r') ||
    v !== v.trim()
  return needs ? `"${v.replace(/"/g, '""')}"` : v
}

/**
 * 2차원 배열을 구분자 텍스트로 직렬화한다.
 *
 * 10만 행에서 문자열 누적 연산이 폭발하지 않도록 행 단위 배열에 모은 뒤 한 번에 join 한다.
 */
export function serialize(matrix: readonly string[][], opts: SerializeOptions): string {
  const lines: string[] = new Array(matrix.length)
  const d = opts.delimiter
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i]
    const cells: string[] = new Array(row.length)
    for (let j = 0; j < row.length; j++) cells[j] = quoteField(row[j] ?? '', opts)
    lines[i] = cells.join(d)
  }
  return lines.join(opts.newline)
}

/** 클립보드용 TSV. 탭·개행을 포함한 값만 인용한다. */
export function toTsv(matrix: readonly string[][]): string {
  return serialize(matrix, { delimiter: '\t', quoting: 'minimal', newline: '\n' })
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => HTML_ESCAPES[c])
}

/**
 * 클립보드용 HTML 테이블. Excel/Sheets는 `text/html`이 있으면 이걸 우선 사용해
 * 표 구조를 그대로 붙여넣는다.
 */
export function toHtmlTable(matrix: readonly string[][], headerRow: boolean): string {
  const parts: string[] = ['<table>']
  for (let i = 0; i < matrix.length; i++) {
    const tag = headerRow && i === 0 ? 'th' : 'td'
    parts.push('<tr>')
    for (const cell of matrix[i]) {
      parts.push(`<${tag}>${escapeHtml(cell ?? '')}</${tag}>`)
    }
    parts.push('</tr>')
  }
  parts.push('</table>')
  return parts.join('')
}
