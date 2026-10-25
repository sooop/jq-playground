/**
 * 열 통계 — 한 열의 값들을 훑어 타입·빈 값·고유값·범위·빈도 상위를 요약한다.
 *
 * 순수 함수라 화면 없이 테스트한다. 입력은 이미 걸러진(보이는) 행의 값 순회자 하나뿐이다.
 */
import { parseNumeric } from '../lib/parse/detect'

export interface TopValue {
  value: string
  count: number
}

export interface ColumnStats {
  /** 훑은 행 수(빈 값 포함) */
  total: number
  empty: number
  /** 고유값 수. 상한을 넘으면 `distinctCapped` 와 함께 하한값이다. */
  distinct: number
  distinctCapped: boolean
  /** 최소·최대(문자열 비교, 숫자 열이면 수치 비교) */
  min: string | null
  max: string | null
  /** 숫자로 읽힌 값이 전부일 때만 채운다 */
  numeric: { n: number; sum: number; mean: number; median: number } | null
  /** 빈도 상위 값(빈 값 제외) */
  top: TopValue[]
  /** 글자 수 범위(빈 값 제외) */
  minLen: number
  maxLen: number
}

/** 고유값 집계에 쓰는 메모리 상한 — 100만 행의 거의 전부가 고유한 열에서도 멈추지 않게 */
export const DISTINCT_CAP = 200_000

export function computeColumnStats(values: Iterable<string>, topN = 10): ColumnStats {
  const counts = new Map<string, number>()
  let capped = false
  let total = 0
  let empty = 0
  let minLen = Infinity
  let maxLen = 0
  let min: string | null = null
  let max: string | null = null

  const nums: number[] = []
  // 숫자 열의 범위는 원본 표기(1,000 · 1e3 등)를 그대로 보여 주려고 문자열도 함께 쥔다
  let numMin = Infinity
  let numMax = -Infinity
  let numMinStr = ''
  let numMaxStr = ''
  let nonEmpty = 0

  for (const v of values) {
    total++
    if (v === '') {
      empty++
      continue
    }
    nonEmpty++
    if (v.length < minLen) minLen = v.length
    if (v.length > maxLen) maxLen = v.length
    if (min === null || v < min) min = v
    if (max === null || v > max) max = v
    const x = parseNumeric(v)
    if (!Number.isNaN(x)) {
      nums.push(x)
      if (x < numMin) {
        numMin = x
        numMinStr = v
      }
      if (x > numMax) {
        numMax = x
        numMaxStr = v
      }
    }

    const c = counts.get(v)
    if (c !== undefined) counts.set(v, c + 1)
    else if (counts.size < DISTINCT_CAP) counts.set(v, 1)
    else capped = true
  }

  let numeric: ColumnStats['numeric'] = null
  if (nonEmpty > 0 && nums.length === nonEmpty) {
    const sorted = Float64Array.from(nums).sort()
    let sum = 0
    for (const x of sorted) sum += x
    const mid = sorted.length >> 1
    const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    numeric = { n: sorted.length, sum, mean: sum / sorted.length, median }
    // 숫자 열의 범위는 문자열 비교가 아니라 수치 비교여야 한다
    min = numMinStr
    max = numMaxStr
  }

  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, topN)
    .map(([value, count]) => ({ value, count }))

  return {
    total,
    empty,
    distinct: counts.size,
    distinctCapped: capped,
    min,
    max,
    numeric,
    top,
    minLen: nonEmpty === 0 ? 0 : minLen,
    maxLen,
  }
}
