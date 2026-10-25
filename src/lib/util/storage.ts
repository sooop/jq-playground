/**
 * localStorage 래퍼. `file://`이나 프라이버시 모드에서 접근이 막혀도 앱이 죽지 않아야 하므로
 * 모든 접근을 try/catch로 감싸고 실패 시 메모리 폴백을 쓴다.
 */

const PREFIX = 'xsv.'
const memory = new Map<string, string>()
/** localStorage 쓰기에 실패한 키 — 읽을 때 오래된 저장값 대신 메모리의 최신 값을 돌려준다 */
const memoryFirst = new Set<string>()
let failureHandler: (() => void) | null = null
let failureNotified = false

/** 저장 실패(용량 초과 등)를 한 번만 알리는 콜백을 등록한다. UI 계층이 토스트 등으로 연결한다. */
export function onSaveFailure(handler: (() => void) | null): void {
  failureHandler = handler
}

let available: boolean | null = null

function usable(): boolean {
  if (available !== null) return available
  try {
    const probe = PREFIX + '__probe'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    available = true
  } catch {
    available = false
  }
  return available
}

function readRaw(key: string): string | null {
  if (memoryFirst.has(key)) return memory.get(key) ?? null
  if (usable()) {
    try {
      return localStorage.getItem(PREFIX + key)
    } catch {
      /* fallthrough */
    }
  }
  return memory.get(key) ?? null
}

function writeRaw(key: string, value: string): void {
  memory.set(key, value)
  if (usable()) {
    try {
      localStorage.setItem(PREFIX + key, value)
      memoryFirst.delete(key)
      return
    } catch {
      /* 용량 초과 등 — 이 세션에서는 메모리 값을 우선하고 한 번 알린다 */
    }
    memoryFirst.add(key)
    if (!failureNotified) {
      failureNotified = true
      failureHandler?.()
    }
  }
}

export function load<T>(key: string, fallback: T): T {
  const raw = readRaw(key)
  if (raw === null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function save(key: string, value: unknown): void {
  try {
    writeRaw(key, JSON.stringify(value))
  } catch {
    /* 순환 참조 등 — 저장 실패는 무시 */
  }
}
