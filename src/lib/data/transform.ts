import type { Dataset } from './dataset.svelte'

/**
 * 열 나누기·결합 변환.
 *
 * 두 변환 모두 **전체 행**을 대상으로 한다. 칼럼의 모양을 바꾸는 조작이라 일부 행만 나누거나
 * 합치면 칼럼이 반쪽만 변환된 일관성 없는 상태가 되기 때문이다(필터가 걸려 있어도 마찬가지).
 * 호출부가 다이얼로그에서 이 점을 명시한다.
 */

export interface SplitSpec {
  /** 구분자. `regex`가 true면 정규식 패턴으로 해석한다. */
  delimiter: string
  regex: boolean
  /** 각 조각의 앞뒤 공백 제거 */
  trim: boolean
  /**
   * 열로 나눌 때 만들 최대 칼럼 수. 어떤 행이 수백 조각으로 쪼개져 칼럼이 폭발하는 것을 막는다.
   * 초과분은 마지막 칼럼에 구분자와 함께 남긴다(데이터를 잃지 않는다).
   */
  maxParts: number
}

export const SPLIT_MAX_PARTS_CAP = 50

/** 구분자를 컴파일한다. 실패하면 에러 메시지를 돌려준다. */
function compileDelimiter(spec: SplitSpec): { re: RegExp } | { error: string } {
  if (spec.delimiter === '') return { error: '구분자를 입력하세요' }
  try {
    const body = spec.regex ? spec.delimiter : spec.delimiter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // split에 쓰므로 g 플래그는 불필요하고, 있으면 lastIndex 상태가 끼어들 수 있다
    return { re: new RegExp(body) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : '잘못된 정규식' }
  }
}

/**
 * 한 셀을 조각으로 나눈다. `limit`을 넘으면 마지막 조각에 나머지를 그대로 남긴다 —
 * 상한 때문에 데이터가 사라지면 안 된다.
 */
export function splitCell(text: string, re: RegExp, trim: boolean, limit: number): string[] {
  if (text === '') return ['']
  let parts = text.split(re)
  if (parts.length > limit) {
    // 앞의 limit-1개를 그대로 두고, 남은 부분은 원문에서 잘라 붙인다
    const head = parts.slice(0, limit - 1)
    // 남은 원문을 찾기 위해 앞부분 길이를 다시 계산한다
    let consumed = 0
    const scan = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    scan.lastIndex = 0
    for (let i = 0; i < limit - 1; i++) {
      const m = scan.exec(text)
      if (!m) break
      consumed = m.index + m[0].length
    }
    parts = [...head, text.slice(consumed)]
  }
  return trim ? parts.map((p) => p.trim()) : parts
}

export interface SplitToColsPlan {
  /** 만들 칼럼 수 */
  count: number
  /** 새 칼럼 이름 */
  names: string[]
  /** `values[rowIndex][k]` = 행 rowIndex의 k번째 새 칼럼 값 */
  values: string[][]
  /** 상한 때문에 더 쪼개지 못한 행 수 */
  cappedRows: number
  error: string | null
}

/** 열 방향 나누기 계획. */
export function planSplitToCols(
  ds: Dataset,
  srcCol: number,
  spec: SplitSpec,
): SplitToColsPlan {
  const empty: SplitToColsPlan = { count: 0, names: [], values: [], cappedRows: 0, error: null }
  const compiled = compileDelimiter(spec)
  if ('error' in compiled) return { ...empty, error: compiled.error }

  const limit = Math.max(2, Math.min(SPLIT_MAX_PARTS_CAP, spec.maxParts))
  const rows = ds.rows
  const per: string[][] = new Array(rows.length)
  let count = 1
  let cappedRows = 0

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i][srcCol] ?? ''
    const natural = raw === '' ? [''] : raw.split(compiled.re)
    if (natural.length > limit) cappedRows++
    const parts = splitCell(raw, compiled.re, spec.trim, limit)
    per[i] = parts
    if (parts.length > count) count = parts.length
  }

  // 모든 행을 같은 길이로 맞춘다
  const values: string[][] = new Array(rows.length)
  for (let i = 0; i < rows.length; i++) {
    const p = per[i]
    const out: string[] = new Array(count)
    for (let k = 0; k < count; k++) out[k] = p[k] ?? ''
    values[i] = out
  }

  const base = ds.header[srcCol] ?? '열'
  const names = Array.from({ length: count }, (_, k) => `${base} ${k + 1}`)
  return { count, names, values, cappedRows, error: null }
}

export interface SplitToRowsPlan {
  /** 변환 후 전체 행 */
  after: string[][]
  /** 변환 후 행 수 */
  rowCount: number
  /** 실제로 여러 행으로 늘어난 원본 행 수 */
  expandedRows: number
  error: string | null
}

/**
 * 행 방향 나누기 계획.
 *
 * 조각이 k개인 행은 k개의 행이 되고, **나머지 열은 그대로 복제된다**.
 * 조각이 하나뿐인 행은 그대로 남는다.
 */
export function planSplitToRows(
  ds: Dataset,
  srcCol: number,
  spec: SplitSpec,
): SplitToRowsPlan {
  const empty: SplitToRowsPlan = { after: [], rowCount: 0, expandedRows: 0, error: null }
  const compiled = compileDelimiter(spec)
  if ('error' in compiled) return { ...empty, error: compiled.error }

  const rows = ds.rows
  const after: string[][] = []
  let expandedRows = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const raw = row[srcCol] ?? ''
    const parts = raw === '' ? [''] : splitCell(raw, compiled.re, spec.trim, Number.MAX_SAFE_INTEGER)
    if (parts.length <= 1) {
      after.push(spec.trim && raw !== parts[0] ? withCell(row, srcCol, parts[0]) : row.slice())
      continue
    }
    expandedRows++
    for (const p of parts) after.push(withCell(row, srcCol, p))
  }

  return { after, rowCount: after.length, expandedRows, error: null }
}

function withCell(row: readonly string[], col: number, value: string): string[] {
  const copy = row.slice()
  copy[col] = value
  return copy
}

export interface JoinSpec {
  /** 결합 구분자. 기본은 공백. */
  separator: string
  /** 빈 값은 건너뛴다 (a + '' + c → "a c") */
  skipEmpty: boolean
  /** 각 값의 앞뒤 공백 제거 */
  trim: boolean
}

export interface JoinPlan {
  /** `values[rowIndex][0]` = 새 칼럼 값 (insertCols의 values 형식에 맞춘 2차원) */
  values: string[][]
  /** 기본 칼럼 이름 */
  suggestedName: string
  /** 미리보기용 앞부분 결과 */
  preview: string[]
}

/**
 * 열 결합 계획. `srcCols`는 **결합할 순서**대로 넘긴다(화면에 보이는 순서).
 */
export function planJoin(ds: Dataset, srcCols: readonly number[], spec: JoinSpec): JoinPlan {
  const rows = ds.rows
  const values: string[][] = new Array(rows.length)
  const buf: string[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    buf.length = 0
    for (const c of srcCols) {
      let v = row[c] ?? ''
      if (spec.trim) v = v.trim()
      if (spec.skipEmpty && v === '') continue
      buf.push(v)
    }
    values[i] = [buf.join(spec.separator)]
  }

  const suggestedName = srcCols.map((c) => ds.header[c] ?? '').join('_') || '결합'
  const preview = values.slice(0, 5).map((v) => v[0])
  return { values, suggestedName, preview }
}
