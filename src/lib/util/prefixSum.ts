/**
 * 칼럼 폭 배열 → 누적 오프셋. 가상 스크롤에서 가시 칼럼 범위와 좌표 hit test에 쓴다.
 *
 * `offsets[i]`는 i번째 칼럼의 왼쪽 x좌표이고, `offsets[n]`은 전체 폭이다.
 */
export function buildOffsets(widths: readonly number[]): Float64Array {
  const out = new Float64Array(widths.length + 1)
  let acc = 0
  for (let i = 0; i < widths.length; i++) {
    out[i] = acc
    acc += widths[i]
  }
  out[widths.length] = acc
  return out
}

/**
 * x 좌표를 포함하는 칼럼 인덱스를 이진 탐색으로 찾는다.
 * 범위를 벗어나면 0 또는 마지막 칼럼으로 클램프한다.
 */
export function columnAt(offsets: Float64Array, x: number): number {
  const n = offsets.length - 1
  if (n <= 0) return 0
  if (x < 0) return 0
  if (x >= offsets[n]) return n - 1
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsets[mid] <= x) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** [first, last] — x0..x1 픽셀 구간과 겹치는 칼럼 인덱스 범위(양쪽 포함). */
export function visibleColumnRange(
  offsets: Float64Array,
  x0: number,
  x1: number,
  overscan = 2,
): [number, number] {
  const n = offsets.length - 1
  if (n <= 0) return [0, -1]
  const first = Math.max(0, columnAt(offsets, x0) - overscan)
  const last = Math.min(n - 1, columnAt(offsets, Math.max(x0, x1 - 1)) + overscan)
  return [first, last]
}
