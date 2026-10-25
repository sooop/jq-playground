import type { Dataset } from './dataset.svelte'
import type { View } from './view.svelte'

/** 한 건의 매치. 좌표는 **뷰** 기준(행은 viewRows 인덱스, 열은 viewCols 인덱스). */
export interface FindHit {
  r: number
  c: number
  /** 셀 원문 */
  text: string
  /** 셀 안에서 매치된 구간 [start, end) — 목록 미리보기 강조용 */
  at: number
  len: number
}

export interface FindSpec {
  query: string
  regex: boolean
  /** 대소문자 구분. false면 무시. */
  caseSensitive: boolean
  /** 셀 값 전체가 정확히 일치해야 하는지 */
  wholeCell: boolean
}

export interface FindResult {
  hits: FindHit[]
  /** 상한에 걸려 잘렸는지 */
  truncated: boolean
  /** 컴파일 실패 메시지 (정규식이 잘못된 경우) */
  error: string | null
}

/**
 * 매치 상한.
 *
 * "a" 한 글자로 찾으면 10만 × 25 = 250만 건이 나올 수 있다. 목록으로 훑어보는 UI에서
 * 그만큼을 들고 있을 이유가 없고, 메모리·렌더 모두 감당이 안 된다.
 * 상한에 걸리면 UI가 "N+"로 알리고 검색어를 좁히도록 유도한다.
 */
export const FIND_LIMIT = 2000

export const EMPTY_FIND: FindResult = { hits: [], truncated: false, error: null }

/** 정규식 특수문자 이스케이프 — 일반 모드에서 문자열을 정규식으로 쓸 때. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 찾기 실행. **화면에 보이는 범위**(필터·정렬·숨김 적용 후)를 행 우선으로 훑는다.
 * 사용자가 보는 것과 찾는 것이 어긋나지 않아야 하므로 원본 전체가 아니라 뷰를 대상으로 한다.
 *
 * @param bounds 선택 영역 등으로 범위를 제한할 때 (뷰 좌표, 양끝 포함)
 */
export function runFind(
  ds: Dataset,
  view: View,
  spec: FindSpec,
  bounds?: { r0: number; r1: number; c0: number; c1: number },
): FindResult {
  const q = spec.query
  if (q === '') return EMPTY_FIND

  let re: RegExp
  try {
    const body = spec.regex ? q : escapeRe(q)
    re = new RegExp(spec.wholeCell ? `^(?:${body})$` : body, spec.caseSensitive ? 'g' : 'gi')
  } catch (e) {
    return { hits: [], truncated: false, error: e instanceof Error ? e.message : '잘못된 정규식' }
  }

  const rows = ds.rows
  const viewRows = view.viewRows
  const viewCols = view.viewCols

  const r0 = Math.max(0, bounds?.r0 ?? 0)
  const r1 = Math.min(viewRows.length - 1, bounds?.r1 ?? viewRows.length - 1)
  const c0 = Math.max(0, bounds?.c0 ?? 0)
  const c1 = Math.min(viewCols.length - 1, bounds?.c1 ?? viewCols.length - 1)

  const hits: FindHit[] = []
  for (let r = r0; r <= r1; r++) {
    const row = rows[viewRows[r]]
    if (!row) continue
    for (let c = c0; c <= c1; c++) {
      const text = row[viewCols[c]] ?? ''
      if (text === '') continue
      re.lastIndex = 0
      const m = re.exec(text)
      if (m === null) continue
      hits.push({ r, c, text, at: m.index, len: m[0].length })
      if (hits.length >= FIND_LIMIT) return { hits, truncated: true, error: null }
    }
  }
  return { hits, truncated: false, error: null }
}

/**
 * 현재 위치 기준으로 다음(또는 이전) 매치의 인덱스.
 * 목록은 행 우선 정렬이므로 좌표 비교만으로 찾을 수 있다.
 */
export function stepIndex(
  hits: readonly FindHit[],
  from: { r: number; c: number },
  dir: 1 | -1,
): number {
  if (hits.length === 0) return -1
  if (dir === 1) {
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i]
      if (h.r > from.r || (h.r === from.r && h.c > from.c)) return i
    }
    return 0 // 끝을 넘으면 처음으로 순환
  }
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i]
    if (h.r < from.r || (h.r === from.r && h.c < from.c)) return i
  }
  return hits.length - 1
}

