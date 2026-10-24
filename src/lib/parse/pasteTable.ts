import type { Delimiter } from '../data/types'
import { parseAll } from './csv'
import { detectDelimiter, finalize } from './detect'

/**
 * 붙여넣은 텍스트/HTML이 어떤 표 형식인지 인식해 `{ header, rows }`로 바꾼다.
 *
 * DOM에 의존하지 않는다(vitest node 환경에서도 돈다). HTML은 정규식 기반 간이 토크나이저로 읽는다.
 * 인식 순서: html `<table>` → 마크다운 파이프 표 → 박스 문자 표 → 마크다운 불릿 레코드 →
 * JSON → 구분자 텍스트. 애매하면 null을 돌려준다(오인식이 더 해롭다).
 *
 * 모든 규칙은 줄 단위 1패스 또는 정규식 한 번으로 끝나므로 입력 길이에 선형이다.
 */

export type PasteKind = 'html' | 'mdtable' | 'box' | 'mdlist' | 'delimited' | 'json' | 'unknown'

export interface PastedTable {
  kind: PasteKind
  header: string[]
  rows: string[][]
}

/** rowspan/colspan 상한. 악의적이거나 깨진 HTML이 메모리를 폭주시키지 않도록 막는다. */
const MAX_SPAN = 1000
/** 구분자 추론에 쓰는 앞부분 길이. detectDelimiter는 전체를 파싱하므로 샘플만 넘긴다. */
const DELIMITER_SAMPLE_CHARS = 16 * 1024

export function parsePastedTable(text: string, html?: string): PastedTable | null {
  if (html && /<table\b/i.test(html)) {
    const t = parseHtmlTable(html)
    if (t) return t
  }

  const lines = splitLines(text)
  if (lines.length === 0) return null

  const md = parseMdTable(lines)
  if (md) return md

  const box = parseBoxTable(lines)
  if (box) return box

  const list = parseMdList(lines)
  if (list) return list

  const body = lines.join('\n')
  const json = parseJsonLike(body)
  if (json) return json.table // JSON으로 파싱되면 구분자 규칙으로 넘기지 않는다

  return parseDelimited(body)
}

// ---------------------------------------------------------------------------
// 공통 전처리
// ---------------------------------------------------------------------------

/** BOM 제거, CRLF/CR → LF, 앞뒤 공백 줄 제거. 들여쓰기는 보존한다. */
function splitLines(text: string): string[] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const lines = s.replace(/\r\n?/g, '\n').split('\n')
  let a = 0
  let b = lines.length
  while (a < b && lines[a].trim() === '') a++
  while (b > a && lines[b - 1].trim() === '') b--
  return lines.slice(a, b)
}

// ---------------------------------------------------------------------------
// 1. HTML <table>
// ---------------------------------------------------------------------------

interface HtmlCell {
  text: string
  colspan: number
  rowspan: number
}

interface HtmlRow {
  cells: HtmlCell[]
  /** thead 안에서 만들어진 행인지 */
  head: boolean
}

interface HtmlCellBuild {
  parts: string[]
  colspan: number
  rowspan: number
}

interface HtmlState {
  rows: HtmlRow[]
  row: HtmlRow | null
  cell: HtmlCellBuild | null
  inHead: boolean
}

