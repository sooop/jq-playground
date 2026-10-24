import { describe, expect, it, vi } from 'vitest'
import { JQ_CDN_JS, JQ_CDN_WASM, createAssetLoader, validAssets, type AssetDeps } from '../src/modes/jq/core/jq-assets'

const JS = 'x'.repeat(2000)
function wasm(good = true): ArrayBuffer {
  const b = new Uint8Array(2000)
  if (good) b.set([0x00, 0x61, 0x73, 0x6d])
  return b.buffer
}

function deps(over: Partial<AssetDeps> = {}) {
  const store = new Map<string, { url: string; js: string; wasm: ArrayBuffer; savedAt: number }>()
  const d: AssetDeps = {
    read: vi.fn(async (k: string) => store.get(k)),
    write: vi.fn(async (r) => void store.set(r.url, r)),
    fetchText: vi.fn(async () => JS),
    fetchBytes: vi.fn(async () => wasm()),
    ...over,
  }
  return { d, store }
}

describe('validAssets', () => {
  it('wasm 매직·최소 크기를 검사한다', () => {
    expect(validAssets({ js: JS, wasm: wasm() })).toBe(true)
    expect(validAssets({ js: JS, wasm: wasm(false) })).toBe(false)
    expect(validAssets({ js: 'x', wasm: wasm() })).toBe(false)
    expect(validAssets(undefined)).toBe(false)
  })
})

describe('createAssetLoader', () => {
  it('캐시가 비어 있으면 CDN 에서 받아 저장하고, 다음 로더는 네트워크 없이 캐시를 쓴다', async () => {
    const { d, store } = deps()
    expect(await createAssetLoader(d)()).toMatchObject({ js: JS })
    expect(d.fetchText).toHaveBeenCalledWith(JQ_CDN_JS)
    expect(d.fetchBytes).toHaveBeenCalledWith(JQ_CDN_WASM)
    expect(store.has(JQ_CDN_JS)).toBe(true)

    // 새 로더(= 새 세션) — 오프라인이어도 캐시로 동작한다
    const offline = { ...d, fetchText: vi.fn(async () => { throw new Error('offline') }), fetchBytes: vi.fn(async () => { throw new Error('offline') }) }
    const a = await createAssetLoader(offline)()
    expect(a.js).toBe(JS)
    expect(offline.fetchText).not.toHaveBeenCalled()
  })

  it('손상된 캐시는 버리고 다시 받는다', async () => {
    const { d, store } = deps()
    store.set(JQ_CDN_JS, { url: JQ_CDN_JS, js: JS, wasm: wasm(false), savedAt: 0 })
    await createAssetLoader(d)()
    expect(d.fetchText).toHaveBeenCalledTimes(1)
    expect(new Uint8Array(store.get(JQ_CDN_JS)!.wasm, 0, 4)[1]).toBe(0x61)
  })

  it('저장·읽기 실패는 무시하고 네트워크 결과를 돌려준다', async () => {
    const { d } = deps({
      read: vi.fn(async () => { throw new Error('idb') }),
      write: vi.fn(async () => { throw new Error('quota') }),
    })
    expect((await createAssetLoader(d)()).js).toBe(JS)
  })

  it('HTML 에러 페이지 같은 잘못된 응답은 캐시하지 않고 실패한다', async () => {
    const { d, store } = deps({ fetchBytes: vi.fn(async () => wasm(false)) })
    await expect(createAssetLoader(d)()).rejects.toThrow()
    expect(store.size).toBe(0)
  })

  it('동시 호출은 한 번만 받고, 실패한 약속은 다음 호출에서 다시 시도한다', async () => {
    const { d } = deps()
    const load = createAssetLoader(d)
    await Promise.all([load(), load()])
    expect(d.fetchText).toHaveBeenCalledTimes(1)

    let n = 0
    const flaky = deps({ fetchText: vi.fn(async () => { if (n++ === 0) throw new Error('net'); return JS }) })
    const l2 = createAssetLoader(flaky.d)
    await expect(l2()).rejects.toThrow('net')
    await expect(l2()).resolves.toMatchObject({ js: JS })
  })
})
