import { describe, expect, it } from 'vitest'
import { jsonToMatrix, matrixToCSV } from '../src/modes/jq/core/csv-converter'
import workerSource from '../src/modes/jq/core/jq-functions.ts?raw'

/**
 * 워커는 문자열로 박힌 사본(`jq-functions.ts`)을 쓴다. 메인 스레드 함수와 규칙이 갈라지면 같은 결과가
 * 경로에 따라 다른 표로 나오므로(과거에 문자열이 글자별 열이 되던 버그), 사본을 꺼내 같은 입력으로 비교한다.
 */
function loadWorkerCopy(): (data: unknown) => { header: string[]; rows: string[][] } {
  const src = workerSource
  const start = src.indexOf('var CSV_MAX_DEPTH')
  const end = src.indexOf('// 워커 시작 시 즉시 초기화')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return new Function(`${src.slice(start, end)}\nreturn workerJsonToMatrix;`)()
}

const workerCopy = loadWorkerCopy()

const LINES = [
  '2.4G MODE',
  'Bluetooth 1',
  'Bluetooth 2',
  'LOCK WIN KEY',
  'KEY SCAN DELAY',
]

describe('객체가 아닌 배열 원소', () => {
  it('문자열 배열은 한 열, 한 줄이 한 행', () => {
    const m = jsonToMatrix(LINES)
    expect(m.header).toEqual(['value'])
    expect(m.rows).toEqual(LINES.map((s) => [s]))
  })

  it('CSV 로도 한 열이다 (쉼표가 있으면 인용)', () => {
    expect(matrixToCSV(...Object.values(jsonToMatrix(['a', 'b,c'])) as [string[], string[][]])).toBe(
      'value\na\n"b,c"\n',
    )
  })

  it('숫자·불리언·null 도 한 열', () => {
    expect(jsonToMatrix([1, true, null]).rows).toEqual([['1'], ['true'], ['']])
  })

  it('객체와 섞이면 스칼라는 value 열에 들어간다', () => {
    const m = jsonToMatrix([{ name: 'a' }, 'raw'])
    expect(m.header).toEqual(['name', 'value'])
    expect(m.rows).toEqual([
      ['a', ''],
      ['', 'raw'],
    ])
  })

  it('최상위 스칼라도 한 행', () => {
    expect(jsonToMatrix('hello')).toEqual({ header: ['value'], rows: [['hello']] })
  })

  it('객체 배열은 전과 같다', () => {
    expect(jsonToMatrix([{ a: 1, b: { c: 2 } }])).toEqual({ header: ['a', 'b_c'], rows: [['1', '2']] })
  })

  it('빈 배열은 빈 표', () => {
    expect(jsonToMatrix([])).toEqual({ header: [], rows: [] })
  })
})

describe('워커 사본과 메인 스레드 함수가 같은 표를 만든다', () => {
  const cases: [string, unknown][] = [
    ['문자열 배열', LINES],
    ['숫자·불리언·null', [1, 2.5, false, null]],
    ['섞임', [{ k: 'v', n: { x: 1 } }, 'raw', 3]],
    ['객체 배열', [{ a: 1 }, { b: 2 }]],
    ['최상위 객체', { a: 1, b: [1, 2] }],
    ['최상위 스칼라', 'text'],
    ['빈 배열', []],
  ]
  for (const [name, data] of cases) {
    it(name, () => {
      expect(workerCopy(structuredClone(data))).toEqual(jsonToMatrix(data))
    })
  }
})
