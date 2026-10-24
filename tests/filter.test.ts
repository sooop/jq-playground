import { describe, expect, it } from 'vitest'
import {
  buildSearchIndex,
  compile,
  getMatchRanges,
  matchRow,
  searchKeyFor,
  splitHighlight,
} from '../src/lib/data/filter'

/** 테스트 편의: 행 하나가 매처를 통과하는지. */
function hit(query: string, row: string[], regex = false): boolean {
  return matchRow(compile(query, regex), row, searchKeyFor(row))
}

describe('compile — 쿼리 문법', () => {
  it('빈 쿼리', () => {
    expect(compile('', false).kind).toBe('empty')
    expect(compile('   ', false).kind).toBe('empty')
  })

  it('공백 = OR', () => {
    expect(compile('kim lee', false).groups).toEqual([['kim', 'lee']])
  })

  it('콤마 = AND', () => {
    expect(compile('kim,active', false).groups).toEqual([['kim'], ['active']])
  })

  it('& = AND', () => {
    expect(compile('kim&active', false).groups).toEqual([['kim'], ['active']])
  })

  it('AND 그룹 안의 OR', () => {
    expect(compile('kim lee, active', false).groups).toEqual([['kim', 'lee'], ['active']])
  })

  it('큰따옴표로 공백·콤마 포함 리터럴', () => {
    expect(compile('"kim, h"', false).groups).toEqual([['kim, h']])
    expect(compile('"a b" c', false).groups).toEqual([['a b', 'c']])
  })

  it('큰따옴표 안의 "" 는 리터럴 따옴표', () => {
    expect(compile('"a""b"', false).groups).toEqual([['a"b']])
  })

  it('연속 구분자와 후행 구분자를 무시', () => {
    expect(compile('a,,b,', false).groups).toEqual([['a'], ['b']])
    expect(compile('  a   b  ', false).groups).toEqual([['a', 'b']])
  })

  it('스마트 케이스: 소문자만이면 대소문자 무시', () => {
    expect(compile('kim', false).caseSensitive).toBe(false)
    expect(compile('Kim', false).caseSensitive).toBe(true)
  })

  it('대소문자 무시일 때 항은 소문자로 정규화', () => {
    expect(compile('kim', false).groups).toEqual([['kim']])
    // 대문자가 있으면 원형 유지
    expect(compile('Kim', false).groups).toEqual([['Kim']])
  })
})

describe('compile — 정규식 모드', () => {
  it('컴파일 성공', () => {
    const m = compile('^\\d+$', true)
    expect(m.kind).toBe('regex')
    expect(m.error).toBeNull()
    expect(m.re).not.toBeNull()
  })

  it('잘못된 정규식은 error를 담고 re는 null', () => {
    const m = compile('([', true)
    expect(m.error).not.toBeNull()
    expect(m.re).toBeNull()
  })

  it('스마트 케이스가 i 플래그를 결정', () => {
    expect(compile('abc', true).re!.flags).toContain('i')
    expect(compile('Abc', true).re!.flags).not.toContain('i')
  })
})

describe('matchRow — 일반 모드', () => {
  const row = ['kim hyun', 'active', '340']

  it('부분 문자열 매치', () => {
    expect(hit('kim', row)).toBe(true)
    expect(hit('hyu', row)).toBe(true)
    expect(hit('zzz', row)).toBe(false)
  })

  it('대소문자 무시 (쿼리가 소문자)', () => {
    expect(hit('KIM'.toLowerCase(), row)).toBe(true)
    expect(hit('active', ['ACTIVE'])).toBe(true)
  })

  it('대소문자 구분 (쿼리에 대문자)', () => {
    expect(hit('Kim', row)).toBe(false)
    expect(hit('Kim', ['Kim'])).toBe(true)
  })

  it('OR: 하나만 맞아도 통과', () => {
    expect(hit('zzz kim', row)).toBe(true)
    expect(hit('zzz yyy', row)).toBe(false)
  })

  it('AND: 전부 맞아야 통과', () => {
    expect(hit('kim,active', row)).toBe(true)
    expect(hit('kim,closed', row)).toBe(false)
  })

  it('AND 그룹 안의 OR 조합', () => {
    expect(hit('kim lee, active', row)).toBe(true)
    expect(hit('kim lee, closed', row)).toBe(false)
    expect(hit('park lee, active', row)).toBe(false)
  })

  it('여러 칼럼에 걸친 AND', () => {
    expect(hit('kim,340', row)).toBe(true)
  })

  it('빈 쿼리는 전부 통과', () => {
    expect(hit('', row)).toBe(true)
  })

  it('검색어가 셀 경계를 넘어 매치되지 않는다', () => {
    // 'ab'와 'cd' 두 셀이 있어도 'bc'는 매치되면 안 된다
    expect(hit('bc', ['ab', 'cd'])).toBe(false)
  })
})

