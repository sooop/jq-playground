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
