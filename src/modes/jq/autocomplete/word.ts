/**
 * 자동완성의 순수 부분 — 커서 주변 단어 인식, 필드 경로 분리, 후보 필터·정렬.
 *
 * 원본에서는 이 계산들이 전부 `textarea` 를 직접 읽었다. 텍스트와 커서 위치만 받도록
 * 떼어 내면 단위 테스트가 가능해지고, Svelte 쪽은 상태만 넘기면 된다.
 */
import type { PipeAnalysis } from '../utils/pipe-analyzer'
import { getFunctionInputType } from '../core/jq-functions'

/** 괄호 인수가 필요한 jq 내장 함수 — 완성 시 `(` 를 함께 넣는다 */
export const FUNCTIONS_WITH_ARGS = new Set([
  'map', 'select', 'sort_by', 'group_by', 'unique_by', 'min_by', 'max_by',
  'map_values', 'any', 'all', 'first', 'last', 'nth', 'until', 'while',
  'repeat', 'limit', 'range', 'recurse', 'walk', 'path', 'del',
  'getpath', 'setpath', 'delpaths', 'has', 'in', 'contains', 'inside',
  'startswith', 'endswith', 'ltrimstr', 'rtrimstr', 'split', 'join',
  'test', 'match', 'capture', 'splits', 'sub', 'gsub', 'scan',
  'indices', 'index', 'rindex', 'pow', 'atan', 'combinations',
  'strftime', 'strptime', 'format', 'flatten', 'error', 'debug',
  'reduce', 'foreach', 'label', 'ascii', 'utf8bytelength', 'with_entries',
  'paths', 'leaf_paths',
])

/** 자동완성 후보 한 건 */
export interface AcItem {
  name: string
  desc: string
  /** `INPUT_TYPE_INFO` 의 키 */
  inputType: string
  signature?: string
  example?: string
  /** 필드 후보일 때 접두를 붙이기 전 전체 경로 */
  fullKey?: string
}

export interface WordInfo {
  word: string
  start: number
  end: number
  /** 바로 앞이 `.` 이거나 커서가 `.` 직후여서 필드 접근인지 */
  isFieldAccess: boolean
  /** 커서가 단어 끝에 있는지(중간이면 자동완성을 띄우지 않는다) */
  isCursorAtWordEnd: boolean
}

/** 커서가 걸친 단어(식별자·`$변수`·`@포맷`)를 찾는다. */
export function getCurrentWord(text: string, cursor: number): WordInfo {
  let start = cursor - 1
  while (start >= 0 && /[a-zA-Z0-9_@$]/.test(text[start]!)) start--
  start++

  let end = cursor
  while (end < text.length && /[a-zA-Z0-9_@$]/.test(text[end]!)) end++

  const charBeforeWord = start > 0 ? text[start - 1] : ''
  const isAfterDot = cursor > 0 && text[cursor - 1] === '.'
  const word = text.substring(start, end)

  return {
    word,
    start,
    end,
    isFieldAccess: charBeforeWord === '.' || (isAfterDot && word === ''),
    isCursorAtWordEnd: cursor === end,
  }
}

export interface FieldAccessContext {
  hasPrefix: boolean
  prefix: string
  currentSegment: string
}

/**
 * 필드 접근 경로를 접두와 현재 세그먼트로 쪼갠다.
 *  `.users`              → { hasPrefix: false, prefix: '',              currentSegment: 'users' }
 *  `.users.profile.c`    → { hasPrefix: true,  prefix: 'users.profile', currentSegment: 'c' }
 *  `.users[].name`       → { hasPrefix: true,  prefix: 'users[]',       currentSegment: 'name' }
 */
export function getFieldAccessContext(text: string, cursor: number): FieldAccessContext {
  // `[]` 는 jq 필드 경로의 일부라 구분자로 보지 않는다
  let start = cursor - 1
  while (start >= 0 && !/[\s|(){},;]/.test(text[start]!)) start--
  start++

  const pathText = text.substring(start, cursor)
  if (!pathText.startsWith('.')) {
    return { hasPrefix: false, prefix: '', currentSegment: pathText }
  }

  const rest = pathText.substring(1)
  const lastDot = rest.lastIndexOf('.')
  if (lastDot === -1) return { hasPrefix: false, prefix: '', currentSegment: rest }

  return {
    hasPrefix: true,
    prefix: rest.substring(0, lastDot),
    currentSegment: rest.substring(lastDot + 1),
  }
}

/** 표시 가능한 후보 최대 개수 */
export const MAX_AUTOCOMPLETE_ITEMS = 15

