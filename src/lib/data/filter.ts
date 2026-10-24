import type { Matcher } from './types'

/** 문자열에 대문자가 있는지 — 스마트 케이스 판정. */
function hasUpper(s: string): boolean {
  return s !== s.toLowerCase()
}

/**
 * 스마트 필터 쿼리를 컴파일한다.
 *
 * 일반 모드 문법:
 * ```
 *   최상위: ',' 또는 '&' 로 분리  → AND 그룹
 *   그룹 내: 공백으로 분리         → OR 항
 *   "큰따옴표"로 감싸면 공백·콤마를 포함한 리터럴
 * ```
 * 예) `kim lee, active` → (kim OR lee) AND (active)
 *
 * 스마트 케이스: 쿼리에 대문자가 없으면 대소문자를 구분하지 않는다.
 */
export function compile(query: string, regexMode: boolean): Matcher {
  const q = query.trim()
  if (q === '') {
    return { kind: 'empty', caseSensitive: false, groups: [], re: null, error: null }
  }

  const caseSensitive = hasUpper(q)

  if (regexMode) {
    try {
      const re = new RegExp(q, caseSensitive ? 'g' : 'gi')
      return { kind: 'regex', caseSensitive, groups: [], re, error: null }
    } catch (e) {
      return {
        kind: 'regex',
        caseSensitive,
        groups: [],
        re: null,
        error: e instanceof Error ? e.message : '잘못된 정규식',
      }
    }
  }

  const groups = parseTerms(q, caseSensitive)
  if (groups.length === 0) {
    return { kind: 'empty', caseSensitive, groups: [], re: null, error: null }
  }
  return { kind: 'terms', caseSensitive, groups, re: null, error: null }
}

/**
 * 쿼리를 AND 그룹 × OR 항으로 쪼갠다. 큰따옴표 안에서는 구분자를 무시한다.
 * 항은 `caseSensitive`가 false면 미리 소문자화해 둔다(매칭 때 반복 변환을 피하려고).
 */
