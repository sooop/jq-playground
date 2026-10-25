import type { ExportFormat } from '../data/types'

/**
 * 표 내보내기의 순수 직렬화 함수 모음 (csv/tsv 제외 — 그쪽은 serialize.ts 가 담당).
 *
 * DOM/브라우저 API를 쓰지 않으므로 vitest 에서 바로 돌아간다.
 * 입력은 모두 `string[][]` 행렬과 `headerRow`(첫 행이 헤더인지) 이다.
 * 출력은 행 사이를 `\n` 으로만 잇고, 끝에 개행을 붙이지 않는다.
 */

export type TextFormat = Exclude<ExportFormat, 'csv' | 'tsv'>

/** 형식 키 → 파일 확장자. html/htmlrich 는 같은 .html, 마크다운 두 형식은 .md. */
export const TEXT_FORMAT_EXT: Record<TextFormat, string> = {
  html: 'html',
  htmlrich: 'html',
  box: 'txt',
  json: 'json',
  mdtable: 'md',
  mdlist: 'md',
}

/** 형식 하나의 텍스트 출력. `title` 은 htmlrich 문서의 `<title>` 에만 쓴다. */
export function renderTextFormat(
  format: TextFormat,
  matrix: readonly string[][],
  headerRow: boolean,
  title = 'table',
): string {
  switch (format) {
    case 'html':
      return toHtmlMarkup(matrix, headerRow)
    case 'htmlrich':
      return toRichHtmlDocument(matrix, headerRow, title)
    case 'box':
      return toBoxTable(matrix, headerRow)
    case 'json':
      return toJson(matrix, headerRow)
    case 'mdtable':
      return toMarkdownTable(matrix, headerRow)
    case 'mdlist':
      return toMarkdownList(matrix, headerRow)
  }
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** HTML 텍스트·속성값용 이스케이프. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c])
}

/** 셀 안의 개행(CRLF·CR·LF)을 `<br>` 로 바꾼 HTML 셀 본문. */
function htmlCellText(s: string): string {
  return escapeHtml(s).replace(/\r\n|\r|\n/g, '<br>')
}

/**
 * 서식 없는 HTML 표 마크업. 줄바꿈 없이 한 줄이다.
 * 헤더가 있으면 `<thead>`, 데이터 행이 있으면 `<tbody>` 를 쓴다.
 */
export function toHtmlMarkup(matrix: readonly string[][], headerRow: boolean): string {
  const head = headerRow && matrix.length > 0 ? matrix[0] : null
  const body = headerRow ? matrix.slice(1) : matrix
  const parts: string[] = ['<table>']
  if (head) {
    parts.push('<thead><tr>')
    for (const c of head) parts.push(`<th>${htmlCellText(c ?? '')}</th>`)
    parts.push('</tr></thead>')
  }
  if (body.length > 0) {
    parts.push('<tbody>')
    for (const row of body) {
      parts.push('<tr>')
      for (const c of row) parts.push(`<td>${htmlCellText(c ?? '')}</td>`)
      parts.push('</tr>')
    }
    parts.push('</tbody>')
  }
  parts.push('</table>')
  return parts.join('')
}

const RICH_TABLE_STYLE = 'border-collapse:collapse;font-family:sans-serif;font-size:12px'
const RICH_CELL_STYLE = 'border:1px solid #999;padding:3px 6px;vertical-align:top'
const RICH_HEAD_STYLE = `${RICH_CELL_STYLE};background:#f0f0f0;font-weight:bold;text-align:left`

/**
 * 서식 있는 완전한 HTML 문서. 테두리와 헤더 굵게는 인라인 스타일로 넣어
 * 외부 CSS 없이도 저장한 파일이 그대로 보이게 한다.
 */
export function toRichHtmlDocument(
  matrix: readonly string[][],
  headerRow: boolean,
  title = 'table',
): string {
  const head = headerRow && matrix.length > 0 ? matrix[0] : null
  const body = headerRow ? matrix.slice(1) : matrix
  const parts: string[] = [
    '<!DOCTYPE html>',
    '<html lang="ko">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    '</head>',
    '<body>',
    `<table style="${RICH_TABLE_STYLE}">`,
  ]
  if (head) {
    const cells = head.map((c) => `<th style="${RICH_HEAD_STYLE}">${htmlCellText(c ?? '')}</th>`)
    parts.push(`<thead><tr>${cells.join('')}</tr></thead>`)
  }
  if (body.length > 0) {
    parts.push('<tbody>')
    for (const row of body) {
      const cells = row.map((c) => `<td style="${RICH_CELL_STYLE}">${htmlCellText(c ?? '')}</td>`)
      parts.push(`<tr>${cells.join('')}</tr>`)
    }
    parts.push('</tbody>')
  }
  parts.push('</table>', '</body>', '</html>')
  return parts.join('\n')
}

/**
 * 문자열이 모노스페이스에서 차지하는 칸 수. 한글·CJK·전각·이모지는 2칸.
 * `dataset.svelte.ts` 의 `displayWidth` 와 같은 규칙이다 (runes 모듈을 끌어오지 않으려고 복제).
 */
export function textWidth(s: string): number {
  let w = 0
  for (const ch of s) w += isWide(ch.codePointAt(0) ?? 0) ? 2 : 1
  return w
}

