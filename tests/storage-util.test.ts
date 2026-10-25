import { describe, expect, it, vi } from 'vitest'

/** 가짜 localStorage — setItem 실패를 켜고 끌 수 있다 */
function installLocalStorage() {
  const data = new Map<string, string>()
  const state = { fail: false }
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (state.fail && !k.endsWith('__probe')) throw new DOMException('full', 'QuotaExceededError')
      data.set(k, v)
    },
    removeItem: (k: string) => void data.delete(k),
  })
  return state
}

describe('util/storage 쓰기 실패', () => {
  it('localStorage 쓰기가 실패해도 최신 값을 읽고 한 번만 알린다', async () => {
    vi.resetModules()
    const state = installLocalStorage()
    const { load, save, onSaveFailure } = await import('../src/lib/util/storage')
    const handler = vi.fn()
    onSaveFailure(handler)

    save('k', 1)
    expect(load('k', 0)).toBe(1)
    state.fail = true
    save('k', 2)
    save('k', 3)
    expect(load('k', 0)).toBe(3)
    expect(handler).toHaveBeenCalledTimes(1)

    state.fail = false
    save('k', 4)
    expect(load('k', 0)).toBe(4)
  })
})
