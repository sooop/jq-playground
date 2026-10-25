/**
 * jq 모드 저장소 어댑터 — `lib/data/kvStore.ts` 위에 얹은 얇은 층.
 *
 * 원본(jq-playground `utils/storage.ts`, 585줄)에서 다음을 걷어냈다.
 *  - localStorage 폴백·마이그레이션(새 DB 하나로 통일했으므로 이관 대상이 없다)
 *  - 테마/액센트 API(`shell/theme.svelte.ts`가 대신한다)
 *  - `flushAll`·디바운스 저장(저장 쿼리도 IDB로 옮겨 즉시 쓰기가 된다)
 *  - `console.*`(실패는 조용히 무시 — 히스토리가 없다고 앱이 멈출 이유가 없다)
 *
 * 남긴 것: FNV-1a 해시 기반 입력 히스토리 dedup, LRU 상한.
 */
import { STORES } from '../../../lib/data/idb'
import { kvStore } from '../../../lib/data/kvStore'
import { dialogs } from '../../../lib/ui/dialog/dialog.svelte'
import { feedback } from '../../../lib/ui/feedback/feedback.svelte'
import { downloadText } from '../core/file-handler'
import type { InputHistoryEntry, QueryHistoryEntry, SavedQuery } from '../types'

/** 입력 히스토리 상한 — 넘으면 등록 시각이 오래된 것부터 지운다 */
const MAX_INPUT_HISTORY = 300
/** 쿼리 히스토리 상한 */
const MAX_QUERY_HISTORY = 100
/** 입력 한 건의 저장 상한(글자 수) — 넘으면 히스토리에 넣지 않고 파일로 내려받도록 안내한다 */
const MAX_ENTRY_SIZE = 5 * 1024 * 1024
/** 입력 히스토리 전체 크기 상한(글자 수) — 넘으면 오래된 것부터 지운다 */
const MAX_TOTAL_SIZE = 50 * 1024 * 1024
/** 이 크기를 넘으면 포맷하지 않고 trim만 한다(메인 스레드 보호) */
const FORMAT_THRESHOLD = 1024 * 1024

const inputStore = kvStore<InputHistoryEntry>(STORES.jqInputHistory)
const queryStore = kvStore<QueryHistoryEntry>(STORES.jqQueryHistory)
const savedStore = kvStore<SavedQuery>(STORES.jqSavedQueries)

