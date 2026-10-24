import { describe, expect, it } from 'vitest'
import { Dataset, invert } from '../src/lib/data/dataset.svelte'
import { searchKeyFor } from '../src/lib/data/filter'
import { sortIndices, toggleSort } from '../src/lib/data/sort'
import {
  compileColumnFilters,
  parseNumCondition,
  uniqueValues,
} from '../src/lib/data/columnFilter'
import { boundingBox, normalize } from '../src/lib/data/selection.svelte'
import { finalize } from '../src/lib/parse/detect'
import type { ColType, ColumnFilter, Op, SortSpec } from '../src/lib/data/types'

function makeDataset(header: string[], rows: string[][]): Dataset {
  const ds = new Dataset()
  ds.loadParsed(finalize([header, ...rows], ',', true, false))
  return ds
}

/** 데이터셋의 관측 가능한 전체 상태 — 라운드트립 비교용 */
function snap(ds: Dataset) {
  return {
    rows: ds.rows.map((r) => r.slice()),
    header: ds.header.slice(),
    colOrder: ds.colOrder.slice(),
    searchIndex: ds.searchIndex.slice(),
  }
}

describe('Dataset.apply / invert 라운드트립', () => {
  const header = ['id', 'name', 'qty']
  const rows = [
    ['1', 'kim', '10'],
    ['2', 'lee', '20'],
    ['3', 'park', '30'],
    ['4', 'choi', '40'],
  ]

  /** op를 적용하고 역연산으로 되돌려 원상복구되는지 확인 */
  function roundtrip(op: Op) {
    const ds = makeDataset(header, rows)
    const before = snap(ds)
    ds.apply(op)
    const after = snap(ds)
    expect(after, '연산이 아무것도 바꾸지 않았다').not.toEqual(before)
    ds.apply(invert(op))
    expect(snap(ds)).toEqual(before)
  }

  it('cells', () => {
    roundtrip({
      t: 'cells',
      changes: [
        { r: 0, c: 1, before: 'kim', after: 'KIM' },
        { r: 2, c: 2, before: '30', after: '999' },
      ],
    })
  })

  it('insertRows — 단일', () => {
    roundtrip({ t: 'insertRows', at: [2], rows: [['9', 'new', '90']] })
  })

  it('insertRows — 비연속 다중', () => {
    roundtrip({
      t: 'insertRows',
      at: [1, 4],
      rows: [
        ['a', 'a', 'a'],
        ['b', 'b', 'b'],
      ],
    })
  })

  it('deleteRows — 연속', () => {
    roundtrip({ t: 'deleteRows', at: [1, 2], rows: [rows[1], rows[2]] })
  })

  it('deleteRows — 비연속 (Ctrl-클릭 선택)', () => {
    roundtrip({ t: 'deleteRows', at: [0, 3], rows: [rows[0], rows[3]] })
  })

  it('placeRows — 연속 블록 이동', () => {
    roundtrip({ t: 'placeRows', picks: [0, 1], dests: [2, 3] })
  })

  it('placeRows — 비연속 선택 이동', () => {
    roundtrip({ t: 'placeRows', picks: [0, 2], dests: [2, 3] })
  })

  it('placeRows — 위로 이동', () => {
    roundtrip({ t: 'placeRows', picks: [3], dests: [0] })
  })

  it('insertCols', () => {
    roundtrip({
      t: 'insertCols',
      at: [1],
      names: ['memo'],
      values: [['a'], ['b'], ['c'], ['d']],
      orderBefore: [0, 1, 2],
      orderAfter: [0, 1, 2, 3],
    })
  })

  it('deleteCols — 단일', () => {
    roundtrip({
      t: 'deleteCols',
      at: [1],
      names: ['name'],
      values: [['kim'], ['lee'], ['park'], ['choi']],
      orderBefore: [0, 1, 2],
      orderAfter: [0, 1],
    })
  })

  it('deleteCols — 비연속 다중', () => {
    roundtrip({
      t: 'deleteCols',
      at: [0, 2],
      names: ['id', 'qty'],
      values: [
        ['1', '10'],
        ['2', '20'],
        ['3', '30'],
        ['4', '40'],
      ],
      orderBefore: [0, 1, 2],
      orderAfter: [0],
    })
  })

  it('setColOrder', () => {
    roundtrip({ t: 'setColOrder', before: [0, 1, 2], after: [1, 2, 0] })
  })

  it('renameCol', () => {
    roundtrip({ t: 'renameCol', c: 0, before: 'id', after: 'ID' })
  })
})

