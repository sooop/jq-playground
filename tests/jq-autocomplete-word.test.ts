import { describe, expect, it } from 'vitest'
import {
  applyItem,
  atLineIndent,
  filterAndSortKeys,
  getCurrentWord,
  getFieldAccessContext,
  toJqFieldPath,
  truncatePath,
  type AcItem,
} from '../src/modes/jq/autocomplete/word'

describe('getCurrentWord', () => {
  it('커서가 걸친 식별자를 잡는다', () => {
    const w = getCurrentWord('map(sel', 7)
    expect(w.word).toBe('sel')
    expect(w.start).toBe(4)
    expect(w.end).toBe(7)
    expect(w.isCursorAtWordEnd).toBe(true)
    expect(w.isFieldAccess).toBe(false)
  })

  it('점 뒤의 빈 단어를 필드 접근으로 본다', () => {
    const w = getCurrentWord('.', 1)
    expect(w.word).toBe('')
    expect(w.isFieldAccess).toBe(true)
  })

  it('.foo 는 필드 접근이다', () => {
    const w = getCurrentWord('.users', 6)
    expect(w.word).toBe('users')
    expect(w.isFieldAccess).toBe(true)
  })

  it('$변수를 한 단어로 잡는다', () => {
    const w = getCurrentWord('.x as $pr', 9)
    expect(w.word).toBe('$pr')
  })

  it('커서가 단어 중간이면 isCursorAtWordEnd 가 false', () => {
    const w = getCurrentWord('select', 3)
    expect(w.word).toBe('select')
    expect(w.isCursorAtWordEnd).toBe(false)
  })
})

describe('getFieldAccessContext', () => {
  it('접두가 없으면 hasPrefix 가 false', () => {
    expect(getFieldAccessContext('.users', 6)).toEqual({
      hasPrefix: false,
      prefix: '',
      currentSegment: 'users',
    })
  })

  it('마지막 점 기준으로 접두를 분리한다', () => {
    expect(getFieldAccessContext('.users.profile.c', 16)).toEqual({
      hasPrefix: true,
      prefix: 'users.profile',
      currentSegment: 'c',
    })
  })

  it('[] 는 경로의 일부로 남는다', () => {
    expect(getFieldAccessContext('.users[].name', 13)).toEqual({
      hasPrefix: true,
      prefix: 'users[]',
      currentSegment: 'name',
    })
  })

  it('파이프·괄호·공백에서 경로가 끊긴다', () => {
    expect(getFieldAccessContext('.a | .b.c', 9)).toEqual({
      hasPrefix: true,
      prefix: 'b',
      currentSegment: 'c',
    })
  })

  it('점으로 시작하지 않으면 접두 없이 통째로 돌려준다', () => {
    expect(getFieldAccessContext('map', 3)).toEqual({
      hasPrefix: false,
      prefix: '',
      currentSegment: 'map',
    })
  })
})

describe('filterAndSortKeys', () => {
  const keys = ['name', 'age', 'profile.city', 'profile.country', 'items[].price']

  it('접두가 있으면 그 아래 한 단계만 남긴다', () => {
    const r = filterAndSortKeys(keys, [], 'c', true, 'profile')
    expect(r.map((x) => x.name)).toEqual(['city', 'country'])
    expect(r[0]!.fullKey).toBe('profile.city')
  })

  it('접두가 없으면 전체 경로나 마지막 세그먼트로 매치한다', () => {
    const r = filterAndSortKeys(keys, [], 'na', false, '')
    expect(r.map((x) => x.name)).toEqual(['name'])
  })

  it('컨텍스트 키를 앞으로 올린다', () => {
    const r = filterAndSortKeys(['b', 'a'], ['b'], '', false, '')
    expect(r.map((x) => x.name)).toEqual(['b', 'a'])
    expect(r[0]!.desc).toBe('Context field')
    expect(r[1]!.desc).toBe('Input field')
  })

  it('최대 15개로 자른다', () => {
    const many = Array.from({ length: 40 }, (_, i) => `k${i}`)
    expect(filterAndSortKeys(many, [], 'k', false, '')).toHaveLength(15)
  })
})

