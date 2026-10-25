/**
 * 토스트 컨트롤러 — `dialog/dialog.svelte.ts`와 같은 문체의 모듈 싱글턴.
 *
 * 어느 모듈에서든 `toasts.push('저장했습니다', 'ok')`로 알림을 띄울 수 있다. 앱 최상단에
 * `<Toast items={toasts.items} onDismiss={(id) => toasts.dismiss(id)} />`를 한 번 넣어야
 * 실제로 그려진다.
 */
import type { ToastItem } from './Toast.svelte'

export type ToastKind = ToastItem['kind']

class ToastController {
  items = $state<ToastItem[]>([])
  #seq = 0

  push(msg: string, kind: ToastKind = 'info'): void {
    const id = ++this.#seq
    this.items = [...this.items, { id, msg, kind }]
    setTimeout(() => this.dismiss(id), kind === 'warn' ? 6000 : 3200)
  }

  dismiss(id: number): void {
    this.items = this.items.filter((t) => t.id !== id)
  }
}

export const toasts = new ToastController()
