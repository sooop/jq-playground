/**
 * jq 모드 명령 — 메뉴·패널 버튼·단축키·커맨드 팰릿이 같이 쓰는 단일 목록.
 *
 * 기능을 추가할 때는 여기(`JqMode.svelte`의 `commands`)에 한 줄을 넣는다. 팰릿은 이 목록 전체를
 * 보여 주므로 "툴바에는 있는데 팰릿에는 없는" 기능이 생기지 않는다. 메뉴는 `run`만 가져다 쓴다.
 *
 * - `keys`  전역 단축키. 있으면 keymap 에 등록되고 `?` 도움말에도 나온다.
 * - `hint`  패널 안에서만 듣는 단축키처럼 keymap 에 넣을 수 없는 것의 표시용 문구.
 * - `when`  진입 조건. false 면 팰릿에서 숨긴다(예: CSV 결과일 때만 "확대").
 * - `keywords`  이름에 없는 한국어·영어 동의어. 팰릿 검색이 이름과 함께 본다.
 */
import type { KeymapEntry } from './keymap'

export interface Command {
  id: string
  label: string
  keywords?: readonly string[]
  description?: string
  keys?: string
  hint?: string
  when?: () => boolean
  run: () => void
}

/** `keys`가 있는 명령만 keymap 항목으로 바꾼다. */
export function keymapEntries(commands: readonly Command[]): KeymapEntry[] {
  return commands
    .filter((c): c is Command & { keys: string } => !!c.keys)
    .map((c) => ({
      id: c.id,
      keys: c.keys,
      label: c.label,
      description: c.description,
      when: c.when,
      handler: () => c.run(),
    }))
}