/** FNV-1a 32비트 해시 — 같은 내용을 두 번 저장하지 않기 위한 dedup 키 */
export function fnv1aHash(str: string): string {
  let hash = 0x811c9dc5
  for (let i = 0, len = str.length; i < len; i++) {
    hash ^= str.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash.toString(36)
}

/** 저장 전 정규화 — JSON이면 2칸 들여쓰기, 아니면 trim만 */
function formatContent(content: string): string {
  if (content.length > FORMAT_THRESHOLD) return content.trim()
  try {
    return JSON.stringify(JSON.parse(content), null, 2)
  } catch {
    return content.trim()
  }
}

export type InputSortKey = 'timestamp' | 'lastUsed'

// ── 입력 히스토리 ────────────────────────────────────────────────────────────

/** 큰 입력 안내를 이미 띄운 파일 이름 — 자동 저장이 반복되어도 한 번만 묻는다 */
const largeNotified = new Set<string>()
let lastFailureToast = 0

async function offerDownload(content: string, fileName: string | null): Promise<void> {
  const key = fileName ?? ''
  if (largeNotified.has(key)) return
  largeNotified.add(key)
  const mb = (content.length / 1024 / 1024).toFixed(1)
  const ok = await dialogs.confirm({
    title: '입력이 커서 히스토리에 저장하지 않습니다',
    message: `입력 크기가 약 ${mb}MB입니다. 이 크기는 브라우저 저장소(히스토리)에 넣지 않습니다. 파일로 내려받아 보관할까요?`,
    detail: `히스토리에는 ${MAX_ENTRY_SIZE / 1024 / 1024}MB까지만 저장합니다.`,
    okLabel: '파일로 내려받기',
    cancelLabel: '건너뛰기',
    tone: 'info',
  })
  if (ok) downloadText(content, fileName || 'input.json')
}

function reportSaveFailure(): void {
  const now = Date.now()
  if (now - lastFailureToast < 60_000) return
  lastFailureToast = now
  feedback.report({
    key: 'storage.history',
    kind: 'warn',
    title: '입력 히스토리를 저장하지 못했습니다',
    detail: '브라우저 저장 공간이 부족할 수 있습니다.',
    anchors: ['input.history'],
  })
}

/**
 * 입력을 히스토리에 넣는다. 같은 내용이 이미 있으면 `lastUsed`만 갱신한다
 * (해시가 같아도 내용이 다를 수 있으므로 내용까지 비교한다). 조회와 저장은 한 트랜잭션이다.
 * 한 건이 `MAX_ENTRY_SIZE`를 넘으면 저장하지 않고 파일 내려받기를 권한다.
 */
export async function saveInputHistory(content: string, fileName: string | null): Promise<void> {
  if (!content || !content.trim()) return
  const formatted = formatContent(content)
  if (formatted.length > MAX_ENTRY_SIZE) {
    await offerDownload(formatted, fileName)
    return
  }
  const hash = fnv1aHash(formatted)
  const now = new Date().toISOString()

  try {
    const id = await inputStore.upsertBy('by_hash', hash, (existing) =>
      existing && existing.content === formatted
        ? { ...existing, lastUsed: now }
        : ({
            content: formatted,
            contentHash: hash,
            fileName,
            size: formatted.length,
            timestamp: now,
            lastUsed: now,
          } as InputHistoryEntry),
    )
    // 방금 저장한 항목은 지우지 않는다
    await inputStore.enforceLimit(MAX_INPUT_HISTORY, 'by_time', [id])
    await inputStore.enforceBytes(MAX_TOTAL_SIZE, 'by_time', (v) => v.size ?? v.content.length, [id])
  } catch {
    reportSaveFailure()
  }
}

/** 최근 항목부터 `limit`개. `sortBy`가 등록순('timestamp')/사용순('lastUsed')을 가른다. */
export async function getInputHistory(limit = 50, sortBy: InputSortKey = 'timestamp'): Promise<InputHistoryEntry[]> {
  const index = sortBy === 'lastUsed' ? 'by_used' : 'by_time'
  const all = await inputStore.list(index)
  return all.reverse().slice(0, limit)
}

/** 내용 부분일치 검색. IDB에 텍스트 인덱스가 없으므로 메모리에서 거른다. */
export async function searchInputHistory(term: string, sortBy: InputSortKey = 'timestamp'): Promise<InputHistoryEntry[]> {
  const needle = term.toLowerCase()
  const all = await getInputHistory(1000, sortBy)
  return all.filter(
    (it) => it.content.toLowerCase().includes(needle) || (it.fileName ?? '').toLowerCase().includes(needle),
  )
}

/** 포맷이 끝난 뒤 저장된 내용을 갱신한다(해시도 다시 계산한다). */
export async function updateInputHistoryContent(id: number, newContent: string): Promise<void> {
  try {
    const it = await inputStore.get(id)
    if (!it) return
    await inputStore.put({
      ...it,
      content: newContent,
      contentHash: fnv1aHash(newContent),
      size: newContent.length,
      lastUsed: new Date().toISOString(),
    })
  } catch {
    /* 무시 */
  }
}

export async function deleteInputHistory(id: number): Promise<void> {
  try {
    await inputStore.del(id)
  } catch {
    /* 무시 */
  }
}

export async function clearAllInputHistory(): Promise<void> {
  try {
    await inputStore.clear()
  } catch {
    /* 무시 */
  }
}

// ── 쿼리 히스토리 ────────────────────────────────────────────────────────────

export async function saveQueryHistory(query: string): Promise<void> {
  if (!query || !query.trim()) return
  try {
    await queryStore.put({ query, timestamp: new Date().toISOString() } as QueryHistoryEntry)
    await queryStore.enforceLimit(MAX_QUERY_HISTORY, 'by_time')
  } catch {
    /* 무시 */
  }
}

export async function getQueryHistory(limit = 100): Promise<QueryHistoryEntry[]> {
  const all = await queryStore.list('by_time')
  return all.reverse().slice(0, limit)
}

export async function deleteQueryHistory(id: number): Promise<void> {
  try {
    await queryStore.del(id)
  } catch {
    /* 무시 */
  }
}

export async function clearAllQueryHistory(): Promise<void> {
  try {
    await queryStore.clear()
  } catch {
    /* 무시 */
  }
}

// ── 저장된 쿼리 ──────────────────────────────────────────────────────────────

export async function getSavedQueries(): Promise<SavedQuery[]> {
  const all = await savedStore.list('by_time')
  return all.reverse()
}

/** 저장 쿼리를 한 건 넣는다. 실패(저장 공간 부족 등)는 `false` — 호출자가 알려야 한다. */
export async function saveSavedQuery(name: string, query: string): Promise<boolean> {
  try {
    await savedStore.put({ name, query, timestamp: new Date().toISOString() } as SavedQuery)
    return true
  } catch {
    return false
  }
}

/** 저장 쿼리를 최근 사용으로 끌어올린다(목록 상단에 오도록 timestamp 갱신). */
export async function touchSavedQuery(q: SavedQuery): Promise<void> {
  try {
    await savedStore.put({ ...q, timestamp: new Date().toISOString() })
  } catch {
    /* 무시 */
  }
}

export async function deleteSavedQuery(id: number): Promise<void> {
  try {
    await savedStore.del(id)
  } catch {
    /* 무시 */
  }
}

/** 가져오기용 — 중복 이름은 그대로 두고 모두 추가한다(원본 동작 유지). */
export async function importSavedQueries(items: { name: string; query: string; timestamp?: string }[]): Promise<void> {
  const now = new Date().toISOString()
  for (const it of items) {
    await savedStore.put({ name: it.name, query: it.query, timestamp: it.timestamp ?? now } as SavedQuery)
  }
}

/** 비운 뒤 채우는 도중 실패하면 원래 내용으로 되돌린다. */
export async function replaceSavedQueries(items: { name: string; query: string; timestamp?: string }[]): Promise<void> {
  const backup = await savedStore.list()
  await savedStore.clear()
  try {
    await importSavedQueries(items)
  } catch (e) {
    await savedStore.clear().catch(() => {})
    for (const b of backup) await savedStore.put(b).catch(() => {})
    throw e
  }
}

export async function importQueryHistory(queries: string[]): Promise<void> {
  for (const q of queries) await saveQueryHistory(q)
}

export async function replaceQueryHistory(queries: string[]): Promise<void> {
  const backup = await queryStore.list()
  await queryStore.clear()
  try {
    await importQueryHistory(queries)
  } catch (e) {
    await queryStore.clear().catch(() => {})
    for (const b of backup) await queryStore.put(b).catch(() => {})
    throw e
  }
}
