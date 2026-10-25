import { describe, expect, it } from 'vitest'
import { filterEntries, MAX_ENTRIES, scanJson } from '../src/modes/jq/utils/json-position-scanner'

describe('json-position-scanner', () => {
  it('60자를 넘는 값도 뒷부분까지 검색된다', () => {
    const long = 'x'.repeat(100) + 'NEEDLE'
    const entries = scanJson(JSON.stringify({ a: long, b: 'short' }))
    const hit = filterEntries(entries, 'needle', false, true)
    expect(hit.map((e) => e.path)).toEqual(['.a'])
    // 표시용 값은 그대로 잘린다
    expect(hit[0]!.value.endsWith('…')).toBe(true)
  })

  it('정규식 검색은 따옴표 없이 값 자체에 대해 돈다', () => {
    const entries = scanJson(JSON.stringify({ a: 'abc', b: 'xabc' }))
    expect(filterEntries(entries, '^abc$', false, true, true).map((e) => e.path)).toEqual(['.a'])
  })

  it('항목 수가 상한에 닿으면 거기서 멈춘다', () => {
    const arr = Array.from({ length: MAX_ENTRIES + 10 }, (_, i) => i)
    expect(scanJson(JSON.stringify(arr)).length).toBe(MAX_ENTRIES)
  })
})
