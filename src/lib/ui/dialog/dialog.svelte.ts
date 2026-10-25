/**
 * Promise 기반 공통 다이얼로그.
 *
 * `window.alert/confirm/prompt`를 대체한다. 네이티브 대화상자는 스타일을 줄 수 없고, 페이지
 * 이벤트 루프를 통째로 막아 (특히 이 앱의 포인터 캡처·스크롤 동기화처럼) 진행 중인 상호작용을
 * 망가뜨린다.
 *
 * ## 사용법
 * ```ts
 * import { dialogs } from '$lib/ui/dialog/dialog.svelte'
 *
 * await dialogs.alert({ message: '내보내기를 마쳤습니다' })
 * if (!(await dialogs.confirm({ message: '3열을 삭제할까요?', danger: true }))) return
 * const name = await dialogs.prompt({ message: '새 칼럼 이름', value: '열 1' })  // null이면 취소
 * ```
 * 앱 최상단에 `<DialogHost />`를 **한 번** 넣어야 실제로 그려진다.
 *
 * ## 다른 프로젝트로 옮길 때
 * 이 폴더(`dialog/`)만 복사하면 된다. Svelte 5 외의 의존성이 없고, 앱 고유의 타입이나
 * 스타일 토큰을 참조하지 않는다(색은 CSS 변수를 쓰되 없을 때의 기본값을 함께 지정한다).
 */

export type DialogTone = 'info' | 'warn' | 'danger'

export interface AlertOptions {
  title?: string
  message: string
  /** 본문 아래 작은 보조 설명 */
  detail?: string
  okLabel?: string
  tone?: DialogTone
}

export interface ConfirmOptions extends AlertOptions {
  cancelLabel?: string
  /** 확인 버튼을 위험 스타일로. tone이 없으면 danger로 취급한다. */
  danger?: boolean
}

export interface PromptOptions extends ConfirmOptions {
  value?: string
  placeholder?: string
  multiline?: boolean
  /** 값이 유효하지 않으면 오류 문구를 돌려준다. null이면 통과. */
  validate?: (value: string) => string | null
}

interface BaseRequest {
  id: number
}
export type DialogRequest = BaseRequest &
  (
    | { kind: 'alert'; opts: AlertOptions; settle: (v: undefined) => void }
    | { kind: 'confirm'; opts: ConfirmOptions; settle: (v: boolean) => void }
    | { kind: 'prompt'; opts: PromptOptions; settle: (v: string | null) => void }
  )

class DialogController {
  /**
   * 대기열. 동시에 여러 번 호출되어도 서로를 덮어쓰지 않고 순서대로 처리한다
   * (예: 반복 작업 중 확인이 연달아 필요한 경우).
   */
  #queue = $state.raw<DialogRequest[]>([])
  #seq = 0

  get current(): DialogRequest | null {
    return this.#queue[0] ?? null
  }

  get pending(): number {
    return this.#queue.length
  }

  alert(opts: AlertOptions): Promise<void> {
    return new Promise<void>((resolve) => {
      this.#push({ id: ++this.#seq, kind: 'alert', opts, settle: () => resolve() })
    })
  }

  confirm(opts: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.#push({ id: ++this.#seq, kind: 'confirm', opts, settle: resolve })
    })
  }

  prompt(opts: PromptOptions): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      this.#push({ id: ++this.#seq, kind: 'prompt', opts, settle: resolve })
    })
  }

  #push(req: DialogRequest): void {
    this.#queue = [...this.#queue, req]
  }

  /**
   * 현재 다이얼로그를 닫고 결과를 전달한다. Host가 호출한다.
   * 취소는 kind별 기본값으로 해석된다 — alert: undefined, confirm: false, prompt: null.
   */
  settle(id: number, value: boolean | string | null | undefined): void {
    const req = this.#queue[0]
    if (!req || req.id !== id) return
    this.#queue = this.#queue.slice(1)
    switch (req.kind) {
      case 'alert':
        req.settle(undefined)
        break
      case 'confirm':
        req.settle(value === true)
        break
      case 'prompt':
        req.settle(typeof value === 'string' ? value : null)
        break
    }
  }

  /** 대기 중인 것까지 모두 취소한다 (데이터셋 교체 등 문맥이 사라질 때). */
  cancelAll(): void {
    const all = this.#queue
    this.#queue = []
    for (const req of all) {
      if (req.kind === 'alert') req.settle(undefined)
      else if (req.kind === 'confirm') req.settle(false)
      else req.settle(null)
    }
  }
}

export const dialogs = new DialogController()
