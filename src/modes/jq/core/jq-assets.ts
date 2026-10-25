/**
 * jq 엔진 에셋(jq.js + jq.wasm) 로더 — CDN 에서 한 번 받아 IndexedDB 에 캐시한다.
 *
 * 캐시 키는 버전이 박힌 CDN URL 이라 `jq-web` 버전을 올리면 자동으로 새로 받는다. Cache API 와
 * Service Worker 는 `file://` 에서 못 쓰므로(단일 HTML 배포의 기본 형태) IndexedDB 를 쓴다.
 *
 * 캐시는 **최적화일 뿐 필수가 아니다**: 읽기·쓰기 실패와 손상된 레코드는 조용히 무시하고 CDN 으로
 * 내려간다. 반대로 캐시에 있으면 네트워크 없이도 동작한다. 콘솔에는 아무것도 쓰지 않는다.
 */
import { STORES, req, withTx } from '../../../lib/data/idb'

export const JQ_CDN_BASE = 'https://cdn.jsdelivr.net/npm/jq-web@0.6.2/'
export const JQ_CDN_JS = JQ_CDN_BASE + 'jq.js'
export const JQ_CDN_WASM = JQ_CDN_BASE + 'jq.wasm'

export interface JqAssets {
  js: string
  wasm: ArrayBuffer
}

interface CacheRecord extends JqAssets {
  /** 캐시 키 — 버전이 든 jq.js URL */
  url: string
  savedAt: number
}

/** 저장소·네트워크를 갈아 끼울 수 있게 분리한 의존성(테스트용) */
export interface AssetDeps {
  read(key: string): Promise<CacheRecord | undefined>
  write(rec: CacheRecord): Promise<void>
  fetchText(url: string): Promise<string>
  fetchBytes(url: string): Promise<ArrayBuffer>
}

const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d]

/** 캐시된(또는 받은) 에셋이 온전한지 — 빈 응답·HTML 에러 페이지를 걸러낸다 */
export function validAssets(a: Partial<JqAssets> | undefined): a is JqAssets {
  if (!a || typeof a.js !== 'string' || !(a.wasm instanceof ArrayBuffer)) return false
  if (a.js.length < 1000 || a.wasm.byteLength < 1000) return false
  const head = new Uint8Array(a.wasm, 0, 4)
  return WASM_MAGIC.every((b, i) => head[i] === b)
}

export function createAssetLoader(deps: AssetDeps): () => Promise<JqAssets> {
  let inflight: Promise<JqAssets> | null = null

  async function load(): Promise<JqAssets> {
    try {
      const hit = await deps.read(JQ_CDN_JS)
      if (validAssets(hit)) return { js: hit.js, wasm: hit.wasm }
    } catch {
      /* 캐시를 못 읽어도 네트워크로 간다 */
    }

    const [js, wasm] = await Promise.all([deps.fetchText(JQ_CDN_JS), deps.fetchBytes(JQ_CDN_WASM)])
    const fresh = { js, wasm }
    if (!validAssets(fresh)) throw new Error('jq 엔진 파일이 올바르지 않습니다')
    try {
      await deps.write({ url: JQ_CDN_JS, js, wasm, savedAt: Date.now() })
    } catch {
      /* 저장 실패(용량·프라이빗 모드)는 이번 실행에 영향이 없다 */
    }
    return fresh
  }

  return () => {
    if (inflight) return inflight
    // 실패한 약속은 캐시하지 않는다 — 온라인이 되면 다시 시도할 수 있어야 한다
    const p = load().catch((e: unknown) => {
      inflight = null
      throw e
    })
    inflight = p
    return p
  }
}

async function okResponse(url: string): Promise<Response> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`CDN 응답 오류 ${r.status}: ${url}`)
  return r
}

const browserDeps: AssetDeps = {
  read: (key) =>
    withTx([STORES.jqEngine], 'readonly', (tx) =>
      req<CacheRecord | undefined>(tx.objectStore(STORES.jqEngine).get(key)),
    ),
  write: (rec) =>
    withTx([STORES.jqEngine], 'readwrite', async (tx) => {
      await req(tx.objectStore(STORES.jqEngine).put(rec))
    }),
  fetchText: async (url) => (await okResponse(url)).text(),
  fetchBytes: async (url) => (await okResponse(url)).arrayBuffer(),
}

/** 캐시 → CDN 순으로 엔진 에셋을 준비한다. 동시에 여러 번 불러도 한 번만 받는다. */
export const loadJqAssets = createAssetLoader(browserDeps)
