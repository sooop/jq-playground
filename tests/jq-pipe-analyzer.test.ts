import { describe, expect, it } from 'vitest'
import { PipeAnalyzer } from '../src/modes/jq/utils/pipe-analyzer'

describe('splitByPipes', () => {
  it('기본 분할과 공백 정리', () => {
    expect(PipeAnalyzer.splitByPipes('.a | .b|.c ')).toEqual(['.a', '.b', '.c'])
  })
  it('괄호·대괄호 안의 파이프는 나누지 않는다', () => {
    expect(PipeAnalyzer.splitByPipes('map(.a | .b) | .c')).toEqual(['map(.a | .b)', '.c'])
    expect(PipeAnalyzer.splitByPipes('[.a | .b] | length')).toEqual(['[.a | .b]', 'length'])
  })
  it('버그 1: 객체 구성 안의 파이프는 나누지 않는다', () => {
    expect(PipeAnalyzer.splitByPipes('.data | {a: .x | length}')).toEqual(['.data', '{a: .x | length}'])
  })
  it('문자열 안의 파이프는 나누지 않는다', () => {
    expect(PipeAnalyzer.splitByPipes('.a | select(.s == "x|y") | .b')).toEqual(['.a', 'select(.s == "x|y")', '.b'])
  })
  it('버그 4: 연속 백슬래시 패리티 — 이스케이프 2쌍 뒤 따옴표는 문자열 종료', () => {
    expect(PipeAnalyzer.splitByPipes('"path\\\\"|keys')).toEqual(['"path\\\\"', 'keys'])
    // 백슬래시 4개 + \" = 이스케이프된 따옴표 → 문자열이 안 끝났으므로 파이프도 문자열 안
    expect(PipeAnalyzer.splitByPipes('"path\\\\\\"|keys')).toEqual(['"path\\\\\\"|keys'])
  })
  it('작은따옴표는 jq 문자열이 아니다 — 뒤를 삼키지 않는다', () => {
    expect(PipeAnalyzer.splitByPipes(".name | test(\"it's\") | .b")).toEqual(['.name', 'test("it\'s")', '.b'])
  })
  it('|= 갱신 연산자는 파이프가 아니다', () => {
    expect(PipeAnalyzer.splitByPipes('.a |= 1 | .b')).toEqual(['.a |= 1', '.b'])
  })
})

describe('analyzeObjectConstruction', () => {
  it('축약형 위치와 불완전 필드', () => {
    const r = PipeAnalyzer.analyzeObjectConstruction('{age, na')
    expect(r.isInsideObjectConstruction).toBe(true)
    expect(r.isShorthandPosition).toBe(true)
    expect(r.incompleteField).toBe('na')
  })
  it('콜론 뒤 필드 접근', () => {
    const r = PipeAnalyzer.analyzeObjectConstruction('{name: .us')
    expect(r.isAfterColon).toBe(true)
    expect(r.incompleteField).toBe('us')
  })
  it('버그 2: 문자열 안의 콜론·콤마를 구문으로 보지 않는다', () => {
    const r = PipeAnalyzer.analyzeObjectConstruction('{key: "value: with, special", name')
    expect(r.isShorthandPosition).toBe(true)
    expect(r.isAfterColon).toBe(false)
    expect(r.incompleteField).toBe('name')
  })
  it('중첩 객체가 닫히면 바깥 객체 문맥으로 돌아간다', () => {
    const r = PipeAnalyzer.analyzeObjectConstruction('{a: {b: 1}, c')
    expect(r.isInsideObjectConstruction).toBe(true)
    expect(r.isShorthandPosition).toBe(true)
    expect(r.incompleteField).toBe('c')
  })
  it('닫힌 객체는 문맥이 아니다', () => {
    expect(PipeAnalyzer.analyzeObjectConstruction('{a: 1} | .b').isInsideObjectConstruction).toBe(false)
  })
  it('괄호 안 콤마는 필드 구분이 아니다', () => {
    const r = PipeAnalyzer.analyzeObjectConstruction('{a: f(1, 2), b: .x')
    expect(r.isAfterColon).toBe(true)
    expect(r.incompleteField).toBe('x')
  })
})

