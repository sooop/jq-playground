import { describe, expect, it } from 'vitest'
import { AutocompleteCache } from '../src/modes/jq/utils/autocomplete-cache'
import { filterFunctions, JQ_FUNCTIONS } from '../src/modes/jq/core/jq-functions'

describe('JQ_FUNCTIONS', () => {
  it('이름이 중복되지 않는다 (팝업의 keyed each 키로 쓰인다)', () => {
    const names = JQ_FUNCTIONS.map((f) => f.name)
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([])
  })

  it('filterFunctions 결과에도 중복이 없다', () => {
    for (const prefix of ['l', 'nu', 'val', 'un', 'sp', 'is', 'a']) {
      const names = filterFunctions(prefix).map((f) => f.name)
      expect(new Set(names).size).toBe(names.length)
    }
  })

  it('jq 에 없는 is* 계열 이름은 제안하지 않는다', () => {
    const names = new Set(JQ_FUNCTIONS.map((f) => f.name))
    for (const bogus of ['isnull', 'isstring', 'isarray', 'alternative', 'optional']) {
      expect(names.has(bogus)).toBe(false)
    }
  })
})

describe('AutocompleteCache.hashInput', () => {
  it('길이가 같고 앞뒤 100자가 같아도 가운데가 다르면 해시가 다르다', () => {
    const pad = 'x'.repeat(300)
    const a = `{"p":"${pad}","abc":1,"q":"${pad}"}`
    const b = `{"p":"${pad}","xyz":1,"q":"${pad}"}`
    expect(a.length).toBe(b.length)
    expect(AutocompleteCache.hashInput(a)).not.toBe(AutocompleteCache.hashInput(b))
  })

  it('같은 입력은 같은 해시를 준다', () => {
    const s = '{"a":1}'
    expect(AutocompleteCache.hashInput(s)).toBe(AutocompleteCache.hashInput('{"a":' + '1}'))
  })
})