describe('matchRow — 정규식 모드', () => {
  it('앵커가 셀 경계에서 동작', () => {
    expect(hit('^\\d+$', ['abc', '340'], true)).toBe(true)
    expect(hit('^\\d+$', ['abc', '34a'], true)).toBe(false)
  })

  it('패턴 매치', () => {
    expect(hit('k.m', ['kim'], true)).toBe(true)
    expect(hit('^a', ['xa'], true)).toBe(false)
  })

  it('잘못된 정규식은 전부 통과시킨다(필터 미적용)', () => {
    expect(hit('([', ['abc'], true)).toBe(true)
  })

  it('g 플래그의 lastIndex가 행 간에 새지 않는다', () => {
    const m = compile('a', true)
    const rows = [['a'], ['a'], ['a']]
    for (const r of rows) {
      expect(matchRow(m, r, searchKeyFor(r))).toBe(true)
    }
  })
})

describe('buildSearchIndex', () => {
  it('행을 탭으로 합쳐 소문자화', () => {
    expect(buildSearchIndex([['A', 'B']])).toEqual(['a\tb'])
  })

  it('searchKeyFor와 일관', () => {
    const rows = [['Kim', 'Active']]
    expect(buildSearchIndex(rows)[0]).toBe(searchKeyFor(rows[0]))
  })
})

describe('getMatchRanges', () => {
  it('단일 매치', () => {
    expect(getMatchRanges('hello', compile('ell', false))).toEqual([[1, 4]])
  })

  it('여러 매치', () => {
    expect(getMatchRanges('aXaXa', compile('a', false))).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ])
  })

  it('겹치는 구간을 병합', () => {
    // 'abc'와 'bcd'는 [0,3),[1,4) → [0,4)
    expect(getMatchRanges('abcd', compile('abc bcd', false))).toEqual([[0, 4]])
  })

  it('인접 구간을 병합', () => {
    expect(getMatchRanges('abcd', compile('ab cd', false))).toEqual([[0, 4]])
  })

  it('대소문자 무시 매치 위치', () => {
    expect(getMatchRanges('HELLO', compile('ell', false))).toEqual([[1, 4]])
  })

  it('매치 없음', () => {
    expect(getMatchRanges('hello', compile('zzz', false))).toEqual([])
    expect(getMatchRanges('', compile('a', false))).toEqual([])
    expect(getMatchRanges('hello', compile('', false))).toEqual([])
  })

  it('정규식 매치', () => {
    expect(getMatchRanges('a1b22c', compile('\\d+', true))).toEqual([
      [1, 2],
      [3, 5],
    ])
  })

  it('빈 매치 정규식에서 무한루프에 빠지지 않는다', () => {
    expect(getMatchRanges('abc', compile('x*', true))).toEqual([])
  })

  it('여러 번 호출해도 정규식 상태가 오염되지 않는다', () => {
    const m = compile('a', true)
    expect(getMatchRanges('aaa', m)).toEqual([[0, 3]])
    expect(getMatchRanges('aaa', m)).toEqual([[0, 3]])
  })
})

describe('splitHighlight', () => {
  it('매치/비매치 조각으로 분리', () => {
    expect(splitHighlight('xAy', compile('a', false))).toEqual([
      { text: 'x', hit: false },
      { text: 'A', hit: true },
      { text: 'y', hit: false },
    ])
  })

  it('선두·말미 매치', () => {
    expect(splitHighlight('ab', compile('a', false))).toEqual([
      { text: 'a', hit: true },
      { text: 'b', hit: false },
    ])
    expect(splitHighlight('ab', compile('b', false))).toEqual([
      { text: 'a', hit: false },
      { text: 'b', hit: true },
    ])
  })

  it('매치가 없으면 빈 배열 (호출부가 평문 렌더)', () => {
    expect(splitHighlight('abc', compile('z', false))).toEqual([])
  })

  it('조각을 이으면 원본이 된다', () => {
    const text = 'the quick brown fox'
    const pieces = splitHighlight(text, compile('quick fox', false))
    expect(pieces.map((p) => p.text).join('')).toBe(text)
  })
})
