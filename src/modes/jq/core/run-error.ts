/**
 * 실행 오류를 사용자에게 보여 줄 형태로 다듬는다(순수 함수 — 테스트 대상).
 *
 * - 출처(`input`/`query`)는 엔진이 `JqRunError.source` 로 알려 준다.
 * - 위치는 해당 출처의 **텍스트**로 계산한다: 입력 오류는 입력창, 쿼리 오류는 쿼리창.
 */
import { formatPos, parseErrorPosition } from '../../../lib/ui/feedback/errorPosition'
import type { RunErrorSource } from './jq-engine'

export interface RunErrorView {
  title: string
  detail?: string
  /** `3:14` 같은 위치 칩. 위치를 못 찾으면 없음 */
  loc?: string
  /** 캐럿을 옮길 오프셋. 위치를 못 찾으면 없음 */
  offset?: number
}

/** jq 메시지의 군더더기를 걷어 첫 줄만 남긴다. */
export function cleanMessage(message: string): string {
  const first =
    message
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !/^jq: \d+ compile errors?$/i.test(l)) ?? message.trim()
  return first
    .replace(/^jq: error(?: \(at [^)]*\))?:\s*/i, '')
    .replace(/\s*at <top-level>, line \d+:?\s*$/i, '')
    .replace(/\s*\(Unix shell quoting issues\?\)/i, '')
    .trim()
}

export function describeRunError(
  source: RunErrorSource,
  message: string,
  text: string,
): RunErrorView {
  const pos = parseErrorPosition(message, text)
  const loc = formatPos(pos)
  const detail = cleanMessage(message) || undefined
  return {
    title: source === 'input' ? '입력 JSON을 해석하지 못했습니다' : 'jq 쿼리 오류',
    detail,
    loc: loc || undefined,
    offset: pos?.offset,
  }
}
