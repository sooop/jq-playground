import { describe, expect, it } from 'vitest'
import { decodeBytes, looksDate, parseDate } from '../src/lib/parse/detect'
import { stepIndex, type FindHit } from '../src/lib/data/find'

describe('날짜·인코딩·찾기 회귀', () => {
  it('소수 초가 있는 ISO 타임스탬프를 날짜로 인식한다', () => {
    expect(looksDate('2024-01-02T10:00:00.123Z')).toBe(true)
    expect(parseDate('2024/01/02 10:00:00.5')).not.toBeNaN()
    expect(looksDate('2024.01.02')).toBe(true)
  })

  it('UTF-16 LE BOM 입력을 디코딩한다', () => {
    const s = 'a\tb\n가\t나'
    const buf = new Uint8Array(2 + s.length * 2)
    buf.set([0xff, 0xfe])
    for (let i = 0; i < s.length; i++) {
      buf[2 + i * 2] = s.charCodeAt(i) & 0xff
      buf[3 + i * 2] = s.charCodeAt(i) >> 8
    }
    const r = decodeBytes(buf.buffer)
    expect(r.encoding).toBe('utf-16le')
    expect(r.text).toBe(s)
  })

  it('역방향 찾기는 활성 셀 바로 왼쪽 셀의 매치를 건너뛰지 않는다', () => {
    const hits: FindHit[] = [
      { r: 0, c: 1, text: '', at: 0, len: 1 },
      { r: 0, c: 2, text: '', at: 0, len: 1 },
    ]
    // 활성 셀 (0,3): findState 가 dir=-1 에서 c+1 을 넘긴다
    expect(stepIndex(hits, { r: 0, c: 3 + 1 }, -1)).toBe(1)
  })
})