describe('Dataset.apply 결과 검증', () => {
  const header = ['id', 'name']
  const rows = [
    ['1', 'a'],
    ['2', 'b'],
    ['3', 'c'],
  ]

  it('placeRows가 비연속 선택을 연속 블록으로 옮긴다', () => {
    const ds = makeDataset(header, rows)
    // 0번과 2번 행을 끝으로
    ds.apply({ t: 'placeRows', picks: [0, 2], dests: [1, 2] })
    expect(ds.rows).toEqual([
      ['2', 'b'],
      ['1', 'a'],
      ['3', 'c'],
    ])
  })

  it('insertRows가 at[k]에 정확히 놓인다', () => {
    const ds = makeDataset(header, rows)
    ds.apply({
      t: 'insertRows',
      at: [0, 2, 4],
      rows: [
        ['x', 'x'],
        ['y', 'y'],
        ['z', 'z'],
      ],
    })
    expect(ds.rows.map((r) => r[0])).toEqual(['x', '1', 'y', '2', 'z', '3'])
  })

  it('deleteCols가 비연속 칼럼을 정확히 지운다', () => {
    const ds = makeDataset(['a', 'b', 'c', 'd'], [['1', '2', '3', '4']])
    ds.apply({
      t: 'deleteCols',
      at: [0, 2],
      names: ['a', 'c'],
      values: [['1', '3']],
      orderBefore: [0, 1, 2, 3],
      orderAfter: [0, 1],
    })
    expect(ds.header).toEqual(['b', 'd'])
    expect(ds.rows).toEqual([['2', '4']])
  })

  it('cells 편집이 검색 인덱스를 패치한다', () => {
    const ds = makeDataset(header, rows)
    ds.apply({ t: 'cells', changes: [{ r: 0, c: 1, before: 'a', after: 'ZZZ' }] })
    expect(ds.searchIndex[0]).toBe(searchKeyFor(ds.rows[0]))
    expect(ds.searchIndex[0]).toContain('zzz')
  })

  it('구조 변경 후 검색 인덱스가 행과 정렬을 유지한다', () => {
    const ds = makeDataset(header, rows)
    ds.apply({ t: 'deleteRows', at: [1], rows: [rows[1]] })
    expect(ds.searchIndex).toHaveLength(ds.rows.length)
    for (let i = 0; i < ds.rows.length; i++) {
      expect(ds.searchIndex[i]).toBe(searchKeyFor(ds.rows[i]))
    }
  })

  it('placeRows 후에도 검색 인덱스가 행과 짝을 유지한다', () => {
    const ds = makeDataset(header, rows)
    ds.apply({ t: 'placeRows', picks: [0, 2], dests: [0, 1] })
    for (let i = 0; i < ds.rows.length; i++) {
      expect(ds.searchIndex[i]).toBe(searchKeyFor(ds.rows[i]))
    }
  })

  it('setColOrder는 데이터를 바꾸지 않고 뷰 순서만 바꾼다', () => {
    const ds = makeDataset(header, rows)
    const dataBefore = ds.rows.map((r) => r.slice())
    ds.apply({ t: 'setColOrder', before: [0, 1], after: [1, 0] })
    expect(ds.rows).toEqual(dataBefore)
    expect(ds.colOrder).toEqual([1, 0])
    expect(ds.srcCol(0)).toBe(1)
  })
})

describe('sortIndices', () => {
  function idx(n: number): Uint32Array {
    return new Uint32Array(Array.from({ length: n }, (_, i) => i))
  }
  function run(rows: string[][], specs: SortSpec[], types: ColType[]): number[] {
    const a = idx(rows.length)
    sortIndices(a, rows, specs, types)
    return Array.from(a)
  }

  it('숫자 오름/내림차순', () => {
    const rows = [['10'], ['2'], ['33']]
    expect(run(rows, [{ col: 0, dir: 'asc' }], ['number'])).toEqual([1, 0, 2])
    expect(run(rows, [{ col: 0, dir: 'desc' }], ['number'])).toEqual([2, 0, 1])
  })

  it('문자열 자연 정렬 (item2 < item10)', () => {
    const rows = [['item10'], ['item2'], ['item1']]
    expect(run(rows, [{ col: 0, dir: 'asc' }], ['string'])).toEqual([2, 1, 0])
  })

  it('날짜 정렬', () => {
    const rows = [['2024-03-01'], ['2024-01-15'], ['2024-02-20']]
    expect(run(rows, [{ col: 0, dir: 'asc' }], ['date'])).toEqual([1, 2, 0])
  })

  it('빈 값은 asc/desc 모두 뒤로', () => {
    const rows = [['5'], [''], ['1']]
    expect(run(rows, [{ col: 0, dir: 'asc' }], ['number'])).toEqual([2, 0, 1])
    expect(run(rows, [{ col: 0, dir: 'desc' }], ['number'])).toEqual([0, 2, 1])
  })

  it('빈 문자열도 뒤로', () => {
    const rows = [['b'], [''], ['a']]
    expect(run(rows, [{ col: 0, dir: 'asc' }], ['string'])).toEqual([2, 0, 1])
    expect(run(rows, [{ col: 0, dir: 'desc' }], ['string'])).toEqual([0, 2, 1])
  })

  it('안정 정렬 — 같은 값은 원래 순서 유지', () => {
    const rows = [
      ['1', 'a'],
      ['1', 'b'],
      ['1', 'c'],
      ['0', 'd'],
    ]
    const out = run(rows, [{ col: 0, dir: 'asc' }], ['number', 'string'])
    expect(out).toEqual([3, 0, 1, 2])
  })

  it('다중 정렬 — 1차 오름, 2차 내림', () => {
    const rows = [
      ['a', '1'],
      ['a', '3'],
      ['b', '2'],
      ['a', '2'],
    ]
    const out = run(
      rows,
      [
        { col: 0, dir: 'asc' },
        { col: 1, dir: 'desc' },
      ],
      ['string', 'number'],
    )
    expect(out.map((i) => rows[i].join(''))).toEqual(['a3', 'a2', 'a1', 'b2'])
  })

  it('숫자 파싱 실패 값은 뒤로', () => {
    const rows = [['5'], ['N/A'], ['1']]
    expect(run(rows, [{ col: 0, dir: 'asc' }], ['number'])).toEqual([2, 0, 1])
  })

  it('specs가 비면 아무것도 하지 않는다', () => {
    expect(run([['b'], ['a']], [], ['string'])).toEqual([0, 1])
  })
})