const COLSPAN_RE = /\bcolspan\s*=\s*["']?\s*(\d+)/i
const ROWSPAN_RE = /\browspan\s*=\s*["']?\s*(\d+)/i
const NAMED_ENTITIES = new Map<string, string>([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', ' '],
])

function parseHtmlTable(html: string): PastedTable | null {
  const s = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[[\s\S]*?\]>/g, '') // Office 조건부 주석 <![if ...]>
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  const start = s.search(/<table\b/i)
  if (start < 0) return null

  const st: HtmlState = { rows: [], row: null, cell: null, inHead: false }
  let sawThead = false
  let depth = 0
  let last = start
  let m: RegExpExecArray | null
  // 속성 안의 '>'도 건너뛰도록 따옴표 구간을 인식한다.
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g
  tagRe.lastIndex = start

  while ((m = tagRe.exec(s)) !== null) {
    if (st.cell && m.index > last) {
      st.cell.parts.push(decodeEntities(s.slice(last, m.index).replace(/\s+/g, ' ')))
    }
    last = tagRe.lastIndex
    const closing = m[1] === '/'
    const name = m[2].toLowerCase()
    const attrs = m[3]

    if (name === 'table') {
      depth += closing ? -1 : 1
      if (depth <= 0) break // 첫 표만 본다
      continue
    }
    // 중첩 표 안의 태그는 무시한다(텍스트만 현재 셀에 흡수된다)
    if (depth !== 1) continue

    if (name === 'tr') {
      closeRow(st)
      if (!closing) st.row = { cells: [], head: st.inHead }
    } else if (name === 'td' || name === 'th') {
      closeCell(st)
      if (!closing) {
        if (!st.row) st.row = { cells: [], head: st.inHead }
        st.cell = {
          parts: [],
          colspan: spanOf(attrs, COLSPAN_RE),
          rowspan: spanOf(attrs, ROWSPAN_RE),
        }
      }
    } else if (name === 'thead') {
      closeRow(st)
      st.inHead = !closing
      if (!closing) sawThead = true
    } else if (name === 'br') {
      if (!closing && st.cell) st.cell.parts.push('\n')
    }
  }
  closeRow(st)

  if (st.rows.length === 0) return null

  const grid = expandSpans(st.rows)
  // thead가 있으면 그 첫 행이 헤더, 없으면 첫 행이 헤더
  const hi = sawThead ? Math.max(0, st.rows.findIndex((r) => r.head)) : 0
  const width = grid.reduce((w, r) => Math.max(w, r.length), 0)
  const pad = (r: string[]): string[] => Array.from({ length: width }, (_, j) => r[j] ?? '')

  return {
    kind: 'html',
    header: pad(grid[hi]),
    rows: grid.filter((_, i) => i !== hi).map(pad),
  }
}

function closeCell(st: HtmlState): void {
  if (st.cell && st.row) {
    st.row.cells.push({
      text: finishCell(st.cell.parts),
      colspan: st.cell.colspan,
      rowspan: st.cell.rowspan,
    })
  }
  st.cell = null
}

function closeRow(st: HtmlState): void {
  closeCell(st)
  if (st.row && st.row.cells.length > 0) st.rows.push(st.row)
  st.row = null
}

function spanOf(attrs: string, re: RegExp): number {
  const m = re.exec(attrs)
  const n = m ? parseInt(m[1], 10) : 1
  return Math.min(Math.max(n, 1), MAX_SPAN)
}

/** 셀 조각을 합쳐 `<br>`의 개행을 살리고, 각 줄의 앞뒤 공백을 걷어낸다. */
function finishCell(parts: string[]): string {
  return parts
    .join('')
    .replace(/ /g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim()
}

/**
 * colspan은 첫 칸에만 값을, rowspan은 아래 행의 칸에 빈 문자열을 채운다.
 * 반환은 행마다 길이가 들쭉날쭉할 수 있다(호출 측에서 패딩).
 */
function expandSpans(rows: HtmlRow[]): string[][] {
  const grid: string[][] = []
  // 열 번호 → 아직 이 열을 점유 중인 아래 행 수
  let carry = new Map<number, number>()

  for (const r of rows) {
    const out: string[] = []
    const next = new Map<number, number>()
    let c = 0

    const fillCarried = (): void => {
      let left = carry.get(c)
      while (left !== undefined && left > 0) {
        out[c] = ''
        if (left > 1) next.set(c, left - 1)
        c++
        left = carry.get(c)
      }
    }

    for (const cell of r.cells) {
      fillCarried()
      for (let k = 0; k < cell.colspan; k++) {
        out[c + k] = k === 0 ? cell.text : ''
        if (cell.rowspan > 1) next.set(c + k, cell.rowspan - 1)
      }
      c += cell.colspan
    }
    fillCarried()

    grid.push(out)
    carry = next
  }
  return grid
}

/** HTML 엔티티를 한 번의 패스로 디코딩한다(`&amp;lt;` → `&lt;`). */
function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (all: string, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all
    }
    return NAMED_ENTITIES.get(e.toLowerCase()) ?? all
  })
}

// ---------------------------------------------------------------------------
// 2. 마크다운 파이프 표
// ---------------------------------------------------------------------------

const MD_SEP_CELL = /^:?-+:?$/

