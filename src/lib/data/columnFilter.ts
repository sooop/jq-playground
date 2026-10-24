import { parseNumeric } from '../parse/detect'
import type { ColType, ColumnFilter } from './types'

/** 칼럼 필터가 실질적으로 아무것도 걸러내지 않는 상태인지. */
export function isEmptyFilter(f: ColumnFilter | undefined): boolean {
  if (!f) return true
  return f.mode === 'values' ? f.excluded.size === 0 : f.query.trim() === ''
}

/** 숫자 조건식. `>100`, `>=1e3`, `10..20`, `!=0`, `100` 등을 해석한다. */
type NumCond = (n: number) => boolean

/**
 * 텍스트 필터 쿼리를 숫자 조건으로 해석해 본다.
 * 숫자 칼럼에서만 시도하고, 해석 불가면 null(→ 문자열 포함 매칭으로 폴백).
 */
export function parseNumCondition(query: string): NumCond | null {
  const q = query.trim()
  if (q === '') return null

  // 범위: 10..20  (양끝 포함)
  const range = /^(-?[\d.,eE+]+)\s*\.\.\s*(-?[\d.,eE+]+)$/.exec(q)
  if (range) {
    const lo = parseNumeric(range[1])
    const hi = parseNumeric(range[2])
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      const [a, b] = lo <= hi ? [lo, hi] : [hi, lo]
      return (n) => n >= a && n <= b
    }
    return null
  }

  const cmp = /^(>=|<=|!=|<>|>|<|=)\s*(.+)$/.exec(q)
  if (cmp) {
    const v = parseNumeric(cmp[2])
    if (!Number.isFinite(v)) return null
    switch (cmp[1]) {
      case '>':
        return (n) => n > v
      case '>=':
        return (n) => n >= v
      case '<':
        return (n) => n < v
      case '<=':
        return (n) => n <= v
      case '!=':
      case '<>':
        return (n) => n !== v
      case '=':
        return (n) => n === v
    }
  }
  return null
}

/** 컴파일된 칼럼 필터 — 값 하나를 받아 통과 여부를 돌려주는 술어. */
export interface CompiledColumnFilter {
  col: number
  test: (v: string) => boolean
}

/**
 * 칼럼 필터들을 술어 배열로 컴파일한다. 행 스캔 루프에서 분기 없이 호출하기 위한 준비.
 * 비어 있는 필터는 결과에서 제외되므로, 반환 배열이 짧으면 그만큼 빠르다.
 */
export function compileColumnFilters(
  filters: ReadonlyMap<number, ColumnFilter>,
  types: readonly ColType[],
): CompiledColumnFilter[] {
  const out: CompiledColumnFilter[] = []
  for (const [col, f] of filters) {
    if (isEmptyFilter(f)) continue

    if (f.mode === 'values') {
      const excluded = f.excluded
      out.push({ col, test: (v) => !excluded.has(v) })
      continue
    }

    const q = f.query.trim()
    const negate = f.negate

    if (f.regex) {
      let re: RegExp
      try {
        re = new RegExp(q, q === q.toLowerCase() ? 'i' : '')
      } catch {
        continue // 잘못된 정규식 → 이 필터는 무시
      }
      out.push({ col, test: (v) => re.test(v) !== negate })
      continue
    }

    // 숫자 칼럼이면 연산자 조건을 먼저 시도
    if (types[col] === 'number') {
      const cond = parseNumCondition(q)
      if (cond) {
        out.push({
          col,
          test: (v) => {
            const n = parseNumeric(v)
            if (Number.isNaN(n)) return negate // 숫자 아닌 값은 조건 불만족으로 취급
            return cond(n) !== negate
          },
        })
        continue
      }
    }

    const needle = q.toLowerCase()
    out.push({ col, test: (v) => v.toLowerCase().includes(needle) !== negate })
  }
  return out
}

export interface UniqueValue {
  value: string
  count: number
}

/**
 * 칼럼의 고유값과 건수를 센다.
 *
 * Excel과 같은 동작을 위해 **다른 칼럼의 필터가 적용된 행들**만 대상으로 한다
 * (그래서 `baseIndices`를 받는다). 스마트 필터는 반영하지 않는다 — 스마트 필터는 임시 검색이고
 * 칼럼 필터는 지속되는 조건이라 섞으면 체크박스 목록이 타이핑에 따라 요동친다.
 *
 * @param limit 반환할 최대 항목 수. 초과분은 `truncated`로 알린다.
 */
export function uniqueValues(
  rows: readonly string[][],
  baseIndices: Uint32Array | readonly number[],
  col: number,
  limit = 1000,
): { values: UniqueValue[]; total: number; truncated: boolean } {
  const counts = new Map<string, number>()
  for (let i = 0; i < baseIndices.length; i++) {
    const v = rows[baseIndices[i]][col] ?? ''
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }

  const total = counts.size
  const all: UniqueValue[] = []
  for (const [value, count] of counts) all.push({ value, count })

  // 건수 내림차순 → 값 오름차순. 자주 나오는 값이 위에 오는 게 실용적이다.
  all.sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0))

  return {
    values: all.length > limit ? all.slice(0, limit) : all,
    total,
    truncated: all.length > limit,
  }
}
