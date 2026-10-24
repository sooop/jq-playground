import { describe, expect, it } from 'vitest'
import { ago } from '../src/lib/util/format'

describe('ago', () => {
  const now = new Date(2026, 0, 15, 12, 0, 0).getTime() // 2026-01-15 12:00:00 (로컬)

  it('5초 미만은 방금 전', () => {
    expect(ago(now - 2_000, now)).toBe('방금 전')
  })

  it('1분 미만은 초 단위', () => {
    expect(ago(now - 30_000, now)).toBe('30초 전')
  })

  it('1시간 미만은 분 단위', () => {
    expect(ago(now - 5 * 60_000, now)).toBe('5분 전')
  })

  it('하루 미만은 시간 단위', () => {
    expect(ago(now - 3 * 3_600_000, now)).toBe('3시간 전')
  })

  it('전날 같은 시각 근처는 어제', () => {
    const yesterday = new Date(2026, 0, 14, 9, 0, 0).getTime()
    expect(ago(yesterday, now)).toBe('어제')
  })

  it('일주일 이내는 N일 전', () => {
    const threeDaysAgo = new Date(2026, 0, 12, 9, 0, 0).getTime()
    expect(ago(threeDaysAgo, now)).toBe('3일 전')
  })

  it('일주일 이상은 날짜', () => {
    const longAgo = new Date(2026, 0, 1, 9, 0, 0).getTime()
    expect(ago(longAgo, now)).toBe('2026-01-01')
  })
})
