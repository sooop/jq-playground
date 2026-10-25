/**
 * jq 파이프 체인 분석기 — 커서 앞 쿼리를 파이프 세그먼트로 나누고, 마지막 세그먼트가
 * 함수 인자 안인지 · 객체 구성 안인지 · `as $var` 바인딩 뒤인지를 판단한다. 자동완성 엔진이
 * "지금 커서 위치에서 어떤 후보를 보여줄지"를 정하는 근거다.
 *
 * 문자 단위 스캔 대신 `jq-tokenizer`의 토큰 스트림 위에서 동작한다. 원본(jq-playground)의
 * 정규식·수동 스캔 구현에 있던 결함들이 이 한 번의 교체로 함께 사라진다:
 *  - 객체 구성 안의 파이프(`{a: .x | length}`)를 최상위 파이프로 잘못 쪼갬 (중괄호 깊이 미추적)
 *  - 문자열 리터럴 안의 `:` `,`를 구문 요소로 오인 (`{k: "a: b, c", name`)
 *  - 단축 구조분해(`as {$a, $b}`)의 변수 미추출
 *  - `"path\\\\"` 같은 연속 백슬래시의 패리티 미확인으로 문자열 경계 오판
 *  - jq에 없는 작은따옴표를 문자열 구분자로 취급해 `test("it's")` 뒤를 통째로 삼킴
 *  - 중첩 객체가 닫힌 뒤(`{a: {b: 1}, c`) 바깥 중괄호로 돌아가지 못함
 *  - 중첩 함수 판정 정규식(`[^)]*`)이 `map(select(.a) | .b`에서 이미 닫힌 `select(`를 잡음
 *  - `getSegmentTransformation`의 `startsWith('map(')`가 `map (`을 놓치고 `..`을 필드 접근으로 봄
 */
import { computeNesting, splitTokensByPipe, tokenize, type Token } from './jq-tokenizer'

/** `analyzeObjectConstruction` 결과 */
export interface ObjectContext {
  isInsideObjectConstruction: boolean
  isAfterColon: boolean
  isShorthandPosition: boolean
  incompleteField: string
}

/** `analyzeFunctionContext` 결과 */
export interface FunctionContext {
  isInsideFunction: boolean
  functionName: string | null
  fieldPath: string
}

/** `analyze` 결과 — 함수·객체 문맥을 펼쳐 담는다 */
export interface PipeAnalysis extends FunctionContext, ObjectContext {
  segments: string[]
  currentSegment: string
  completedQuery: string
  effectiveContextQuery: string
  depth: number
}

/** `getSegmentTransformation` 결과 */
export interface SegmentTransformation {
  type: string
  unwrapsArray?: boolean
  producesArray?: boolean
  preservesStructure?: boolean
  producesNestedArray?: boolean
  preservesArray?: boolean
  accessesField?: boolean
}

/** 인자로 받은 필터를 "각 요소에" 적용하는 함수 — 이 안에서는 요소의 필드를 제안한다 */
const FIELD_FUNCS = new Set([
  'map',
  'select',
  'sort_by',
  'group_by',
  'unique_by',
  'min_by',
  'max_by',
  'map_values',
  'any',
  'all',
  'first',
  'last',
  'until',
  'while',
  'recurse_down',
])

const isTrivia = (t: Token): boolean => t.type === 'whitespace' || t.type === 'comment'

/** 토큰 구간을 원문에서 잘라낸다 (토큰 값을 이어 붙이면 원문 공백이 어긋날 수 있다) */
function sliceOf(text: string, tokens: Token[]): string {
  if (tokens.length === 0) return ''
  return text.slice(tokens[0].start, tokens[tokens.length - 1].end)
}

export class PipeAnalyzer {
  /** 커서 위치에서의 문맥 분석 */
  static analyze(query: string, cursor: number): PipeAnalysis {
    const beforeCursor = query.substring(0, cursor)
    const segments = this.splitByPipes(beforeCursor)
    const lastSegment = segments[segments.length - 1] || ''

    const funcContext = this.analyzeFunctionContext(lastSegment)
    const objectContext = this.analyzeObjectConstruction(lastSegment)

    const completedSegments = segments.slice(0, -1)
    const completedQuery = completedSegments.join(' | ')
    const effectiveContextQuery = this.calculateEffectiveContextQuery(completedSegments)

    return {
      segments,
      currentSegment: lastSegment,
      completedQuery,
      effectiveContextQuery,
      depth: segments.length - 1,
      ...funcContext,
      ...objectContext,
    }
  }

