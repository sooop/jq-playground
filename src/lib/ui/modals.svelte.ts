/**
 * 열려 있는 모달 스택 — Escape 라우팅의 단일 진실.
 *
 * `Modal.svelte`가 마운트될 때 자기 닫기 함수를 등록하고 언마운트될 때 뺀다. 셸의 전역 keydown은
 * Escape에서 `closeTop()`을 먼저 시도하고, 닫힌 것이 있으면 모드에 넘기지 않는다. 그래서 각
 * 다이얼로그가 자체 Escape 핸들러를 갖거나 모드가 "어느 다이얼로그가 떠 있는지" 플래그를 하나씩
 * 검사할 필요가 없다 — 그 이중 처리가 한쪽을 죽은 코드로 만들던 원인이었다.
 */

class ModalStack {
  #stack = $state.raw<{ id: number; close: () => void }[]>([])
  #seq = 0

  get count(): number {
    return this.#stack.length
  }

  get isOpen(): boolean {
    return this.#stack.length > 0
  }

  register(close: () => void): () => void {
    const id = ++this.#seq
    this.#stack = [...this.#stack, { id, close }]
    return () => {
      this.#stack = this.#stack.filter((m) => m.id !== id)
    }
  }

  /** 맨 위 모달을 닫는다. 닫은 것이 있으면 true. */
  closeTop(): boolean {
    const top = this.#stack[this.#stack.length - 1]
    if (!top) return false
    top.close()
    return true
  }
}

export const modals = new ModalStack()