describe('toggleSort', () => {
  it('일반 클릭: asc → desc → 해제', () => {
    let s: SortSpec[] = []
    s = toggleSort(s, 0, false)
    expect(s).toEqual([{ col: 0, dir: 'asc' }])
    s = toggleSort(s, 0, false)
    expect(s).toEqual([{ col: 0, dir: 'desc' }])
    s = toggleSort(s, 0, false)
    expect(s).toEqual([])
  })

  it('일반 클릭으로 다른 칼럼을 누르면 그 칼럼만 남는다', () => {
    const s = toggleSort([{ col: 0, dir: 'desc' }], 1, false)
    expect(s).toEqual([{ col: 1, dir: 'asc' }])
  })

  it('다중 정렬 상태에서 일반 클릭하면 단일 정렬로 리셋', () => {
    const s = toggleSort(
      [
        { col: 0, dir: 'asc' },
        { col: 1, dir: 'asc' },
      ],
      0,
      false,
    )
    expect(s).toEqual([{ col: 0, dir: 'asc' }])
  })

  it('Shift 클릭: 추가 → desc → 제거', () => {
    let s: SortSpec[] = [{ col: 0, dir: 'asc' }]
    s = toggleSort(s, 1, true)
    expect(s).toEqual([
      { col: 0, dir: 'asc' },
      { col: 1, dir: 'asc' },
    ])
    s = toggleSort(s, 1, true)
    expect(s).toEqual([
      { col: 0, dir: 'asc' },
      { col: 1, dir: 'desc' },
    ])
    s = toggleSort(s, 1, true)
    expect(s).toEqual([{ col: 0, dir: 'asc' }])
  })
})

describe('parseNumCondition', () => {
  const cases: [string, number, boolean][] = [
    ['>100', 150, true],
    ['>100', 100, false],
    ['>=100', 100, true],
    ['<10', 5, true],
    ['<=10', 11, false],
    ['!=5', 5, false],
    ['<>5', 6, true],
    ['=5', 5, true],
    ['10..20', 15, true],
    ['10..20', 10, true],
    ['10..20', 20, true],
    ['10..20', 21, false],
    ['20..10', 15, true], // 역순 범위도 허용
  ]
  for (const [q, n, want] of cases) {
    it(`${q} vs ${n} → ${want}`, () => {
      const c = parseNumCondition(q)
      expect(c).not.toBeNull()
      expect(c!(n)).toBe(want)
    })
  }

  it('숫자 조건이 아니면 null', () => {
    expect(parseNumCondition('abc')).toBeNull()
    expect(parseNumCondition('>abc')).toBeNull()
    expect(parseNumCondition('')).toBeNull()
  })

  it('천 단위 콤마 허용', () => {
    expect(parseNumCondition('>1,000')!(1500)).toBe(true)
  })
})

