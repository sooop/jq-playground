import { describe, expect, it } from 'vitest'
import {
  columnLetters,
  renderTextFormat,
  textWidth,
  toBoxTable,
  toHtmlMarkup,
  toJson,
  toMarkdownList,
  toMarkdownTable,
  toRichHtmlDocument,
} from '../src/lib/parse/formats'

describe('toHtmlMarkup (서식 없는 표 마크업)', () => {
  it('헤더는 thead/th, 본문은 tbody/td 이고 HTML 특수문자를 이스케이프한다', () => {
    const m = [
      ['이름', 'a&b'],
      ['홍길동', '<x>'],
      ['', 'q"\''],
    ]
    expect(toHtmlMarkup(m, true)).toBe(
      '<table><thead><tr><th>이름</th><th>a&amp;b</th></tr></thead>' +
        '<tbody><tr><td>홍길동</td><td>&lt;x&gt;</td></tr>' +
        '<tr><td></td><td>q&quot;&#39;</td></tr></tbody></table>',
    )
  })

  it('셀 안의 개행은 <br> 로 바꾼다', () => {
    expect(toHtmlMarkup([['h'], ['a\nb']], true)).toBe(
      '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>a<br>b</td></tr></tbody></table>',
    )
  })

  it('헤더 없음이면 thead 없이 모든 행을 td 로 쓴다', () => {
    expect(toHtmlMarkup([['1', '2']], false)).toBe(
      '<table><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    )
  })
})

describe('toRichHtmlDocument (서식 있는 완전한 문서)', () => {
  it('인라인 스타일이 든 문서 골격과 정확한 본문을 만든다', () => {
    const TD = 'border:1px solid #999;padding:3px 6px;vertical-align:top'
    const TH = `${TD};background:#f0f0f0;font-weight:bold;text-align:left`
    expect(toRichHtmlDocument([['a'], ['1']], true, 'T')).toBe(
      [
        '<!DOCTYPE html>',
        '<html lang="ko">',
        '<head>',
        '<meta charset="utf-8">',
        '<title>T</title>',
        '</head>',
        '<body>',
        '<table style="border-collapse:collapse;font-family:sans-serif;font-size:12px">',
        `<thead><tr><th style="${TH}">a</th></tr></thead>`,
        '<tbody>',
        `<tr><td style="${TD}">1</td></tr>`,
        '</tbody>',
        '</table>',
        '</body>',
        '</html>',
      ].join('\n'),
    )
  })

  it('제목은 HTML 이스케이프한다', () => {
    expect(toRichHtmlDocument([['a']], false, 'x<y')).toContain('<title>x&lt;y</title>')
  })
})

describe('textWidth (표시 칸 수)', () => {
  it('한글·전각은 2칸, ASCII 는 1칸', () => {
    expect(textWidth('한글A')).toBe(5)
    expect(textWidth('ＡＢ')).toBe(4)
    expect(textWidth('')).toBe(0)
  })
})

describe('toBoxTable (박스 문자 표)', () => {
  it('한글을 폭 2로 계산해 정렬하고, 헤더 아래 구분선과 개행 치환을 적용한다', () => {
    const m = [
      ['이름', '나이'],
      ['홍길동', '30'],
      ['A', 'b\nc'],
    ]
    expect(toBoxTable(m, true)).toBe(
      [
        '┌' + '─'.repeat(8) + '┬' + '─'.repeat(6) + '┐',
        '│ 이름   │ 나이 │',
        '├' + '─'.repeat(8) + '┼' + '─'.repeat(6) + '┤',
        '│ 홍길동 │ 30   │',
        '│ A      │ b c  │',
        '└' + '─'.repeat(8) + '┴' + '─'.repeat(6) + '┘',
      ].join('\n'),
    )
  })

  it('헤더가 없으면 구분선 없이 위·아래 테두리만 쓴다', () => {
    expect(toBoxTable([['a', 'b']], false)).toBe(
      ['┌───┬───┐', '│ a │ b │', '└───┴───┘'].join('\n'),
    )
  })

  it('빈 값은 공백 칸으로 남는다', () => {
    expect(toBoxTable([['x', ''], ['yy', 'z']], false)).toBe(
      ['┌────┬───┐', '│ x  │   │', '│ yy │ z │', '└────┴───┘'].join('\n'),
    )
  })
})

describe('toJson (객체 배열 / 배열의 배열)', () => {
  it('헤더가 키이고 값은 문자열 그대로, 들여쓰기 2칸', () => {
    const m = [
      ['이름', '값'],
      ['홍길동', '007'],
      ['', '1e3'],
    ]
    expect(toJson(m, true)).toBe(
      [
        '[',
        '  {',
        '    "이름": "홍길동",',
        '    "값": "007"',
        '  },',
        '  {',
        '    "이름": "",',
        '    "값": "1e3"',
        '  }',
        ']',
      ].join('\n'),
    )
  })

  it('헤더 없음이면 배열의 배열, 따옴표는 이스케이프', () => {
    expect(toJson([['1', 'a"b']], false)).toBe(
      ['[', '  [', '    "1",', '    "a\\"b"', '  ]', ']'].join('\n'),
    )
  })

  it('헤더만 있으면 빈 배열', () => {
    expect(toJson([['a']], true)).toBe('[]')
  })
})

describe('toMarkdownTable (마크다운 파이프 표)', () => {
  it('셀의 | 는 \\| 로, 개행은 <br> 로 바꾸고 빈 셀은 빈 칸으로 둔다', () => {
    const m = [
      ['이름', '메모'],
      ['a|b', '1\n2'],
      ['', 'x'],
    ]
    expect(toMarkdownTable(m, true)).toBe(
      ['| 이름 | 메모 |', '|---|---|', '| a\\|b | 1<br>2 |', '|  | x |'].join('\n'),
    )
  })

  it('헤더가 없으면 헤더 행을 빈 칸으로 둔다', () => {
    expect(toMarkdownTable([['1', '2']], false)).toBe(
      ['|  |  |', '|---|---|', '| 1 | 2 |'].join('\n'),
    )
  })
})

describe('toMarkdownList (마크다운 불릿 목록)', () => {
  it('레코드마다 첫 열은 "- ", 나머지는 두 칸 들여쓰기, 빈 값은 "이름:" 만, 빈 줄 없이 이어진다', () => {
    const m = [
      ['이름', '메모', '수량'],
      ['홍길동', '', '3'],
      ['', 'a\nb', ''],
    ]
    expect(toMarkdownList(m, true)).toBe(
      [
        '- 이름: 홍길동',
        '  메모:',
        '  수량: 3',
        '- 이름:',
        '  메모: a<br>b',
        '  수량:',
      ].join('\n'),
    )
  })

  it('헤더가 없어도 열 이름(A, B…)을 항상 쓴다', () => {
    expect(toMarkdownList([['x', 'y']], false)).toBe('- A: x\n  B: y')
  })

  it('열 이름 기본값은 A…Z, AA…', () => {
    expect(columnLetters(0)).toBe('A')
    expect(columnLetters(25)).toBe('Z')
    expect(columnLetters(26)).toBe('AA')
  })
})

describe('renderTextFormat (디스패처)', () => {
  it('형식 키에 맞는 직렬화 함수를 호출한다', () => {
    const m = [['a'], ['1']]
    expect(renderTextFormat('html', m, true)).toBe(toHtmlMarkup(m, true))
    expect(renderTextFormat('json', m, true)).toBe(toJson(m, true))
    expect(renderTextFormat('box', m, true)).toBe(toBoxTable(m, true))
    expect(renderTextFormat('mdtable', m, true)).toBe(toMarkdownTable(m, true))
    expect(renderTextFormat('mdlist', m, true)).toBe(toMarkdownList(m, true))
    expect(renderTextFormat('htmlrich', m, true, 'T')).toBe(toRichHtmlDocument(m, true, 'T'))
  })
})