/** 매치 셀을 빠르게 조회하기 위한 키. 뷰 좌표 한 쌍을 하나의 수로 접는다. */
export function hitKey(r: number, c: number): number {
  return r * 4096 + c
}

/** 그리드에서 "이 셀이 매치인가"를 O(1)로 묻기 위한 집합. */
export function buildHitSet(hits: readonly FindHit[]): Set<number> {
  const s = new Set<number>()
  for (const h of hits) s.add(hitKey(h.r, h.c))
  return s
}

// ---------------------------------------------------------------------------
// 바꾸기
// ---------------------------------------------------------------------------

export interface ReplaceSpec extends FindSpec {
  /** 바꿀 문자열. 정규식 모드에서는 `$1` 등 역참조를 쓸 수 있다. */
  replacement: string
}

export interface ReplacePlan {
  /** source 좌표의 변경 목록 — 그대로 `cells` op으로 넣을 수 있다 */
  changes: { r: number; c: number; before: string; after: string }[]
  /** 값이 바뀐 셀 수 */
  cells: number
  /** 치환된 건수(한 셀에 여러 건 가능) */
  occurrences: number
  error: string | null
}

/**
 * 바꾸기 계획을 만든다 (적용은 하지 않는다).
 *
 * 미리보기 건수와 실제 적용이 어긋나지 않도록, 화면 표시와 실행이 **같은 함수**를 쓴다.
 *
 * @param scope 'all'은 원본 전체(필터·숨김 무시), 'view'는 보이는 범위, 'selection'은 선택 영역
 */
export function planReplace(
  ds: Dataset,
  view: View,
  spec: ReplaceSpec,
  scope: 'all' | 'view' | 'selection',
  ranges: readonly { r0: number; r1: number; c0: number; c1: number }[] = [],
): ReplacePlan {
  const empty: ReplacePlan = { changes: [], cells: 0, occurrences: 0, error: null }
  if (spec.query === '') return empty

  let re: RegExp
  try {
    const body = spec.regex ? spec.query : escapeRe(spec.query)
    re = new RegExp(spec.wholeCell ? `^(?:${body})$` : body, spec.caseSensitive ? 'g' : 'gi')
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : '잘못된 정규식' }
  }

  // 일반 모드에서는 바꿀 문자열의 `$`가 역참조로 해석되지 않아야 한다
  const replacement = spec.regex ? spec.replacement : spec.replacement.replace(/\$/g, '$$$$')

  const changes: ReplacePlan['changes'] = []
  let occurrences = 0

  const visit = (srcRow: number, srcCol: number) => {
    const row = ds.rows[srcRow]
    if (!row) return
    const before = row[srcCol] ?? ''
    if (before === '') return
    re.lastIndex = 0
    if (!re.test(before)) return
    re.lastIndex = 0
    const matches = before.match(re)
    occurrences += matches ? matches.length : 1
    re.lastIndex = 0
    const after = before.replace(re, replacement)
    if (after !== before) changes.push({ r: srcRow, c: srcCol, before, after })
  }

  if (scope === 'all') {
    for (let r = 0; r < ds.rows.length; r++) {
      for (let c = 0; c < ds.colCount; c++) visit(r, c)
    }
  } else if (scope === 'view') {
    const vr = view.viewRows
    const vc = view.viewCols
    for (let i = 0; i < vr.length; i++) {
      for (let j = 0; j < vc.length; j++) visit(vr[i], vc[j])
    }
  } else {
    const vr = view.viewRows
    const vc = view.viewCols
    const seen = new Set<number>()
    for (const rg of ranges) {
      for (let r = Math.max(0, rg.r0); r <= Math.min(vr.length - 1, rg.r1); r++) {
        for (let c = Math.max(0, rg.c0); c <= Math.min(vc.length - 1, rg.c1); c++) {
          const key = r * 4096 + c
          if (seen.has(key)) continue // 겹치는 범위에서 같은 셀을 두 번 세지 않는다
          seen.add(key)
          visit(vr[r], vc[c])
        }
      }
    }
  }

  return { changes, cells: changes.length, occurrences, error: null }
}