/** 키 목록을 검색어·접두로 거르고 정렬한다(컨텍스트 키를 앞으로). */
export function filterAndSortKeys(
  allKeys: string[],
  contextKeys: string[],
  searchTerm: string,
  hasPrefix: boolean,
  prefix: string,
): AcItem[] {
  const term = searchTerm.toLowerCase()
  const ctx = new Set(contextKeys)

  return allKeys
    .filter((key) => {
      if (hasPrefix && prefix) {
        if (!key.startsWith(prefix + '.')) return false
        const suffix = key.substring(prefix.length + 1)
        return suffix.split('.')[0]!.toLowerCase().startsWith(term)
      }
      const lowerKey = key.toLowerCase()
      if (lowerKey.startsWith(term)) return true
      return key.split('.').pop()!.toLowerCase().startsWith(term)
    })
    .map((key) => {
      const displayName =
        hasPrefix && prefix && key.startsWith(prefix + '.') ? key.substring(prefix.length + 1) : key
      return {
        name: displayName,
        fullKey: key,
        desc: ctx.has(key) ? 'Context field' : 'Input field',
        inputType: 'field',
      } satisfies AcItem
    })
    .sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(term)
      const bStarts = b.name.toLowerCase().startsWith(term)
      if (aStarts && !bStarts) return -1
      if (!aStarts && bStarts) return 1
      const aCtx = ctx.has(a.fullKey!)
      const bCtx = ctx.has(b.fullKey!)
      if (aCtx && !bCtx) return -1
      if (!aCtx && bCtx) return 1
      return a.name.localeCompare(b.name)
    })
    .slice(0, MAX_AUTOCOMPLETE_ITEMS)
}

/**
 * 완성된 파이프가 없을 때 쓸 기본 컨텍스트 쿼리를 함수의 기대 타입으로 고른다.
 * 예: `map(` 안이고 입력이 배열이면 `.[]` 가 요소 문맥이다.
 */
export function getFallbackContextQuery(analysis: PipeAnalysis, inputData: string): string {
  if (!analysis.isInsideFunction || !analysis.isInsideObjectConstruction) return ''

  let actual: 'array' | 'object' | 'any' = 'any'
  try {
    const parsed = JSON.parse(inputData)
    if (Array.isArray(parsed)) actual = 'array'
    else if (typeof parsed === 'object' && parsed !== null) actual = 'object'
  } catch {
    return ''
  }

  const expected = getFunctionInputType(analysis.functionName ?? '')

  if (expected === 'array' && actual === 'array') return '.[]'
  if (expected === 'object' && actual === 'object') return '.'
  if (expected === 'item') return actual === 'array' ? '.[]' : ''
  if (expected === 'array|object' || expected === 'any') {
    if (actual === 'array') return '.[]'
    if (actual === 'object') return '.'
  }
  return ''
}

/** 긴 경로는 오른쪽을 남긴다 — jq 경로는 뒷부분이 중요하다 */
export function truncatePath(path: string, maxLen = 40): string {
  if (path.length <= maxLen) return path
  return '...' + path.slice(-(maxLen - 3))
}

/** jq 가 `.name` 그대로 받아들이는 식별자인지 — 아니면 대괄호 문자열로 감싸야 한다 */
const BARE_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

function quoteKey(name: string): string {
  return '"' + name.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

/**
 * 필드 후보(`extractKeys` 의 `a.b[].c` 점 경로)를 jq 경로 문법으로 바꾼다.
 * 세그먼트마다 bare 식별자면 그대로, 아니면 `["seg"]` 로 감싼다. 첫 세그먼트는 이미 입력된
 * `.` 뒤에 붙으므로 점을 앞에 두지 않는다 — `.a.["b-c"]` 처럼 점 바로 뒤 대괄호도 유효한 jq 다.
 * 한계: 점 경로 표기라 리터럴 키 `"a.b"` 와 중첩 `a → b` 를 구분할 수 없어 항상 중첩으로 본다.
 */
export function toJqFieldPath(name: string): string {
  return name
    .split('.')
    .map((seg, i) => {
      const m = /^(.*?)((?:\[\])*)$/.exec(seg)!
      const base = m[1]!
      const arr = m[2]!
      const body = BARE_KEY_RE.test(base) ? base : '[' + quoteKey(base) + ']'
      return (i === 0 ? '' : '.') + body + arr
    })
    .join('')
}

/**
 * 후보를 텍스트에 적용한 결과를 계산한다(순수).
 * 괄호가 필요한 함수는 `(` 를 덧붙이되, 바로 뒤가 이미 `(` 면 넣지 않는다.
 * 필드 후보이고 바로 앞이 `.` 이면 {@link toJqFieldPath} 로 jq 경로 문법을 맞춘다
 * (객체 축약형 `{ag` 처럼 앞에 점이 없는 자리에는 적용하지 않는다).
 */
export function applyItem(
  text: string,
  item: AcItem,
  start: number,
  end: number,
): { text: string; cursor: number } {
  if (item.inputType === 'field' && text[start - 1] === '.') {
    const insert = toJqFieldPath(item.name)
    return {
      text: text.substring(0, start) + insert + text.substring(end),
      cursor: start + insert.length,
    }
  }
  const isFunctionWithArgs =
    item.inputType !== 'field' && item.inputType !== 'variable' && FUNCTIONS_WITH_ARGS.has(item.name)
  const insertParen = isFunctionWithArgs && text[end] !== '('
  const insert = item.name + (insertParen ? '(' : '')
  return {
    text: text.substring(0, start) + insert + text.substring(end),
    cursor: start + insert.length,
  }
}

/** 줄 시작(앞이 공백뿐)인지 — Tab 을 순환이 아니라 들여쓰기로 써야 하는 자리 */
export function atLineIndent(text: string, cursor: number): boolean {
  const before = text.substring(0, cursor)
  const sinceNewline = before.substring(before.lastIndexOf('\n') + 1)
  return /^\s*$/.test(sinceNewline)
}
