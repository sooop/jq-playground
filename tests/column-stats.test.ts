import { describe, expect, it } from 'vitest'
import { computeColumnStats } from '../src/viewer/columnStats'

describe('computeColumnStats', () => {
  it('빈 값·고유값·빈도 상위를 센다', () => {
    const s = computeColumnStats(['a', 'b', '', 'a', 'c', 'a', 'b', ''])
    expect(s.total).toBe(8)
    expect(s.empty).toBe(2)
    expect(s.distinct).toBe(3)
    expect(s.top).toEqual([
      { value: 'a', count: 3 },
      { value: 'b', count: 2 },
      { value: 'c', count: 1 },
    ])
    expect(s.numeric).toBeNull()
    expect(s.min).toBe('a')
    expect(s.max).toBe('c')
  })

  it('전부 숫자면 합·평균·중앙값과 수치 범위를 낸다(문자열 비교 아님)', () => {
    const s = computeColumnStats(['10', '9', '1,000', '', '2'])
    expect(s.numeric).toEqual({ n: 4, sum: 1021, mean: 255.25, median: 9.5 })
    expect(s.min).toBe('2')
    expect(s.max).toBe('1,000')
  })

  it('숫자가 섞인 열은 숫자 통계를 내지 않는다', () => {
    const s = computeColumnStats(['1', '2', 'x'])
    expect(s.numeric).toBeNull()
  })

  it('전부 빈 값이면 길이 0·범위 null', () => {
    const s = computeColumnStats(['', ''])
    expect(s).toMatchObject({ total: 2, empty: 2, distinct: 0, min: null, max: null, minLen: 0, maxLen: 0, top: [] })
  })

  it('빈도가 같으면 값 순으로 정렬하고 topN 으로 자른다', () => {
    const s = computeColumnStats(['b', 'a', 'c'], 2)
    expect(s.top.map((t) => t.value)).toEqual(['a', 'b'])
  })
})
