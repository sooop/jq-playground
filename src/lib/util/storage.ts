/**
 * localStorage 래퍼. `file://`이나 프라이버시 모드에서 접근이 막혀도 앱이 죽지 않아야 하므로
 * 모든 접근을 try/catch로 감싸고 실패 시 메모리 폴백을 쓴다.
 */

const PREFIX = 'xsv.'
const memory = new Map<string, string>()

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
    } catch {
      /* 용량 초과 등 — 메모리 폴백으로 충분 */
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