function parseMdTable(lines: string[]): PastedTable | null {
  if (lines.length < 2) return null
  const headerLine = lines[0]
  const sepLine = lines[1]
  if (!headerLine.includes('|') || !sepLine.includes('|')) return null

  const header = splitPipeRow(headerLine)
  const sep = splitPipeRow(sepLine)
  if (sep.length !== header.length || !sep.every((c) => MD_SEP_CELL.test(c))) return null

  const rows: string[][] = []
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i]
    // 표 뒤에 일반 문장이 섞이면 표 전체가 애매하므로 null
    if (!line.includes('|')) return null
    const cells = splitPipeRow(line)
    if (cells.length !== header.length) return null
    rows.push(cells)
  }
  return { kind: 'mdtable', header, rows }
}

/** 양끝 파이프는 선택. `\|`는 리터럴 `|`, `<br>`은 개행으로 복원한다. */
function splitPipeRow(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1)

  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (ch === '\\' && t[i + 1] === '|') {
      cur += '|'
      i++
    } else if (ch === '|') {
      cells.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur)
  return cells.map((c) => c.trim().replace(/<br\s*\/?>/gi, '\n'))
}

// ---------------------------------------------------------------------------
// 3. 박스 문자 표 (┌─┬─┐ 과 이중선, ASCII +---+)
// ---------------------------------------------------------------------------

const ASCII_BORDER = /^\+(?:[-=]+\+)+$/
const BOX_CONTENT = /^[│║].*[│║]$/
const ASCII_CONTENT = /^\|.*\|$/
const BOX_JUNCTIONS = '┬┼┴╦╬╩'

function isBoxBorder(t: string): boolean {
  return /^[┌├└╔╠╚][─═┬┼┴╦╬╩┌┐├┤└┘╔╗╠╣╚╝]*[┐┤┘╗╣╝]$/.test(t) && /[─═]/.test(t)
}

type BoxLine = { border: true; junctions: number } | { border: false; cells: string[] }

function classifyBoxLine(raw: string, boxMode: boolean): BoxLine | null {
  const t = raw.trim()
  if (boxMode) {
    if (isBoxBorder(t)) return { border: true, junctions: countChars(t, BOX_JUNCTIONS) }
    if (BOX_CONTENT.test(t)) return { border: false, cells: t.slice(1, -1).split(/[│║]/).map((x) => x.trim()) }
    return null
  }
  if (ASCII_BORDER.test(t)) return { border: true, junctions: countChars(t, '+') - 2 }
  if (ASCII_CONTENT.test(t)) return { border: false, cells: t.slice(1, -1).split('|').map((x) => x.trim()) }
  return null
}

function countChars(s: string, chars: string): number {
  let n = 0
  for (const ch of s) if (chars.includes(ch)) n++
  return n
}

function parseBoxTable(lines: string[]): PastedTable | null {
  if (lines.length < 3) return null
  const first = lines[0].trim()
  const boxMode = isBoxBorder(first)
  if (!boxMode && !ASCII_BORDER.test(first)) return null

  const junctionCounts: number[] = []
  // 구분선 사이의 내용 줄 묶음. 묶음 하나가 논리 행 하나다(셀 안 여러 줄 포함).
  const blocks: string[][][] = []
  let cur: string[][] = []

  for (const raw of lines) {
    const c = classifyBoxLine(raw, boxMode)
    if (!c) return null
    if (c.border) {
      if (cur.length > 0) {
        blocks.push(cur)
        cur = []
      }
      junctionCounts.push(c.junctions)
    } else {
      cur.push(c.cells)
    }
  }
  // 닫힌 표여야 한다: 마지막 줄이 구분선이어야 cur가 비어 있다
  if (cur.length > 0 || blocks.length === 0) return null

  const width = blocks[0][0].length
  if (junctionCounts.some((j) => j !== width - 1)) return null
  for (const block of blocks) {
    for (const line of block) if (line.length !== width) return null
  }

  const table = blocks.map((block) =>
    Array.from({ length: width }, (_, j) =>
      block
        .map((line) => line[j])
        .filter((v) => v !== '')
        .join('\n'),
    ),
  )
  return { kind: 'box', header: table[0], rows: table.slice(1) }
}

// ---------------------------------------------------------------------------
// 4. 마크다운 불릿 목록 레코드 (- 이름: 값 / 들여쓴 이름: 값)
// ---------------------------------------------------------------------------