describe('applyItem', () => {
  const fn = (name: string): AcItem => ({ name, desc: '', inputType: 'any' })

  it('괄호가 필요한 함수는 ( 를 함께 넣는다', () => {
    const r = applyItem('sel', fn('select'), 0, 3)
    expect(r.text).toBe('select(')
    expect(r.cursor).toBe(7)
  })

  it('바로 뒤가 이미 ( 면 넣지 않는다', () => {
    const r = applyItem('sel()', fn('select'), 0, 3)
    expect(r.text).toBe('select()')
    expect(r.cursor).toBe(6)
  })

  it('필드 후보에는 괄호를 붙이지 않는다', () => {
    const item: AcItem = { name: 'map', desc: '', inputType: 'field' }
    expect(applyItem('.ma', item, 1, 3).text).toBe('.map')
  })

  it('하이픈이 든 필드 키는 앞의 점을 두고 bracket notation 으로 넣는다', () => {
    const item: AcItem = { name: 'status-line', desc: '', inputType: 'field' }
    const r = applyItem('.tipsHistory.', item, 13, 13)
    expect(r.text).toBe('.tipsHistory.["status-line"]')
    expect(r.cursor).toBe(r.text.length)
  })

  it('숫자로 시작하는 필드 키도 bracket notation 으로 넣는다', () => {
    const item: AcItem = { name: '2fa', desc: '', inputType: 'field' }
    const r = applyItem('.', item, 1, 1)
    expect(r.text).toBe('.["2fa"]')
  })

  it('유효한 식별자 필드 키는 그대로 dot notation 을 쓴다', () => {
    const item: AcItem = { name: 'status_line', desc: '', inputType: 'field' }
    expect(applyItem('.', item, 1, 1).text).toBe('.status_line')
  })

  it('파이프 뒤 새 표현식의 identity dot 은 지우지 않는다', () => {
    const item: AcItem = { name: 'status-line', desc: '', inputType: 'field' }
    const r = applyItem('.a | .', item, 6, 6)
    expect(r.text).toBe('.a | .["status-line"]')
  })

  it('여러 단계 후보는 세그먼트별로 감싼다 — 전부 bare 면 그대로', () => {
    const f = (name: string): AcItem => ({ name, desc: '', inputType: 'field' })
    expect(applyItem('.a.', f('b.c'), 3, 3).text).toBe('.a.b.c')
    expect(applyItem('.', f('users[].name'), 1, 1).text).toBe('.users[].name')
    expect(applyItem('.tipsHistory.', f('agent-flag.count'), 13, 13).text).toBe(
      '.tipsHistory.["agent-flag"].count',
    )
    expect(applyItem('.', f('users[].user-id'), 1, 1).text).toBe('.users[].["user-id"]')
    expect(applyItem('.', f('이름[].성'), 1, 1).text).toBe('.["이름"][].["성"]')
  })

  it('공백이 든 필드도 대괄호로 감싼다', () => {
    const item: AcItem = { name: 'a b', desc: '', inputType: 'field' }
    expect(applyItem('.a', item, 1, 2).text).toBe('.["a b"]')
  })

  it('따옴표가 든 필드는 이스케이프한다', () => {
    const item: AcItem = { name: 'a"b', desc: '', inputType: 'field' }
    expect(applyItem('.a', item, 1, 2).text).toBe('.["a\\"b"]')
  })

  it('앞에 점이 없는 자리(객체 축약형)에는 변환하지 않는다', () => {
    const item: AcItem = { name: 'name', desc: '', inputType: 'field' }
    expect(applyItem('{na', item, 1, 3).text).toBe('{name')
  })
})

describe('toJqFieldPath', () => {
  it('숫자로 시작하는 키·빈 키도 감싼다', () => {
    expect(toJqFieldPath('2024.q1')).toBe('["2024"].q1')
    expect(toJqFieldPath('')).toBe('[""]')
  })
})

describe('atLineIndent', () => {
  it('줄 앞이 공백뿐이면 true', () => {
    expect(atLineIndent('.a |\n  ', 7)).toBe(true)
  })
  it('내용이 있으면 false', () => {
    expect(atLineIndent('.a |\n  map', 10)).toBe(false)
  })
})

describe('truncatePath', () => {
  it('짧으면 그대로', () => {
    expect(truncatePath('a.b.c')).toBe('a.b.c')
  })
  it('길면 오른쪽을 남긴다', () => {
    const long = 'users[].profile.address.street.name.and.more.segments'
    const t = truncatePath(long, 20)
    expect(t.startsWith('...')).toBe(true)
    expect(t).toHaveLength(20)
    expect(long.endsWith(t.slice(3))).toBe(true)
  })
})