  /** `EXPR as $var` 바인딩 세그먼트 파싱 */
  static parseAsBinding(segment: string): { expression: string; variable: string } | null {
    const match = segment.match(/^(.+?)\s+as\s+(\$\w+)\s*$/)
    return match ? { expression: match[1]!.trim(), variable: match[2]! } : null
  }

  /**
   * `as $var`는 값을 변수에 묶고 **원래 입력을 그대로 통과**시키므로, 컨텍스트 쿼리는
   * `as` 세그먼트 앞까지다.
   */
  static calculateEffectiveContextQuery(completedSegments: string[]): string {
    if (completedSegments.length === 0) return ''
    const lastSegment = completedSegments[completedSegments.length - 1]
    if (this.parseAsBinding(lastSegment)) return completedSegments.slice(0, -1).join(' | ')
    return completedSegments.join(' | ')
  }

  /**
   * 객체 구성 문맥 — `{name, age}`, `{key: .field}`, `{name, username: .name` 등.
   *
   * 마지막으로 **닫히지 않은** `{`를 스택으로 찾는다(중첩 객체가 닫히면 바깥 것으로 돌아간다).
   * 그 안에서 같은 깊이의 마지막 `,` 뒤가 현재 필드다. 문자열 안의 `:` `,`는 토큰이 아니므로
   * 자연히 무시된다.
   */
  static analyzeObjectConstruction(segment: string): ObjectContext {
    const result: ObjectContext = {
      isInsideObjectConstruction: false,
      isAfterColon: false,
      isShorthandPosition: false,
      incompleteField: '',
    }

    const tokens = tokenize(segment)
    const openBraces: number[] = []
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]
      if (t.type === 'lbrace') openBraces.push(i)
      else if (t.type === 'rbrace') openBraces.pop()
    }
    if (openBraces.length === 0) return result

    result.isInsideObjectConstruction = true
    const braceIdx = openBraces[openBraces.length - 1]
    const inner = tokens.slice(braceIdx + 1)
    const nesting = computeNesting(inner)

    // 중괄호 바로 안 깊이(모두 0)의 마지막 콤마 뒤가 현재 필드
    let lastComma = -1
    for (let i = 0; i < inner.length; i++) {
      const n = nesting[i]
      if (inner[i].type === 'comma' && n.parenDepth === 0 && n.bracketDepth === 0 && n.braceDepth === 0) {
        lastComma = i
      }
    }
    const field = inner.slice(lastComma + 1)
    const fieldNesting = nesting.slice(lastComma + 1)
    const colonIdx = field.findIndex(
      (t, i) =>
        t.type === 'colon' &&
        fieldNesting[i].parenDepth === 0 &&
        fieldNesting[i].bracketDepth === 0 &&
        fieldNesting[i].braceDepth === 0,
    )

    if (colonIdx >= 0) {
      result.isAfterColon = true
      const afterColon = sliceOf(segment, field.slice(colonIdx + 1)).trim()
      if (afterColon.startsWith('.')) {
        const m = afterColon.match(/^\.(\w*)/)
        result.incompleteField = m ? m[1]! : ''
      }
    } else {
      result.isShorthandPosition = true
      const current = sliceOf(segment, field).trim()
      const m = current.match(/^(\w*)$/)
      result.incompleteField = m ? m[1]! : ''
    }
    return result
  }

  /**
   * 최상위 파이프로 분할 — 괄호·대괄호·중괄호 어느 것도 열려 있지 않은 `|`에서만 나눈다.
   * `|=`는 별도 연산자 토큰이라 나누지 않는다.
   */
  static splitByPipes(query: string): string[] {
    const tokens = tokenize(query)
    return splitTokensByPipe(tokens)
      .map((seg) => sliceOf(query, seg).trim())
      .filter((s) => s !== '')
  }

  /**
   * 함수 인자 문맥 — `map(.field`, `select(.a > 0) | map(select(.b` 등.
   *
   * 닫히지 않은 `(`들을 스택으로 추적해, 그중 **가장 안쪽**의 알려진 함수 호출을 고른다.
   * 그 함수 이름과 `(` 뒤의 텍스트(필드 경로)를 돌려준다. 원본은 중첩이면 `'nested'`라는
   * 가짜 이름을 돌려줬지만, 후보를 고르는 데 필요한 것은 실제 안쪽 함수의 입력 타입이다.
   */
  static analyzeFunctionContext(segment: string): FunctionContext {
    const tokens = tokenize(segment)
    // [lparen 인덱스, 앞 식별자] 스택
    const open: { paren: number; name: string | null }[] = []
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]
      if (t.type === 'lparen') {
        let j = i - 1
        while (j >= 0 && isTrivia(tokens[j])) j--
        const prev = j >= 0 ? tokens[j] : null
        open.push({ paren: i, name: prev && prev.type === 'ident' ? prev.value : null })
      } else if (t.type === 'rparen') {
        open.pop()
      }
    }

    for (let k = open.length - 1; k >= 0; k--) {
      const { paren, name } = open[k]
      if (!name || !FIELD_FUNCS.has(name)) continue
      // 인자 안에 파이프가 있으면(`map(select(.a) | .b`) 마지막 파이프 세그먼트가 현재 필드 경로다
      const inner = this.splitByPipes(segment.slice(tokens[paren].end))
      const after = inner.length > 0 ? inner[inner.length - 1] : ''
      // 인자 자리가 비었거나 필드 경로·객체 구성으로 시작할 때만 "필드를 제안할 문맥"이다
      if (after !== '' && !after.startsWith('.') && !after.startsWith('{')) break
      return { isInsideFunction: true, functionName: name, fieldPath: after || '.' }
    }

    const fieldMatch = segment.match(/^\s*(\.[\w.[\]]*)?$/)
    return {
      isInsideFunction: false,
      functionName: null,
      fieldPath: fieldMatch ? fieldMatch[1] || segment : segment,
    }
  }

  /**
   * 커서 앞에서 정의된 변수 — `EXPR as $x`, 구조분해 `as {key: $v, $short}` / `as [$a, $b]`
   * (중첩·`?//` 대안 포함), 그리고 항상 있는 `$ENV` `$__loc__`.
   */
  static extractVariables(query: string, cursor: number): string[] {
    const tokens = tokenize(query.substring(0, cursor)).filter((t) => !isTrivia(t))
    const variables = new Set<string>()

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]
      if (t.type !== 'keyword' || t.value !== 'as') continue
      const next = tokens[i + 1]
      if (!next) continue
      if (next.type === 'variable') {
        variables.add(next.value)
        continue
      }
      if (next.type === 'lbrace' || next.type === 'lbracket') {
        // 패턴이 닫힐 때까지의 모든 변수 토큰 — 키 자리에 `$var`는 올 수 없으므로 전부 바인딩이다
        let depth = 0
        for (let j = i + 1; j < tokens.length; j++) {
          const u = tokens[j]
          if (u.type === 'lbrace' || u.type === 'lbracket') depth++
          else if (u.type === 'rbrace' || u.type === 'rbracket') {
            depth--
            if (depth === 0) break
          } else if (u.type === 'variable') variables.add(u.value)
        }
      }
    }

    variables.add('$ENV')
    variables.add('$__loc__')
    return [...variables]
  }

  /** 배열 접근(`[]`, `[n]`)이 있는지 */
  static hasArrayAccess(segment: string): boolean {
    return /\[\]|\[\d+\]/.test(segment)
  }

  /** 세그먼트가 입력을 어떻게 바꾸는지 — 컨텍스트 추론의 힌트 */
  static getSegmentTransformation(segment: string): SegmentTransformation {
    const trimmed = segment.trim()
    if (trimmed === '.[]' || trimmed.endsWith('[]')) return { type: 'iterate', unwrapsArray: true }
    if (/\[\d+\]$/.test(trimmed)) return { type: 'index', unwrapsArray: true }
    if (/^(map|map_values)\s*\(/.test(trimmed)) return { type: 'map', producesArray: true }
    if (/^select\s*\(/.test(trimmed)) return { type: 'filter', preservesStructure: true }
    if (/^group_by\s*\(/.test(trimmed)) return { type: 'group', producesNestedArray: true }
    if (/^(sort_by|unique_by)\s*\(/.test(trimmed)) return { type: 'sort', preservesArray: true }
    // `..`(재귀 하강)은 필드 접근이 아니다
    if (/^\.(?!\.)/.test(trimmed)) return { type: 'field', accessesField: true }
    return { type: 'unknown' }
  }
}