function parseMdList(lines: string[]): PastedTable | null {
  const records: [string, string][][] = []
  let cur: [string, string][] | null = null

  for (const raw of lines) {
    if (raw.trim() === '') continue
    if (raw.startsWith('- ')) {
      const kv = parseKeyValue(raw.slice(2))
      if (!kv) return null
      cur = [kv]
      records.push(cur)
    } else if (cur && /^[ \t]/.test(raw)) {
      const kv = parseKeyValue(raw)
      if (!kv) return null
      cur.push(kv)
    } else {
      return null
    }
  }
  if (records.length < 2) return null

  const columns = new Set<string>()
  for (const rec of records) for (const [k] of rec) columns.add(k)
  const header = [...columns]
  const rows = records.map((rec) => {
    const m = new Map(rec)
    return header.map((k) => m.get(k) ?? '')
  })
  return { kind: 'mdlist', header, rows }
}

/** `이름: 값` 한 줄을 나눈다. 분리는 첫 `: ` 에서만(값에 콜론이 있어도 된다). */
function parseKeyValue(raw: string): [string, string] | null {
  const s = raw.trim()
  const idx = s.indexOf(': ')
  let key: string
  let value: string
  if (idx >= 0) {
    key = s.slice(0, idx).trim()
    value = s.slice(idx + 2).trim()
  } else if (s.endsWith(':')) {
    key = s.slice(0, -1).trim()
    value = ''
  } else {
    return null
  }
  // 빈 이름이나 하위 불릿(`- x: y`)은 레코드 필드가 아니다
  if (key === '' || key.startsWith('-')) return null
  return [key, value]
}

// ---------------------------------------------------------------------------
// 5. JSON
// ---------------------------------------------------------------------------

/** JSON으로 파싱되면 `{ table }`을, 아니면 null을 돌려준다. table 이 null 이면 표가 아닌 JSON. */
function parseJsonLike(body: string): { table: PastedTable | null } | null {
  const c = body[0]
  if (c !== '[' && c !== '{') return null
  let v: unknown
  try {
    v = JSON.parse(body)
  } catch {
    // 닫는 괄호로 끝나는 깨진 JSON은 표로 오인하지 않도록 null로 막는다
    const end = body[body.length - 1]
    return end === ']' || end === '}' ? { table: null } : null
  }
  return { table: jsonToTable(v) }
}

function jsonToTable(v: unknown): PastedTable | null {
  if (!Array.isArray(v) || v.length === 0) return null

  if (v.every(isPlainObject)) {
    const keys = new Set<string>()
    for (const o of v as Record<string, unknown>[]) for (const k of Object.keys(o)) keys.add(k)
    const header = [...keys]
    if (header.length === 0) return null
    const rows = (v as Record<string, unknown>[]).map((o) => header.map((k) => jsonCell(o[k])))
    return { kind: 'json', header, rows }
  }

  if (v.every(Array.isArray)) {
    const arrs = v as unknown[][]
    const width = arrs.reduce((w, a) => Math.max(w, a.length), 0)
    if (width === 0) return null
    const grid = arrs.map((a) => Array.from({ length: width }, (_, j) => jsonCell(a[j])))
    return { kind: 'json', header: grid[0], rows: grid.slice(1) }
  }
  return null
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function jsonCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

// ---------------------------------------------------------------------------
// 6. 구분자 텍스트 (CSV/TSV/세미콜론/파이프)
// ---------------------------------------------------------------------------

function parseDelimited(body: string): PastedTable | null {
  // 모든 줄이 |로 감싸여 있으면 구분선 없는 마크다운 표 등으로 보고 구분자 규칙으로 넘기지 않는다
  const pipeBordered = body.split('\n').every((l) => {
    const t = l.trim()
    return t.length >= 2 && t.startsWith('|') && t.endsWith('|')
  })
  if (pipeBordered) return null

  // 스프레드시트 복사는 탭이 들어 있으므로 탭을 먼저 시도한다
  const candidates: Delimiter[] = []
  if (body.includes('\t')) candidates.push('\t')
  const best = detectDelimiter(body.slice(0, DELIMITER_SAMPLE_CHARS))
  if (!candidates.includes(best)) candidates.push(best)

  for (const d of candidates) {
    const rows = parseAll(body, d)
    if (!isRegularGrid(rows)) continue
    const f = finalize(rows, d, null, false)
    return { kind: 'delimited', header: f.header, rows: f.rows }
  }
  return null
}

/** 2행 이상, 열 2개 이상, 모든 행의 열 수가 같고, 빈 칸만 있는 표가 아님. */
function isRegularGrid(rows: string[][]): boolean {
  if (rows.length < 2) return false
  const width = rows[0].length
  if (width < 2) return false
  if (!rows.every((r) => r.length === width)) return false
  return rows.some((r) => r.some((v) => v.trim() !== ''))
}
