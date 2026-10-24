/** Transform 모달을 여는 방식. 원본 `types.ts:TransformModalOpenOptions` 와 같은 모양이다. */
export interface TransformOpenOptions {
  /** 'input'이면 입력 내용을 가져오고, 'empty'면 빈 채로 연다 */
  source?: 'input' | 'empty'
  initialText?: string
  extract?: boolean
  /** 이 jq 경로들만 체크된 상태로 연다 (입력 찾기의 ↧ 진입용) */
  focusPaths?: string[]
  /** 원본 포맷 유지(구간 치환) 모드로 열기 */
  preserveFormat?: boolean
}