function isWide(c: number): boolean {
  return (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0x303e) ||
    (c >= 0x3041 && c <= 0x33ff) ||
    (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0xa000 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe6f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x1f300 && c <= 0x1f9ff) ||
    (c >= 0x20000 && c <= 0x3fffd)
  )
}

/** 셀 한 칸 안에 들어갈 한 줄 — 개행·탭은 공백으로 바꾼다. */
function singleLine(s: string): string {
  return s.replace(/\r\n|\r|\n|\t/g, ' ')
}

function padEnd(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - textWidth(s)))
}

/**
 * 박스 문자 표. 열 너비는 표시 칸 수 기준(한글 2칸)으로 맞추고, 값은 왼쪽 정렬한다.
 * 헤더가 있으면 헤더 아래에 구분선(├─┼─┤)을 넣는다.
 */
export function toBoxTable(matrix: readonly string[][], headerRow: boolean): string {
  if (matrix.length === 0) return ''
  const rows = matrix.map((r) => r.map((c) => singleLine(c ?? '')))
  let width = 0
  for (const r of rows) if (r.length > width) width = r.length
  if (width === 0) return ''

  const colW: number[] = new Array(width).fill(1)
  for (const r of rows) {
    for (let c = 0; c < width; c++) {
      const w = textWidth(r[c] ?? '')
      if (w > colW[c]) colW[c] = w
    }
  }

  const rule = (l: string, m: string, r: string): string =>
    l + colW.map((w) => '─'.repeat(w + 2)).join(m) + r
  const line = (r: string[]): string =>
    '│' +
    colW.map((w, c) => ` ${padEnd(r[c] ?? '', w)} `).join('│') +
    '│'

  const out: string[] = [rule('┌', '┬', '┐')]
  rows.forEach((r, i) => {
    out.push(line(r))
    if (headerRow && i === 0) out.push(rule('├', '┼', '┤'))
  })
  out.push(rule('└', '┴', '┘'))
  return out.join('\n')
}

/**
 * 객체 배열(헤더가 키)을 2칸 들여쓰기 JSON으로. 헤더가 없으면 배열의 배열.
 * 값은 모두 문자열 그대로 둔다 — 숫자 변환은 하지 않는다.
 * 헤더 이름이 중복되면 뒤쪽 칼럼이 앞쪽 값을 덮는다.
 */
export function toJson(matrix: readonly string[][], headerRow: boolean): string {
  if (!headerRow) {
    return JSON.stringify(
      matrix.map((r) => [...r]),
      null,
      2,
    )
  }
  if (matrix.length === 0) return '[]'
  const keys = matrix[0]
  const objs = matrix.slice(1).map((row) =>
    Object.fromEntries(keys.map((k, c) => [k, row[c] ?? ''])),
  )
  return JSON.stringify(objs, null, 2)
}

/** 개행을 `<br>` 로 바꿔 셀을 한 줄에 담는다. */
function mdLineBreaks(s: string): string {
  return s.replace(/\r\n|\r|\n/g, '<br>')
}

/** 표 셀용: 셀 안의 `|` 는 `\|`, 개행은 `<br>`. */
function mdCell(s: string): string {
  return mdLineBreaks(s.replace(/\|/g, '\\|'))
}

/** 칼럼 이름이 없을 때의 기본 이름: 0→A, 25→Z, 26→AA. */
export function columnLetters(i: number): string {
  let n = i + 1
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/**
 * 마크다운 파이프 표. GFM은 헤더 행이 필수이므로, 헤더 없이 내보내면 헤더 행을
 * 빈 칸으로 둔다(데이터를 지어내지 않기 위해).
 */
export function toMarkdownTable(matrix: readonly string[][], headerRow: boolean): string {
  if (matrix.length === 0) return ''
  let width = 0
  for (const r of matrix) if (r.length > width) width = r.length
  if (width === 0) return ''
  const pad = (r: readonly string[]): string[] =>
    Array.from({ length: width }, (_, c) => mdCell(r[c] ?? ''))
  const fmt = (cells: string[]): string => `| ${cells.join(' | ')} |`

  const head = headerRow ? pad(matrix[0]) : Array.from({ length: width }, () => '')
  const body = headerRow ? matrix.slice(1) : matrix
  const out: string[] = [fmt(head), `|${Array(width).fill('---').join('|')}|`]
  for (const r of body) out.push(fmt(pad(r)))
  return out.join('\n')
}

/**
 * 레코드마다 `- 첫열: 값` 으로 시작하고 나머지 열은 두 칸 들여쓴 `  이름: 값` 줄이다.
 * 레코드 사이에 빈 줄을 넣지 않는다. 값이 비면 `이름:` 만 쓴다.
 * 열 이름이 없으면(headerRow false) A, B, C… 를 쓴다.
 */
export function toMarkdownList(matrix: readonly string[][], headerRow: boolean): string {
  if (matrix.length === 0) return ''
  const names = headerRow ? matrix[0] : matrix[0].map((_, i) => columnLetters(i))
  const body = headerRow ? matrix.slice(1) : matrix
  const field = (name: string, value: string): string => {
    const v = mdLineBreaks(value)
    return v === '' ? `${name}:` : `${name}: ${v}`
  }
  const out: string[] = []
  for (const row of body) {
    names.forEach((name, c) => {
      const f = field(name, row[c] ?? '')
      out.push(c === 0 ? `- ${f}` : `  ${f}`)
    })
  }
  return out.join('\n')
}