describe('compileColumnFilters', () => {
  const types: ColType[] = ['string', 'number']

  function pass(filters: Map<number, ColumnFilter>, row: string[]): boolean {
    const compiled = compileColumnFilters(filters, types)
    return compiled.every((f) => f.test(row[f.col] ?? ''))
  }

  it('values 모드: 제외 목록', () => {
    const f = new Map<number, ColumnFilter>([[0, { mode: 'values', excluded: new Set(['x']) }]])
    expect(pass(f, ['x', '1'])).toBe(false)
    expect(pass(f, ['y', '1'])).toBe(true)
  })

  it('빈 필터는 컴파일 결과에서 제외된다', () => {
    const f = new Map<number, ColumnFilter>([[0, { mode: 'values', excluded: new Set() }]])
    expect(compileColumnFilters(f, types)).toHaveLength(0)
  })

  it('text 모드: 부분 문자열, 대소문자 무시', () => {
    const f = new Map<number, ColumnFilter>([
      [0, { mode: 'text', query: 'AB', regex: false, negate: false }],
    ])
    expect(pass(f, ['xaby', '1'])).toBe(true)
    expect(pass(f, ['xyz', '1'])).toBe(false)
  })

  it('text 모드: negate', () => {
    const f = new Map<number, ColumnFilter>([
      [0, { mode: 'text', query: 'ab', regex: false, negate: true }],
    ])
    expect(pass(f, ['xaby', '1'])).toBe(false)
    expect(pass(f, ['xyz', '1'])).toBe(true)
  })

  it('text 모드: 정규식', () => {
    const f = new Map<number, ColumnFilter>([
      [0, { mode: 'text', query: '^a\\d$', regex: true, negate: false }],
    ])
    expect(pass(f, ['a1', '1'])).toBe(true)
    expect(pass(f, ['ab', '1'])).toBe(false)
  })

  it('잘못된 정규식은 무시된다', () => {
    const f = new Map<number, ColumnFilter>([
      [0, { mode: 'text', query: '([', regex: true, negate: false }],
    ])
    expect(compileColumnFilters(f, types)).toHaveLength(0)
  })

  it('숫자 칼럼은 연산자 조건을 쓴다', () => {
    const f = new Map<number, ColumnFilter>([
      [1, { mode: 'text', query: '>100', regex: false, negate: false }],
    ])
    expect(pass(f, ['x', '150'])).toBe(true)
    expect(pass(f, ['x', '50'])).toBe(false)
  })

  it('숫자 칼럼의 비숫자 값은 조건 불만족', () => {
    const f = new Map<number, ColumnFilter>([
      [1, { mode: 'text', query: '>100', regex: false, negate: false }],
    ])
    expect(pass(f, ['x', 'N/A'])).toBe(false)
  })

  it('문자열 칼럼에서는 >100이 문자열 매칭으로 폴백', () => {
    const f = new Map<number, ColumnFilter>([
      [0, { mode: 'text', query: '>100', regex: false, negate: false }],
    ])
    expect(pass(f, ['a>100b', '1'])).toBe(true)
    expect(pass(f, ['150', '1'])).toBe(false)
  })
})

describe('uniqueValues', () => {
  const rows = [['a'], ['b'], ['a'], ['c'], ['a']]
  const all = new Uint32Array([0, 1, 2, 3, 4])

  it('건수 내림차순으로 집계', () => {
    const r = uniqueValues(rows, all, 0)
    expect(r.total).toBe(3)
    expect(r.truncated).toBe(false)
    expect(r.values).toEqual([
      { value: 'a', count: 3 },
      { value: 'b', count: 1 },
      { value: 'c', count: 1 },
    ])
  })

  it('baseIndices 범위만 집계', () => {
    const r = uniqueValues(rows, new Uint32Array([0, 1]), 0)
    expect(r.total).toBe(2)
    expect(r.values.map((v) => v.value).sort()).toEqual(['a', 'b'])
  })

  it('limit 초과 시 truncated', () => {
    const r = uniqueValues(rows, all, 0, 2)
    expect(r.values).toHaveLength(2)
    expect(r.total).toBe(3)
    expect(r.truncated).toBe(true)
  })

  it('빈 값도 하나의 고유값', () => {
    const r = uniqueValues([[''], ['x']], new Uint32Array([0, 1]), 0)
    expect(r.total).toBe(2)
  })
})

describe('selection 유틸', () => {
  it('normalize', () => {
    expect(normalize({ r0: 5, r1: 2, c0: 3, c1: 1, kind: 'cell' })).toEqual({
      r0: 2,
      r1: 5,
      c0: 1,
      c1: 3,
      kind: 'cell',
    })
  })

  it('boundingBox', () => {
    expect(
      boundingBox([
        { r0: 1, r1: 2, c0: 1, c1: 1, kind: 'cell' },
        { r0: 5, r1: 5, c0: 0, c1: 3, kind: 'cell' },
      ]),
    ).toEqual({ r0: 1, r1: 5, c0: 0, c1: 3, kind: 'cell' })
  })

  it('boundingBox 빈 배열', () => {
    expect(boundingBox([])).toBeNull()
  })
})
