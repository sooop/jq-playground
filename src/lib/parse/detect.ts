import type { ColType, Delimiter, ParseResult } from '../data/types'
import { CsvParser } from './csv'

const CANDIDATES: Delimiter[] = [',', '\t', ';', '|']

/** 파일 선택 대화상자의 `accept` 값. */
export const FILE_ACCEPT = ['.csv', '.tsv', '.txt', '.tab', 'text/csv', 'text/plain'].join(',')

/**
 * 구분자 추론.
 *
 * 각 후보로 앞부분을 실제 파싱해서 **행마다 필드 수가 일정한지**를 본다. 인용 안의 구분자에
 * 속지 않으려면 단순 문자 카운트가 아니라 실제 파싱이 필요하다.
 * 편차가 0인 후보를 우선하고, 동률이면 필드 수가 많은 쪽(= 더 잘게 쪼갠 쪽)을 고른다.
 */
export function detectDelimiter(sample: string): Delimiter {
  let best: Delimiter = ','
  let bestScore = -Infinity

  for (const d of CANDIDATES) {
    const p = new CsvParser(d)
    p.push(sample)
    const rows = p.finish().slice(0, 20)
    if (rows.length === 0) continue

    const widths = rows.map((r) => r.length)
    const avg = widths.reduce((a, b) => a + b, 0) / widths.length
    if (avg <= 1) continue // 이 구분자로는 아무것도 쪼개지지 않음

    const variance = widths.reduce((a, w) => a + (w - avg) ** 2, 0) / widths.length
    // 일관성이 압도적으로 중요하고, 그다음이 칼럼 수
    const score = -variance * 100 + avg
    if (score > bestScore) {
      bestScore = score
      best = d
    }
  }
  return best
}

/** 숫자로 볼 수 있는 값인지. 천 단위 콤마, 선행 +/-, 백분율, 통화기호를 허용한다. */
export function looksNumeric(v: string): boolean {
  if (v === '') return false
  const s = v.replace(/[,\s ]/g, '').replace(/^[$€£¥₩+]/, '').replace(/%$/, '')
  if (s === '' || s === '-' || s === '.') return false
  return Number.isFinite(Number(s))
}

/** 숫자 파싱 — 정렬 키 계산에 쓴다. 숫자로 볼 수 없으면 NaN. */
export function parseNumeric(v: string): number {
  if (v === '') return NaN
  let s = v.replace(/[,\s ]/g, '')
  let mul = 1
  if (s.startsWith('(') && s.endsWith(')')) {
    // 회계 표기 (1,234) = -1234
    s = s.slice(1, -1)
    mul = -1
  }
  s = s.replace(/^[$€£¥₩+]/, '')
  if (s.endsWith('%')) {
    s = s.slice(0, -1)
    mul *= 0.01
  }
  const n = Number(s)
  return Number.isFinite(n) ? n * mul : NaN
}

const DATE_RE = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

/** 날짜로 볼 수 있는 값인지. ISO 및 `2024/01/02`, `2024.01.02` 형태만 인정한다. */
export function looksDate(v: string): boolean {
  return !Number.isNaN(parseDate(v))
}

/** 날짜 파싱 — 정렬 키용 epoch ms. 파싱 실패 시 NaN. */
export function parseDate(v: string): number {
  if (!DATE_RE.test(v)) return NaN
  // 구분자는 날짜부(앞 10자 이내)만 바꾼다 — 소수 초의 '.'을 건드리면 파싱이 깨진다
  return Date.parse(v.replace(/^(\d{4})[./](\d{1,2})[./](\d{1,2})/, '$1-$2-$3').replace(' ', 'T'))
}

/**
 * 칼럼 타입 추론. 비어 있지 않은 값을 최대 `sampleLimit`개 훑어 90% 이상이 한 타입이면 그 타입.
 * 전 구간을 균등 샘플링해서(앞부분만 보지 않는다) 헤더 근처 특이값에 속지 않게 한다.
 */
export function detectColType(
  rows: readonly string[][],
  col: number,
  sampleLimit = 500,
): ColType {
  const n = rows.length
  if (n === 0) return 'string'
  const step = Math.max(1, Math.ceil(n / sampleLimit))
  let seen = 0
  let num = 0
  let date = 0
  for (let i = 0; i < n && seen < sampleLimit; i += step) {
    const v = rows[i][col]
    if (v === undefined || v === '') continue
    seen++
    if (looksNumeric(v)) num++
    else if (looksDate(v)) date++
  }
  if (seen === 0) return 'string'
  if (num / seen >= 0.9) return 'number'
  if (date / seen >= 0.9) return 'date'
  return 'string'
}

/**
 * 1행이 헤더인지 추론.
 *
 * 근거: 헤더는 보통 (a) 빈 셀이 없고 (b) 값이 중복되지 않으며 (c) 숫자가 아니다.
 * 데이터 행에 숫자/날짜가 있는데 1행에는 없다면 강한 신호다.
 */
