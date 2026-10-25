import { describe, expect, it } from 'vitest'
import { cleanMessage, describeRunError } from '../src/modes/jq/core/run-error'

describe('describeRunError', () => {
  it('jq 쿼리 오류: 줄 위치와 첫 줄 메시지', () => {
    const q = '.a\n| .b['
    const msg =
      'jq: error: syntax error, unexpected end of file (Unix shell quoting issues?) at <top-level>, line 2:\n.a\n| .b[\njq: 1 compile error'
    const v = describeRunError('query', msg, q)
    expect(v.title).toBe('jq 쿼리 오류')
    expect(v.loc).toBe('2행')
    expect(v.offset).toBe(3)
    expect(v.detail).toBe('syntax error, unexpected end of file')
  })
  it('입력 JSON 오류: position → 줄:열', () => {
    const text = '{\n  "a": 1,\n  x\n}'
    const v = describeRunError('input', 'Unexpected token x in JSON at position 14', text)
    expect(v.loc).toBe('3:3')
    expect(v.offset).toBe(14)
  })
  it('위치가 없으면 loc·offset 없음', () => {
    const v = describeRunError('input', 'JSON Parse error: Unrecognized token', '{x')
    expect(v.loc).toBeUndefined()
    expect(v.offset).toBeUndefined()
    expect(cleanMessage('a')).toBe('a')
  })
})
