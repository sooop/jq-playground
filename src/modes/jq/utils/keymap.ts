/**
 * jq 모드 단축키 레지스트리.
 *
 * 원본은 `window` 에 캡처 리스너를 직접 달았다. 통합 셸에서는 **모드가 리스너를 달면 안 된다**
 * — 셸이 활성 모드에만 `handleKeydown(e)` 를 넘긴다. 그래서 인스턴스 + `dispatch(e)` 로 바꿨다.
 *
 * `isEditing` 가드는 그대로다: textarea/input 안에서는 `?` 같은 단독 문자 키를 먹지 않는다.
 */

export interface KeymapEntry {
  id: string
  /** 'Ctrl+K', 'Ctrl+1', 'F6', '?' 등 */
  keys: string
  label: string
  description?: string
  /** 진입 조건 — true 를 돌려줄 때만 실행한다 */
  when?: () => boolean
  handler: (e: KeyboardEvent) => void
}

/** 키 이벤트가 등록된 조합과 맞는지 */
function matchesKey(e: KeyboardEvent, keys: string): boolean {
  const parts = keys.split('+')
  const key = parts[parts.length - 1]!

  const needsCtrl = parts.includes('Ctrl') || parts.includes('Meta')
  const needsShift = parts.includes('Shift')
  const needsAlt = parts.includes('Alt')

  if (needsCtrl && !(e.ctrlKey || e.metaKey)) return false
  if (needsShift && !e.shiftKey) return false
  if (needsAlt && !e.altKey) return false
  // Ctrl/Meta 가 필요 없는데 눌려 있으면 매치하지 않는다(`?` 단독키 보호)
  if (!needsCtrl && (e.ctrlKey || e.metaKey)) return false

  return e.key === key || e.code === `Key${key.toUpperCase()}`
}

function isEditing(): boolean {
  const el = document.activeElement
  return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement
}

export class Keymap {
  #entries: KeymapEntry[] = []

  register(entry: KeymapEntry): void {
    const i = this.#entries.findIndex((e) => e.id === entry.id)
    if (i >= 0) this.#entries[i] = entry
    else this.#entries.push(entry)
  }

  registerAll(entries: KeymapEntry[]): void {
    for (const e of entries) this.register(e)
  }

  get entries(): readonly KeymapEntry[] {
    return this.#entries
  }

  /** 처리했으면 true(이미 `preventDefault` 했다). */
  dispatch(e: KeyboardEvent): boolean {
    for (const entry of this.#entries) {
      if (!matchesKey(e, entry.keys)) continue
      // 편집 중에는 수식키 없는 단독 문자 키를 무시한다
      if (isEditing() && !e.ctrlKey && !e.metaKey && !e.altKey && !e.key.startsWith('F')) continue
      if (entry.when && !entry.when()) continue
      e.preventDefault()
      e.stopPropagation()
      entry.handler(e)
      return true
    }
    return false
  }
}

export function createKeymap(): Keymap {
  return new Keymap()
}