describe('analyzeFunctionContext', () => {
  it('최상위 함수', () => {
    expect(PipeAnalyzer.analyzeFunctionContext('map(.na')).toEqual({
      isInsideFunction: true,
      functionName: 'map',
      fieldPath: '.na',
    })
    expect(PipeAnalyzer.analyzeFunctionContext('select(').fieldPath).toBe('.')
  })
  it('중첩 함수는 가장 안쪽 함수를 돌려준다', () => {
    const r = PipeAnalyzer.analyzeFunctionContext('map(select(.a')
    expect(r.isInsideFunction).toBe(true)
    expect(r.functionName).toBe('select')
    expect(r.fieldPath).toBe('.a')
  })
  it('이미 닫힌 안쪽 함수는 잡지 않고, 인자 안 마지막 파이프 세그먼트가 필드 경로다 (과잉 매칭 수정)', () => {
    const r = PipeAnalyzer.analyzeFunctionContext('map(select(.a) | .b')
    expect(r.isInsideFunction).toBe(true)
    expect(r.functionName).toBe('map')
    expect(r.fieldPath).toBe('.b')
  })
  it('인자 안 마지막 세그먼트가 필드가 아니면 함수 문맥이 아니다', () => {
    expect(PipeAnalyzer.analyzeFunctionContext('map(.a | length').isInsideFunction).toBe(false)
  })
  it('닫힌 함수 뒤는 함수 문맥이 아니다', () => {
    const r = PipeAnalyzer.analyzeFunctionContext('map(.a) | .b')
    expect(r.isInsideFunction).toBe(false)
    expect(r.fieldPath).toBe('map(.a) | .b')
  })
  it('알려지지 않은 함수 안은 함수 문맥이 아니다', () => {
    expect(PipeAnalyzer.analyzeFunctionContext('tostring(.a').isInsideFunction).toBe(false)
  })
  it('단순 필드 경로', () => {
    expect(PipeAnalyzer.analyzeFunctionContext('.users[].na').fieldPath).toBe('.users[].na')
  })
})

describe('extractVariables', () => {
  const vars = (q: string) => PipeAnalyzer.extractVariables(q, q.length).filter((v) => !['$ENV', '$__loc__'].includes(v))
  it('as $var', () => {
    expect(vars('.price as $p | $')).toEqual(['$p'])
  })
  it('객체 구조분해 (콜론)', () => {
    expect(vars('. as {name: $n, age: $a} | $')).toEqual(['$n', '$a'])
  })
  it('버그 3: 단축 구조분해', () => {
    expect(vars('. as {$name, $age} | $name')).toEqual(['$name', '$age'])
  })
  it('중첩·혼합 구조분해', () => {
    expect(vars('. as {a: {$b, c: [$d]}} | .')).toEqual(['$b', '$d'])
  })
  it('배열 구조분해', () => {
    expect(vars('. as [$x, $y] | .')).toEqual(['$x', '$y'])
  })
  it('내장 변수는 항상 있다', () => {
    expect(PipeAnalyzer.extractVariables('.', 1)).toEqual(expect.arrayContaining(['$ENV', '$__loc__']))
  })
  it('커서 뒤의 정의는 무시한다', () => {
    const q = '$ | . as $later'
    expect(vars(q.slice(0, 1))).toEqual([])
  })
})

describe('analyze / effectiveContextQuery', () => {
  it('as 바인딩 세그먼트는 컨텍스트에서 빠진다', () => {
    const q = '.users | .[0] as $u | .'
    const r = PipeAnalyzer.analyze(q, q.length)
    expect(r.completedQuery).toBe('.users | .[0] as $u')
    expect(r.effectiveContextQuery).toBe('.users')
  })
  it('객체 안 파이프가 있어도 현재 세그먼트를 잃지 않는다', () => {
    const q = '.data | {a: .x | length, b: .y'
    const r = PipeAnalyzer.analyze(q, q.length)
    expect(r.depth).toBe(1)
    expect(r.currentSegment).toBe('{a: .x | length, b: .y')
    expect(r.isAfterColon).toBe(true)
    expect(r.incompleteField).toBe('y')
  })
})

describe('getSegmentTransformation', () => {
  it('공백이 있는 호출도 인식한다', () => {
    expect(PipeAnalyzer.getSegmentTransformation('map (.a)').type).toBe('map')
  })
  it('.. 은 필드 접근이 아니다', () => {
    expect(PipeAnalyzer.getSegmentTransformation('..').type).toBe('unknown')
    expect(PipeAnalyzer.getSegmentTransformation('.a').type).toBe('field')
  })
})
