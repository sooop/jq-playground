/**
 * 범용 IndexedDB 스토어 — jq 히스토리·md 파일처럼 "레코드 목록 + LRU 상한" 형태의 데이터용.
 *
 * `idb.ts` 배관 위에 얇게 얹은 CRUD다. CSV 문서처럼 메타/본문을 나눠야 하는 특수 구조는
 * `docStore.ts`가 따로 다룬다. 콘솔에는 아무것도 쓰지 않는다(`idb.ts` 규약).
 */
import { req, withTx } from './idb'

export interface KvStore<T extends { id?: number }> {
  /** 전체 목록. 인덱스를 주면 그 키 오름차순, 없으면 주키 순. */
  list(index?: string): Promise<T[]>
  get(id: number): Promise<T | null>
  /** 인덱스 값이 정확히 일치하는 첫 레코드 */
  findBy(index: string, value: IDBValidKey): Promise<T | null>
  /** 추가 또는 갱신. autoIncrement 스토어에서 `id`가 없으면 새 키가 배정되어 돌아온다. */
  put(value: T): Promise<number>
  del(id: number): Promise<void>
  clear(): Promise<void>
  count(): Promise<number>
  /**
   * 레코드 수가 `max`를 넘으면 `index` 오름차순(=가장 오래된 것)부터 지운다.
   * `protect`에 든 id는 지우지 않는다(현재 열려 있는 문서 등). 지운 개수를 돌려준다.
   */
  enforceLimit(max: number, index: string, protect?: Iterable<number>): Promise<number>
  /**
   * 인덱스 값이 같은 레코드를 찾고 저장하는 일을 한 트랜잭션으로 한다(동시 호출의 중복 방지).
   * `make`가 돌려준 레코드를 put하고 그 id를 돌려준다.
   */
  upsertBy(index: string, value: IDBValidKey, make: (existing: T | null) => T): Promise<number>
  /**
   * 레코드 크기(`sizeOf`) 합계가 `maxBytes`를 넘으면 `index` 오름차순(오래된 것)부터 지운다.
   * 본문을 한 건씩 커서로만 훑으므로 전체를 메모리에 올리지 않는다.
   */
  enforceBytes(maxBytes: number, index: string, sizeOf: (v: T) => number, protect?: Iterable<number>): Promise<number>
}

export function kvStore<T extends { id?: number }>(storeName: string): KvStore<T> {
  return {
    async list(index) {
      try {
        return await withTx([storeName], 'readonly', (tx) => {
          const os = tx.objectStore(storeName)
          return req((index ? os.index(index) : os).getAll() as IDBRequest<T[]>)
        })
      } catch {
        return []
      }
    },

    async get(id) {
      const v = await withTx([storeName], 'readonly', (tx) =>
        req(tx.objectStore(storeName).get(id) as IDBRequest<T | undefined>),
      )
      return v ?? null
    },

    async findBy(index, value) {
      const v = await withTx([storeName], 'readonly', (tx) =>
        req(tx.objectStore(storeName).index(index).get(value) as IDBRequest<T | undefined>),
      )
      return v ?? null
    },

    async put(value) {
      const key = await withTx([storeName], 'readwrite', (tx) => req(tx.objectStore(storeName).put(value)))
      return typeof key === 'number' ? key : Number(key)
    },

    async del(id) {
      await withTx([storeName], 'readwrite', (tx) => {
        tx.objectStore(storeName).delete(id)
      })
    },

    async clear() {
      await withTx([storeName], 'readwrite', (tx) => {
        tx.objectStore(storeName).clear()
      })
    },

    async count() {
      try {
        return await withTx([storeName], 'readonly', (tx) => req(tx.objectStore(storeName).count()))
      } catch {
        return 0
      }
    },

    async upsertBy(index, value, make) {
      const key = await withTx([storeName], 'readwrite', async (tx) => {
        const os = tx.objectStore(storeName)
        const existing = await req(os.index(index).get(value) as IDBRequest<T | undefined>)
        return req(os.put(make(existing ?? null)))
      })
      return typeof key === 'number' ? key : Number(key)
    },

    async enforceBytes(maxBytes, index, sizeOf, protect) {
      const keep = new Set(protect ?? [])
      return withTx([storeName], 'readwrite', (tx) => {
        const os = tx.objectStore(storeName)
        return new Promise<number>((resolve, reject) => {
          // 최신 것부터 내려오며 합계를 센다 — 상한을 넘은 뒤의 레코드(=더 오래된 것)를 지운다
          const cur = os.index(index).openCursor(null, 'prev')
          let sum = 0
          let removed = 0
          cur.onerror = () => reject(cur.error)
          cur.onsuccess = () => {
            const c = cur.result
            if (!c) {
              resolve(removed)
              return
            }
            const id = typeof c.primaryKey === 'number' ? c.primaryKey : Number(c.primaryKey)
            sum += sizeOf(c.value as T)
            if (sum > maxBytes && !keep.has(id)) {
              c.delete()
              removed++
            }
            c.continue()
          }
        })
      })
    },

    async enforceLimit(max, index, protect) {
      const keep = new Set(protect ?? [])
      return withTx([storeName], 'readwrite', async (tx) => {
        const os = tx.objectStore(storeName)
        const total = await req(os.count())
        let excess = total - max
        if (excess <= 0) return 0
        // 가장 오래된 것부터 — 인덱스 오름차순의 주키 목록. 보호 대상은 건너뛴다.
        const keys = await req(os.index(index).getAllKeys() as IDBRequest<IDBValidKey[]>)
        let removed = 0
        for (const k of keys) {
          if (excess <= 0) break
          const id = typeof k === 'number' ? k : Number(k)
          if (keep.has(id)) continue
          os.delete(k)
          removed++
          excess--
        }
        return removed
      })
    },
  }
}
