import { describe, expect, it } from 'vitest'
import { commandScore, searchScore } from '../src/modes/jq/util/fuzzy'
import { keymapEntries, type Command } from '../src/modes/jq/utils/commands'

describe('searchScore — 초성', () => {
  it('초성만으로 찾는다', () => {
    expect(searchScore('ㅂㅅ', '출력 복사')).toBeGreaterThan(0) // 복사
    expect(searchScore('ㄴㄹㅂㄱ', '출력 내려받기')).toBeGreaterThan(0) // 내려받기
    expect(searchScore('ㅈㄷㅅㅎ', '자동 실행 토글')).toBeGreaterThan(0) // 공백 무시
  })

  it('초성과 완성 글자를 섞어도 된다', () => {
    expect(searchScore('복ㅅ', '출력 복사')).toBeGreaterThan(0)
    expect(searchScore('내려ㅂ', '출력 내려받기')).toBeGreaterThan(0)
  })

  it('쌍자음은 평자음으로 접는다', () => {
    expect(searchScore('ㄱㅈ', '까지')).toBeGreaterThan(0)
  })

  it('맞지 않는 초성은 실패한다', () => {
    expect(searchScore('ㅋㅋ', '출력 복사')).toBe(0)
    expect(searchScore('ㅂㅅㅇ', '복사')).toBe(0)
  })

  it('초성 연속 일치가 흩어진 일치보다 높다', () => {
    const contiguous = searchScore('ㅂㅅ', '출력 복사')
    const scattered = searchScore('ㅂㅅ', '복원 설정 사용')
    expect(contiguous).toBeGreaterThan(scattered)
  })

  it('일반 검색은 기존 동작을 유지한다', () => {
    expect(searchScore('Transform', 'JSON Transform')).toBeGreaterThan(0)
    expect(searchScore('xyz', 'JSON Transform')).toBe(0)
    expect(searchScore('복사', '출력 복사')).toBeGreaterThan(0)
  })
})

describe('commandScore — 키워드', () => {
  const copy = {
    label: '출력 복사',
    keywords: ['copy', 'clipboard', '복사', '클립보드'],
  }

  it('이름에 없는 영어 키워드로 찾는다', () => {
    expect(commandScore('copy', copy)).toBeGreaterThan(0)
    expect(commandScore('clip', copy)).toBeGreaterThan(0)
  })

  it('이름에 없는 한국어 키워드로 찾는다', () => {
    expect(commandScore('클립', copy)).toBeGreaterThan(0)
  })

  it('키워드도 초성으로 찾는다', () => {
    expect(commandScore('ㅋㄹㅂㄷ', copy)).toBeGreaterThan(0) // 클립보드
  })

  it('관련 없는 검색어는 0', () => {
    expect(commandScore('download', copy)).toBe(0)
  })

  it('이름 일치가 키워드 일치보다 앞선다', () => {
    const byLabel = commandScore('복사', { label: '출력 복사', keywords: ['copy'] })
    const byKeyword = commandScore('복사', { label: '내려받기', keywords: ['복사'] })
    expect(byLabel).toBeGreaterThan(byKeyword)
  })

  it('키워드는 개별로 채점한다 — 여러 키워드에 흩어진 글자가 합쳐 맞지 않는다', () => {
    expect(commandScore('cd', { label: 'x', keywords: ['car', 'dog'] })).toBe(0)
  })
})

describe('keymapEntries', () => {
  const cmds: Command[] = [
    { id: 'a', label: 'A', keys: 'Ctrl+A', run: () => {} },
    { id: 'b', label: 'B', hint: 'Ctrl+B (패널 안)', run: () => {} },
  ]

  it('keys 가 있는 명령만 keymap 항목이 된다', () => {
    expect(keymapEntries(cmds).map((e) => e.id)).toEqual(['a'])
  })

  it('hint 만 있는 명령은 전역 단축키로 가로채지 않는다', () => {
    expect(keymapEntries(cmds).some((e) => e.id === 'b')).toBe(false)
  })
})