export function detectHasHeader(rows: readonly string[][]): boolean {
  if (rows.length === 0) return false
  const first = rows[0]
  if (first.length === 0) return false

  // (a) 빈 셀이 있으면 헤더로 보기 어렵다 (단, 1칼럼 표는 판단 보류)
  if (first.length > 1 && first.some((v) => v.trim() === '')) return false

  // (b) 칼럼명 중복이 많으면 헤더가 아니다
  const uniq = new Set(first.map((v) => v.trim().toLowerCase()))
  if (first.length > 1 && uniq.size < first.length * 0.8) return false

  // (c) 1행에 숫자/날짜가 섞여 있으면 데이터일 가능성이 높다
  const firstTyped = first.filter((v) => looksNumeric(v) || looksDate(v)).length
  if (firstTyped > 0) return false

  if (rows.length === 1) return false // 데이터 없이 헤더만 있는 건 무의미

  // 데이터 행 쪽에 타입 있는 값이 존재하면 헤더 확정
  const probe = rows.slice(1, Math.min(rows.length, 21))
  for (const r of probe) {
    if (r.some((v) => looksNumeric(v) || looksDate(v))) return true
  }
  // 전부 문자열인 표 — 1행이 비어있지 않고 중복 없으면 헤더로 본다(관행)
  return true
}

/** 중복·빈 칼럼명을 고유하게 만든다. */
export function normalizeHeader(names: readonly string[], width: number): string[] {
  const out: string[] = []
  const used = new Map<string, number>()
  for (let i = 0; i < width; i++) {
    let base = (names[i] ?? '').trim()
    if (base === '') base = columnLabel(i)
    const seen = used.get(base)
    if (seen === undefined) {
      used.set(base, 1)
      out.push(base)
    } else {
      used.set(base, seen + 1)
      out.push(`${base} (${seen + 1})`)
    }
  }
  return out
}

/** 0 → A, 25 → Z, 26 → AA … 스프레드시트식 칼럼 라벨. */
export function columnLabel(i: number): string {
  let n = i
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

/**
 * 파싱된 원시 행 배열을 {@link ParseResult}로 정규화한다.
 * 모든 행을 최대 칼럼 수로 패딩하고, 헤더를 분리한다.
 */
export function finalize(
  raw: string[][],
  delimiter: Delimiter,
  hasHeaderOverride: boolean | null,
  suspectEncoding: boolean,
): ParseResult {
  if (raw.length === 0) {
    return {
      rows: [],
      header: [],
      width: 0,
      delimiter,
      hasHeader: false,
      firstRow: null,
      raggedRows: 0,
      suspectEncoding,
    }
  }

  let width = 0
  for (const r of raw) if (r.length > width) width = r.length

  let ragged = 0
  for (const r of raw) {
    if (r.length < width) {
      ragged++
      while (r.length < width) r.push('')
    }
  }

  const hasHeader = hasHeaderOverride ?? detectHasHeader(raw)
  const firstRow = raw[0]
  const rows = hasHeader ? raw.slice(1) : raw
  const header = hasHeader
    ? normalizeHeader(firstRow, width)
    : normalizeHeader([], width)

  return {
    rows,
    header,
    width,
    delimiter,
    hasHeader,
    firstRow,
    raggedRows: ragged,
    suspectEncoding,
  }
}

/**
 * 바이트를 텍스트로 디코딩한다. UTF-8을 먼저 시도하고, 치환문자(U+FFFD)가 많이 나오면
 * cp949(euc-kr)로 다시 시도한다 — 한국어 CSV에서 흔한 경우.
 */
export function decodeBytes(buf: ArrayBuffer): { text: string; encoding: string; suspect: boolean } {
  const bytes = new Uint8Array(buf)
  // UTF-16 BOM (Excel '유니코드 텍스트')
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    const enc = bytes[0] === 0xff ? 'utf-16le' : 'utf-16be'
    return { text: stripBom(new TextDecoder(enc).decode(bytes)), encoding: enc, suspect: false }
  }
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  const bad = countReplacement(utf8)
  if (bad === 0) return { text: stripBom(utf8), encoding: 'utf-8', suspect: false }

  // 치환문자 비율이 무시할 수준이면 UTF-8 유지
  if (bad / Math.max(1, utf8.length) < 0.0001) {
    return { text: stripBom(utf8), encoding: 'utf-8', suspect: true }
  }

  try {
    const cp949 = new TextDecoder('euc-kr').decode(bytes)
    if (countReplacement(cp949) < bad) {
      return { text: stripBom(cp949), encoding: 'cp949', suspect: false }
    }
  } catch {
    /* 브라우저가 euc-kr을 지원하지 않음 */
  }
  return { text: stripBom(utf8), encoding: 'utf-8', suspect: true }
}

/** 지정한 인코딩으로 강제 디코딩 (사용자가 배너에서 선택했을 때). */
export function decodeAs(buf: ArrayBuffer, encoding: string): string {
  return stripBom(new TextDecoder(encoding).decode(new Uint8Array(buf)))
}

function countReplacement(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 0xfffd) n++
  return n
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}
