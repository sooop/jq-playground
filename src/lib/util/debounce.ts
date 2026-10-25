/**
 * 디바운스. 마지막 호출로부터 `ms`가 지나야 실행된다.
 * `flush()`로 즉시 실행, `cancel()`로 대기 중인 호출을 취소한다.
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): {
  (...args: A): void
  flush(): void
  cancel(): void
} {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: A | null = null

  const run = (...args: A) => {
    pending = args
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const a = pending
      pending = null
      if (a) fn(...a)
    }, ms)
  }

  run.flush = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    const a = pending
    pending = null
    if (a) fn(...a)
  }

  run.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    pending = null
  }

  return run
}
