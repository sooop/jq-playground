/**
 * IndexedDB 배관 — 앱의 모든 IndexedDB 접근이 지나는 유일한 지점.
 *
 * `src/lib/util/storage.ts`(localStorage 래퍼)와 같은 문체를 따른다: 모든 접근을 try/catch로
 * 감싸고, 실패는 값으로 돌려주거나(`idbUsable`) 정규화된 에러로 던진다. **콘솔에는 아무것도
 * 쓰지 않는다** — `tests/e2e.mjs`가 콘솔 에러 1건에도 실패하도록 감시하기 때문에 이건 스타일이
 * 아니라 강제 규칙이다.
 *
 * 스토어는 아래 `SCHEMA` 테이블에 선언한다. `onupgradeneeded`는 멱등이다 — `DB_VERSION`을
 * 올려도 이미 있는 스토어는 건드리지 않고 새 스토어만 추가된다. 모드(csv/jq/md)별 스토어는
 * `모드.이름` 접두로 구분한다.
 *
 * 참고: Chrome은 `file://` 페이지를 전부 같은 origin으로 취급한다. 여기 저장한 문서는 사용자가
 * 로컬에서 여는 다른 HTML 파일에도 그대로 보인다 — 단일 HTML 배포 형태에서 감수한 트레이드오프.
 */

export const DB_NAME = 'xsv-playground'
export const DB_VERSION = 2

export interface StoreSpec {
  name: string
  keyPath: string
  autoIncrement?: boolean
  /** [인덱스 이름, keyPath] */
  indexes?: readonly (readonly [string, string])[]
}

export const STORES = {
  jqInputHistory: 'jq.inputHistory',
  jqQueryHistory: 'jq.queryHistory',
  jqSavedQueries: 'jq.savedQueries',
  /** CDN 에서 받은 jq 엔진(jq.js + jq.wasm) 캐시 — 키는 버전이 들어간 URL */
  jqEngine: 'jq.engine',
} as const

export const SCHEMA: readonly StoreSpec[] = [
  {
    name: STORES.jqInputHistory,
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      ['by_time', 'timestamp'],
      ['by_used', 'lastUsed'],
      ['by_hash', 'contentHash'],
    ],
  },
  { name: STORES.jqQueryHistory, keyPath: 'id', autoIncrement: true, indexes: [['by_time', 'timestamp']] },
  { name: STORES.jqSavedQueries, keyPath: 'id', autoIncrement: true, indexes: [['by_time', 'timestamp']] },
  { name: STORES.jqEngine, keyPath: 'url' },
]

export type DocStoreErrorCode = 'unavailable' | 'quota' | 'io'

export class DocStoreError extends Error {
  code: DocStoreErrorCode
  constructor(code: DocStoreErrorCode, message: string) {
    super(message)
    this.name = 'DocStoreError'
    this.code = code
  }
}

export function normalizeError(e: unknown): DocStoreError {
  if (e instanceof DocStoreError) return e
  const name = e instanceof Error ? e.name : ''
  // Chrome은 용량 초과를 커밋 시점의 트랜잭션 abort로 던지는 경우가 있어, request와 tx
  // 양쪽에서 온 에러를 여기 한 곳에서 정규화한다.
  if (name === 'QuotaExceededError') return new DocStoreError('quota', '저장 공간이 부족합니다')
  const msg = e instanceof Error ? e.message : String(e)
  return new DocStoreError('io', msg)
}

let dbPromise: Promise<IDBDatabase> | null = null

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    let r: IDBOpenDBRequest
    try {
      r = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (e) {
      reject(normalizeError(e))
      return
    }
    r.onupgradeneeded = () => {
      const db = r.result
      for (const spec of SCHEMA) {
        if (db.objectStoreNames.contains(spec.name)) continue
        const store = db.createObjectStore(spec.name, {
          keyPath: spec.keyPath,
          autoIncrement: spec.autoIncrement ?? false,
        })
        for (const [idxName, idxPath] of spec.indexes ?? []) store.createIndex(idxName, idxPath)
      }
    }
    r.onsuccess = () => {
      const db = r.result
      // 다른 탭의 버전 업그레이드나 브라우저의 연결 종료 뒤에도 다음 호출이 새로 연결하게 한다
      const drop = () => {
        if (dbPromise === p) dbPromise = null
      }
      db.onversionchange = () => {
        db.close()
        drop()
      }
      db.onclose = drop
      resolve(db)
    }
    r.onerror = () => reject(normalizeError(r.error))
    r.onblocked = () => reject(new DocStoreError('io', '다른 탭이 저장소를 사용 중이라 열 수 없습니다'))
  })
  dbPromise = p
  // 실패한 연결을 캐시해두면 이후 모든 호출이 영원히 실패한다 — 다음 호출이 다시 시도하게 한다
  p.catch(() => {
    dbPromise = null
  })
  return p
}

export function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(normalizeError(r.error))
  })
}

export function withTx<T>(
  storeNames: string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let tx: IDBTransaction
        try {
          tx = db.transaction(storeNames, mode)
        } catch (e) {
          reject(normalizeError(e))
          return
        }
        let result: T
        let settled = false
        const fail = (e: unknown) => {
          if (settled) return
          settled = true
          reject(normalizeError(e))
        }
        // onerror와 onabort 둘 다에서 reject한다 — Chrome은 용량 초과를 abort로만 알리기도 한다
        tx.onerror = () => fail(tx.error)
        tx.onabort = () => fail(tx.error ?? new Error('transaction aborted'))
        tx.oncomplete = () => {
          if (!settled) {
            settled = true
            resolve(result)
          }
        }
        try {
          Promise.resolve(fn(tx))
            .then((r) => {
              result = r
            })
            .catch((e) => {
              // 이미 요청한 쓰기가 커밋되지 않도록 되돌린다
              try {
                tx.abort()
              } catch {
                /* 이미 종료됨 */
              }
              fail(e)
            })
        } catch (e) {
          try {
            tx.abort()
          } catch {
            /* 이미 종료됨 */
          }
          fail(e)
        }
      }),
  )
}

/** UUID 생성 — 지원 안 하는 환경(구형 브라우저)은 타임스탬프+랜덤으로 폴백한다. */
export function newDocId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
}

let usableCache: Promise<boolean> | null = null

/**
 * IndexedDB를 실제로 쓸 수 있는지. 메모이즈되어 앱 부팅 시 한 번만 확인한다.
 * Firefox 프라이빗 모드 등 이벤트가 아예 안 오는 환경을 대비해 타임아웃을 둔다.
 */
export function idbUsable(): Promise<boolean> {
  if (usableCache) return usableCache
  usableCache = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(false)
      return
    }
    const timer = setTimeout(() => resolve(false), 3000)
    openDb()
      .then(() => {
        clearTimeout(timer)
        resolve(true)
      })
      .catch(() => {
        clearTimeout(timer)
        resolve(false)
      })
  })
  return usableCache
}

/** 브라우저가 보고하는 사용량/할당량. 지원하지 않으면 null. */
export async function storageInfo(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null
    const { usage, quota } = await navigator.storage.estimate()
    if (usage === undefined || quota === undefined) return null
    return { usage, quota }
  } catch {
    return null
  }
}
