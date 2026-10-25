/**
 * 두 가지 퍼지 매칭 — 원본에 있던 것을 그대로 옮겼다(점수 체계가 서로 다르므로 합치지 않는다).
 *
 * `fuzzyMatch` 는 히스토리·저장 쿼리 목록(부분 수열 + 연속 보너스),
 * `fuzzyScore` 는 커맨드 팰릿(부분 문자열을 먼저 크게 치고 그다음 부분 수열)에 쓴다.
 */

export interface FuzzyResult {
  match: boolean
  score: number
}

/** 히스토리/저장 쿼리 필터용. 패턴이 비면 무조건 통과(점수 0). */
export function fuzzyMatch(pattern: string, text: string): FuzzyResult {
  if (!pattern) return { match: true, score: 0 }

  const p = pattern.toLowerCase()
  const t = text.toLowerCase()

  let patternIdx = 0
  let textIdx = 0
  let score = 0
  let consecutive = 0

  while (patternIdx < p.length && textIdx < t.length) {
    if (p[patternIdx] === t[textIdx]) {
      score += 1 + consecutive
      consecutive++
      patternIdx++
    } else {
      consecutive = 0
    }
    textIdx++
  }

  return patternIdx === p.length ? { match: true, score } : { match: false, score: 0 }
}

/** 커맨드 팰릿용 점수. 0이면 매치 실패. */
export function fuzzyScore(query: string, target: string): number {
  if (!query) return 1
  const q = query.toLowerCase()
  const t = target.toLowerCase()

  if (t.includes(q)) return 2 + (t.startsWith(q) ? 1 : 0)

  let qi = 0
  let score = 0
  let lastMatch = -1

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 1 + (ti - lastMatch === 1 ? 1 : 0) // 연속 매칭 보너스
      lastMatch = ti
      qi++
    }
  }

  return qi === q.length ? score / t.length : 0
}

// ── 한글 초성 ────────────────────────────────────────────────────────────────

const CHOSEONG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
/** 쌍자음은 평자음으로 접는다 — 사용자는 "까"를 ㄱ 으로 검색한다. */
const FOLD: Record<string, string> = { ㄲ: 'ㄱ', ㄸ: 'ㄷ', ㅃ: 'ㅂ', ㅆ: 'ㅅ', ㅉ: 'ㅈ' }
const JAMO = /[ㄱ-ㅎ]/

/** 완성형 음절이면 초성(접힌 평자음), 아니면 null. */
function initialOf(ch: string): string | null {
  const c = ch.charCodeAt(0)
  if (c < 0xac00 || c > 0xd7a3) return null
  const j = CHOSEONG[Math.floor((c - 0xac00) / 588)]!
  return FOLD[j] ?? j
}

/**
 * 자모 하나(`ㅂ`)가 `target` 글자와 맞는가. 일반 글자는 그대로 비교하고,
 * 자음 자모만 음절의 초성과 비교한다("복" ≙ ㅂ).
 */
function charMatches(q: string, target: string): boolean {
  if (q === target) return true
  return JAMO.test(q) && initialOf(target) === (FOLD[q] ?? q)
}

/**
 * 초성이 섞인 검색어 점수. 0이면 매치 실패.
 * `ㅂㅅ`→"복사", `복ㅅ`→"복사", `ㅈㅇ ㅅㅎ`→"자동 실행". 공백은 무시한다.
 * 점수 체계는 `fuzzyScore`와 같다(연속 일치가 부분 수열보다 크다).
 */
function choseongScore(query: string, target: string): number {
  const q = [...query.toLowerCase().replace(/\s+/g, '')]
  const t = [...target.toLowerCase().replace(/\s+/g, '')]
  if (!q.length || !q.some((c) => JAMO.test(c))) return 0

  for (let s = 0; s + q.length <= t.length; s++) {
    if (q.every((c, i) => charMatches(c, t[s + i]!))) return 2 + (s === 0 ? 1 : 0)
  }
  let qi = 0
  let score = 0
  let last = -1
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (charMatches(q[qi]!, t[ti]!)) {
      score += 1 + (ti - last === 1 ? 1 : 0)
      last = ti
      qi++
    }
  }
  return qi === q.length ? score / t.length : 0
}

/** 팰릿 검색용: 일반 퍼지 점수를 먼저 보고, 실패하면 초성 매칭을 시도한다. */
export function searchScore(query: string, target: string): number {
  const base = fuzzyScore(query, target)
  return base > 0 ? base : choseongScore(query, target)
}

export interface Searchable {
  label: string
  /** 한국어·영어 동의어 — 이름에 없는 말로도 찾을 수 있게 한다 */
  keywords?: readonly string[]
  description?: string
}

/**
 * 명령 하나의 검색 점수. 이름(×1.5) > 키워드(×0.8) > 설명(×0.5) 순으로 가중한다.
 * 이름 안의 부분 일치(2점)가 키워드의 앞머리 일치(3점×0.8)에 밀리지 않게 이름에 1.5배를 준다.
 * 키워드는 개별로 채점해 가장 좋은 하나만 쓴다(긴 문자열에 흩어진 글자가 우연히 맞는 것을 막는다).
 */
export function commandScore(query: string, item: Searchable): number {
  const label = searchScore(query, item.label)
  let kw = 0
  for (const k of item.keywords ?? []) kw = Math.max(kw, searchScore(query, k))
  const desc = item.description ? searchScore(query, item.description) : 0
  return label * 1.5 + kw * 0.8 + desc * 0.5
}
