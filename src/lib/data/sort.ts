import { parseDate, parseNumeric } from '../parse/detect'
import type { ColType, SortSpec } from './types'

/**
 * 정렬 키를 미리 계산한다.
 *
 * number/date 칼럼은 `Float64Array` 숫자 키로 뽑아 두면 비교가 산술 연산 하나로 끝난다.
 * string 칼럼은 `Intl.Collator`로 비교하는데 이게 비싸므로 **정렬에 쓰이는 칼럼만** 준비한다.
 */
export interface SortKeys {
  /** number/date 칼럼용. 빈 값/파싱 실패는 NaN. */
  num: Float64Array | null
  /** string 칼럼용 원본 값 참조 */
  str: string[] | null
}

const collator = new Intl.Collator(undefined, {
  numeric: true, // item2 < item10 자연 정렬
  sensitivity: 'base',
})

export function buildSortKeys(
  rows: readonly string[][],
  col: number,
  type: ColType,
): SortKeys {
  const n = rows.length
  if (type === 'string') {
    const str: string[] = new Array(n)
    for (let i = 0; i < n; i++) str[i] = rows[i][col] ?? ''
    return { num: null, str }
  }
  const num = new Float64Array(n)
  const parse = type === 'number' ? parseNumeric : parseDate
  for (let i = 0; i < n; i++) num[i] = parse(rows[i][col] ?? '')
  return { num, str: null }
}

/**
 * 인덱스 배열을 정렬한다. 원본 `rows`는 건드리지 않는다.
 *
 * - **안정 정렬**: 값이 같으면 원래 인덱스 순서를 유지한다(비교자 마지막 단계에서 인덱스 비교).
 * - **빈 값/파싱 실패는 항상 끝으로** 보낸다 (asc/desc와 무관). Excel과 같은 관행이고,
 *   desc로 뒤집었을 때 빈 칸이 위로 몰려 데이터가 안 보이는 일을 막는다.
 *
 * @param indices 제자리에서 정렬된다(호출부가 복사본을 넘길 책임)
 */
export function sortIndices(
  indices: Uint32Array,
  rows: readonly string[][],
  specs: readonly SortSpec[],
  types: readonly ColType[],
): void {
  if (specs.length === 0 || indices.length < 2) return

  // 정렬에 쓰는 칼럼의 키만 준비
  const keys = specs.map((s) => buildSortKeys(rows, s.col, types[s.col] ?? 'string'))
  const dirs = specs.map((s) => (s.dir === 'asc' ? 1 : -1))

  // Uint32Array.prototype.sort는 비교자를 받지만 안정성이 보장되지 않는다.
  // 일반 배열로 옮겨 Array#sort(안정 보장)를 쓴 뒤 되돌린다.
  const arr = Array.from(indices)

  arr.sort((a, b) => {
    for (let k = 0; k < keys.length; k++) {
      const { num, str } = keys[k]
      const dir = dirs[k]
      if (num !== null) {
        const x = num[a]
        const y = num[b]
        const xn = Number.isNaN(x)
        const yn = Number.isNaN(y)
        if (xn || yn) {
          if (xn && yn) continue
          return xn ? 1 : -1 // 빈 값은 방향과 무관하게 뒤로
        }
        if (x !== y) return x < y ? -dir : dir
      } else if (str !== null) {
        const x = str[a]
        const y = str[b]
        if (x === '' || y === '') {
          if (x === '' && y === '') continue
          return x === '' ? 1 : -1
        }
        const c = collator.compare(x, y)
        if (c !== 0) return c * dir
      }
    }
    return a - b // 안정 정렬 보장
  })

  indices.set(arr)
}

/**
 * 헤더 클릭에 따른 정렬 지시 갱신.
 *
 * - 일반 클릭: 이 칼럼 하나만 남기고 asc → desc → 해제 순환
 * - Shift 클릭: 다중 정렬에 추가하거나, 이미 있으면 asc → desc → 제거
 */
export function toggleSort(
  specs: readonly SortSpec[],
  col: number,
  additive: boolean,
): SortSpec[] {
  const at = specs.findIndex((s) => s.col === col)

  if (!additive) {
    if (at < 0 || specs.length > 1) return [{ col, dir: 'asc' }]
    return specs[at].dir === 'asc' ? [{ col, dir: 'desc' }] : []
  }

  const next = specs.slice()
  if (at < 0) {
    next.push({ col, dir: 'asc' })
    return next
  }
  if (next[at].dir === 'asc') {
    next[at] = { col, dir: 'desc' }
    return next
  }
  next.splice(at, 1)
  return next
}