function parseTerms(q: string, caseSensitive: boolean): string[][] {
  const groups: string[][] = []
  let group: string[] = []
  let term = ''
  let quoted = false

  const flushTerm = () => {
    if (term !== '') {
      group.push(caseSensitive ? term : term.toLowerCase())
      term = ''
    }
  }
  const flushGroup = () => {
    flushTerm()
    if (group.length > 0) {
      groups.push(group)
      group = []
    }
  }

  for (let i = 0; i < q.length; i++) {
    const ch = q[i]
    if (quoted) {
      if (ch === '"') {
        // "" → 리터럴 따옴표
        if (q[i + 1] === '"') {
          term += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        term += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
    } else if (ch === ',' || ch === '&') {
      flushGroup()
    } else if (ch === ' ' || ch === '\t') {
      flushTerm()
    } else {
      term += ch
    }
  }
  flushGroup()
  return groups
}

/**
 * 대소문자 무시 검색용으로 각 행을 하나의 소문자 문자열로 합쳐 둔 배열을 만든다.
 *
 * 이게 성능의 핵심이다. 10만 행 × 25 칼럼 = 250만 셀을 매 키 입력마다 훑는 대신,
 * 행마다 `indexOf` 한 번으로 끝낸다(10만 행 ≈ 10~20ms).
 * 셀 구분자로 `\t`를 쓰므로 검색어가 셀 경계를 넘어 매치되는 일은 실질적으로 없다.
 */
export function buildSearchIndex(rows: readonly string[][]): string[] {
  const out: string[] = new Array(rows.length)
  for (let i = 0; i < rows.length; i++) out[i] = rows[i].join('\t').toLowerCase()
  return out
}

/** 한 행의 검색 인덱스 항목을 다시 만든다 (편집 후 패치용). */
export function searchKeyFor(row: readonly string[]): string {
  return row.join('\t').toLowerCase()
}

/** 대소문자 무시 모드: 합쳐 둔 행 문자열 하나로 판정 — 가장 빠른 경로. */
function matchTermsFast(hay: string, groups: readonly string[][]): boolean {
  for (let g = 0; g < groups.length; g++) {
    const or = groups[g]
    let any = false
    for (let t = 0; t < or.length; t++) {
      if (hay.includes(or[t])) {
        any = true
        break
      }
    }
    if (!any) return false
  }
  return true
}

/** 대소문자 구분 모드: 원본 셀을 훑는다. 첫 매치에서 조기 종료. */
function matchTermsCells(row: readonly string[], groups: readonly string[][]): boolean {
  for (let g = 0; g < groups.length; g++) {
    const or = groups[g]
    let any = false
    outer: for (let t = 0; t < or.length; t++) {
      const needle = or[t]
      for (let c = 0; c < row.length; c++) {
        if (row[c].includes(needle)) {
          any = true
          break outer
        }
      }
    }
    if (!any) return false
  }
  return true
}

/**
 * 정규식 모드: 셀 단위로 판정한다.
 *
 * 합쳐 둔 행 문자열을 쓰면 `^`/`$` 앵커가 셀 경계가 아니라 행 경계에서 동작해
 * `^\d+$` 같은 흔한 패턴이 무용지물이 되므로 셀 단위가 맞다.
 */
function matchRegexCells(row: readonly string[], re: RegExp): boolean {
  for (let c = 0; c < row.length; c++) {
    re.lastIndex = 0
    if (re.test(row[c])) return true
  }
  return false
}

/** 한 행이 매처를 통과하는지. */
export function matchRow(
  m: Matcher,
  row: readonly string[],
  searchKey: string,
): boolean {
  switch (m.kind) {
    case 'empty':
      return true
    case 'terms':
      return m.caseSensitive
        ? matchTermsCells(row, m.groups)
        : matchTermsFast(searchKey, m.groups)
    case 'regex':
      return m.re === null ? true : matchRegexCells(row, m.re)
  }
}

/**
 * 셀 텍스트에서 매치 구간을 찾는다 — 하이라이트 렌더링용.
 *
 * **화면에 보이는 행에만** 호출한다(약 50행 × 25칼럼). 필터 판정 경로와 완전히 분리되어 있어
 * 여기서 비용을 조금 써도 전체 성능에 영향이 없다.
 * 겹치는 구간은 병합해서 정렬된 [start, end) 목록으로 돌려준다.
 */
export function getMatchRanges(text: string, m: Matcher): [number, number][] {
  if (m.kind === 'empty' || text === '') return []
  const spans: [number, number][] = []

  if (m.kind === 'regex') {
    if (m.re === null) return []
    m.re.lastIndex = 0
    let guard = 0
    let hit: RegExpExecArray | null
    while ((hit = m.re.exec(text)) !== null && guard++ < 1000) {
      if (hit[0].length === 0) {
        m.re.lastIndex++ // 빈 매치 무한루프 방지
        continue
      }
      spans.push([hit.index, hit.index + hit[0].length])
    }
  } else {
    const hay = m.caseSensitive ? text : text.toLowerCase()
    for (const or of m.groups) {
      for (const needle of or) {
        if (needle === '') continue
        let from = 0
        for (;;) {
          const at = hay.indexOf(needle, from)
          if (at < 0) break
          spans.push([at, at + needle.length])
          from = at + needle.length
        }
      }
    }
  }

  if (spans.length === 0) return []
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: [number, number][] = [spans[0]]
  for (let i = 1; i < spans.length; i++) {
    const last = merged[merged.length - 1]
    if (spans[i][0] <= last[1]) {
      if (spans[i][1] > last[1]) last[1] = spans[i][1]
    } else {
      merged.push(spans[i])
    }
  }
  return merged
}

/** 하이라이트 렌더링용 조각 목록. `hit`이 true인 조각을 강조한다. */
export interface Piece {
  text: string
  hit: boolean
}

/** 셀 텍스트를 매치/비매치 조각으로 쪼갠다. 매치가 없으면 빈 배열(호출부에서 평문 렌더). */
export function splitHighlight(text: string, m: Matcher): Piece[] {
  const ranges = getMatchRanges(text, m)
  if (ranges.length === 0) return []
  const out: Piece[] = []
  let pos = 0
  for (const [s, e] of ranges) {
    if (s > pos) out.push({ text: text.slice(pos, s), hit: false })
    out.push({ text: text.slice(s, e), hit: true })
    pos = e
  }
  if (pos < text.length) out.push({ text: text.slice(pos), hit: false })
  return out
}
