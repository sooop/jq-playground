import { describe, expect, it } from 'vitest'
import { CsvParser, parseAll } from '../src/lib/parse/csv'
import {
  columnLabel,
  decodeBytes,
  detectColType,
  detectDelimiter,
  detectHasHeader,
  finalize,
  looksDate,
  looksNumeric,
  normalizeHeader,
  parseNumeric,
} from '../src/lib/parse/detect'
import { quoteField, serialize, toHtmlTable, toTsv } from '../src/lib/parse/serialize'

describe('CsvParser', () => {
  it('기본 행/필드 분리', () => {
    expect(parseAll('a,b,c\n1,2,3', ',')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('인용 필드 안의 구분자', () => {
    expect(parseAll('"a,b",c', ',')).toEqual([['a,b', 'c']])
  })

  it('인용 필드 안의 개행', () => {
    expect(parseAll('"line1\nline2",x', ',')).toEqual([['line1\nline2', 'x']])
  })

  it('"" 이스케이프', () => {
    expect(parseAll('"a""b"', ',')).toEqual([['a"b']])
    expect(parseAll('""""', ',')).toEqual([['"']])
  })

  it('인용된 빈 값은 살리고 빈 줄은 버린다', () => {
    expect(parseAll('""', ',')).toEqual([['']])
    expect(parseAll('a\n\nb', ',')).toEqual([['a'], ['b']])
    expect(parseAll('a\n\n', ',')).toEqual([['a']])
  })

  it('인용된 빈 값 여러 개', () => {
    expect(parseAll('"",""', ',')).toEqual([['', '']])
  })

  it('CRLF와 CR 단독', () => {
    expect(parseAll('a,b\r\nc,d', ',')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(parseAll('a,b\rc,d', ',')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('필드 중간의 따옴표는 리터럴로 보존', () => {
    expect(parseAll('a"b,c', ',')).toEqual([['a"b', 'c']])
  })

  it('닫히지 않은 인용은 남은 내용을 필드로 확정', () => {
    expect(parseAll('"abc', ',')).toEqual([['abc']])
    expect(parseAll('a,"bc\ndef', ',')).toEqual([['a', 'bc\ndef']])
  })

  it('탭 구분자', () => {
    expect(parseAll('a\tb\n1\t2', '\t')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('빈 입력', () => {
    expect(parseAll('', ',')).toEqual([])
    expect(parseAll('\n', ',')).toEqual([])
  })

  it('후행 빈 필드 보존', () => {
    expect(parseAll('a,b,', ',')).toEqual([['a', 'b', '']])
    expect(parseAll(',,', ',')).toEqual([['', '', '']])
  })

  it('청크 경계가 임의 위치여도 결과가 같다', () => {
    const text = 'id,name,note\n1,"kim, h","a""b"\n2,lee,"multi\nline"\n3,park,plain\n'
    const expected = parseAll(text, ',')
    for (let cut = 1; cut < text.length; cut++) {
      const p = new CsvParser(',')
      p.push(text.slice(0, cut))
      p.push(text.slice(cut))
      expect(p.finish(), `cut=${cut}`).toEqual(expected)
    }
  })

  it('한 글자씩 밀어 넣어도 결과가 같다', () => {
    const text = 'a,"b,c"\r\n"d""e",f\rg,h'
    const p = new CsvParser(',')
    for (const ch of text) p.push(ch)
    expect(p.finish()).toEqual(parseAll(text, ','))
  })
})

describe('detectDelimiter', () => {
  it('콤마', () => {
    expect(detectDelimiter('a,b,c\n1,2,3\n4,5,6')).toBe(',')
  })
  it('탭', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t')
  })
  it('세미콜론', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
  })
  it('파이프', () => {
    expect(detectDelimiter('a|b|c\n1|2|3')).toBe('|')
  })
  it('인용 안의 콤마에 속지 않는다', () => {
    // 값에 콤마가 많아도 실제 구분자는 탭
    const text = 'name\tnote\n"kim, h, j"\tx\n"lee, a, b"\ty'
    expect(detectDelimiter(text)).toBe('\t')
  })
  it('단일 칼럼이면 콤마로 폴백', () => {
    expect(detectDelimiter('abc\ndef')).toBe(',')
  })
})

describe('타입 판정', () => {
  it('looksNumeric', () => {
    expect(looksNumeric('123')).toBe(true)
    expect(looksNumeric('-1.5')).toBe(true)
    expect(looksNumeric('1,234')).toBe(true)
    expect(looksNumeric('50%')).toBe(true)
    expect(looksNumeric('₩1,000')).toBe(true)
    expect(looksNumeric('')).toBe(false)
    expect(looksNumeric('abc')).toBe(false)
    expect(looksNumeric('-')).toBe(false)
    expect(looksNumeric('1.2.3')).toBe(false)
  })

  it('parseNumeric', () => {
    expect(parseNumeric('1,234')).toBe(1234)
    expect(parseNumeric('-1.5')).toBe(-1.5)
    expect(parseNumeric('50%')).toBeCloseTo(0.5)
    expect(parseNumeric('(1,234)')).toBe(-1234)
    expect(parseNumeric('abc')).toBeNaN()
  })

  it('looksDate', () => {
    expect(looksDate('2024-01-02')).toBe(true)
    expect(looksDate('2024/01/02')).toBe(true)
    expect(looksDate('2024.01.02')).toBe(true)
    expect(looksDate('2024-01-02T10:30:00')).toBe(true)
    expect(looksDate('2024-01-02 10:30')).toBe(true)
    expect(looksDate('01/02/2024')).toBe(false)
    expect(looksDate('abc')).toBe(false)
  })

  it('detectColType', () => {
    const rows = [
      ['1', 'a', '2024-01-01'],
      ['2', 'b', '2024-01-02'],
      ['3', 'c', '2024-01-03'],
    ]
    expect(detectColType(rows, 0)).toBe('number')
    expect(detectColType(rows, 1)).toBe('string')
    expect(detectColType(rows, 2)).toBe('date')
  })

  it('detectColType은 10% 이하의 이물질을 허용', () => {
    const rows = Array.from({ length: 100 }, (_, i) => [i === 50 ? 'N/A' : String(i)])
    expect(detectColType(rows, 0)).toBe('number')
  })

  it('detectColType은 빈 칼럼을 string으로', () => {
    expect(detectColType([[''], ['']], 0)).toBe('string')
  })
})

describe('detectHasHeader', () => {
  it('문자열 헤더 + 숫자 데이터', () => {
    expect(
      detectHasHeader([
        ['id', 'name'],
        ['1', 'kim'],
      ]),
    ).toBe(true)
  })
  it('1행에 숫자가 있으면 데이터', () => {
    expect(
      detectHasHeader([
        ['1', 'kim'],
        ['2', 'lee'],
      ]),
    ).toBe(false)
  })
  it('1행에 빈 셀이 있으면 헤더 아님', () => {
    expect(
      detectHasHeader([
        ['id', ''],
        ['1', 'kim'],
      ]),
    ).toBe(false)
  })
  it('1행에 중복이 많으면 헤더 아님', () => {
    expect(
      detectHasHeader([
        ['x', 'x', 'x', 'x'],
        ['a', 'b', 'c', 'd'],
      ]),
    ).toBe(false)
  })
  it('행이 하나면 헤더 아님', () => {
    expect(detectHasHeader([['id', 'name']])).toBe(false)
  })
})

describe('normalizeHeader / columnLabel', () => {
  it('중복 칼럼명 구분', () => {
    expect(normalizeHeader(['a', 'a', 'a'], 3)).toEqual(['a', 'a (2)', 'a (3)'])
  })
  it('빈 칼럼명은 라벨로 대체', () => {
    expect(normalizeHeader(['a', '', 'c'], 3)).toEqual(['a', 'B', 'c'])
  })
  it('width가 이름보다 많으면 라벨로 채움', () => {
    expect(normalizeHeader(['a'], 3)).toEqual(['a', 'B', 'C'])
  })
  it('columnLabel', () => {
    expect(columnLabel(0)).toBe('A')
    expect(columnLabel(25)).toBe('Z')
    expect(columnLabel(26)).toBe('AA')
    expect(columnLabel(27)).toBe('AB')
    expect(columnLabel(51)).toBe('AZ')
    expect(columnLabel(52)).toBe('BA')
  })
})

describe('finalize', () => {
  it('불규칙 행을 최대 폭으로 패딩하고 건수를 센다', () => {
    const r = finalize([['a', 'b', 'c'], ['1', '2'], ['3']], ',', true, false)
    expect(r.width).toBe(3)
    expect(r.raggedRows).toBe(2)
    expect(r.rows).toEqual([
      ['1', '2', ''],
      ['3', '', ''],
    ])
    expect(r.header).toEqual(['a', 'b', 'c'])
  })

  it('헤더 없음 지정 시 A,B,C 생성하고 1행도 데이터로', () => {
    const r = finalize(
      [
        ['1', '2'],
        ['3', '4'],
      ],
      ',',
      false,
      false,
    )
    expect(r.header).toEqual(['A', 'B'])
    expect(r.rows).toHaveLength(2)
  })

  it('빈 입력', () => {
    const r = finalize([], ',', null, false)
    expect(r.rows).toEqual([])
    expect(r.width).toBe(0)
    expect(r.hasHeader).toBe(false)
  })
})

describe('serialize', () => {
  const opts = { delimiter: ',' as const, quoting: 'minimal' as const, newline: '\n' as const }

  it('필요할 때만 인용', () => {
    expect(quoteField('abc', opts)).toBe('abc')
    expect(quoteField('a,b', opts)).toBe('"a,b"')
    expect(quoteField('a"b', opts)).toBe('"a""b"')
    expect(quoteField('a\nb', opts)).toBe('"a\nb"')
    expect(quoteField(' a ', opts)).toBe('" a "')
    expect(quoteField('', opts)).toBe('')
  })

  it('always 모드는 전부 인용', () => {
    expect(quoteField('abc', { ...opts, quoting: 'always' })).toBe('"abc"')
    expect(quoteField('', { ...opts, quoting: 'always' })).toBe('""')
  })

  it('행 결합', () => {
    expect(
      serialize(
        [
          ['a', 'b'],
          ['1', '2'],
        ],
        opts,
      ),
    ).toBe('a,b\n1,2')
  })

  it('CRLF 개행', () => {
    expect(serialize([['a'], ['b']], { ...opts, newline: '\r\n' })).toBe('a\r\nb')
  })

  it('파싱 라운드트립', () => {
    const data = [
      ['id', 'name', 'note'],
      ['1', 'kim, h', 'say "hi"'],
      ['2', 'lee', 'multi\nline'],
      ['3', '', ' padded '],
      ['4', 'tab\there', 'plain'],
    ]
    for (const quoting of ['minimal', 'always'] as const) {
      for (const newline of ['\n', '\r\n'] as const) {
        const text = serialize(data, { delimiter: ',', quoting, newline })
        expect(parseAll(text, ','), `${quoting}/${JSON.stringify(newline)}`).toEqual(data)
      }
    }
  })

  it('TSV 라운드트립', () => {
    const data = [
      ['a', 'b'],
      ['tab\there', 'x'],
    ]
    expect(parseAll(toTsv(data), '\t')).toEqual(data)
  })

  it('HTML 테이블 이스케이프', () => {
    expect(toHtmlTable([['<a>', '&']], false)).toBe(
      '<table><tr><td>&lt;a&gt;</td><td>&amp;</td></tr></table>',
    )
    expect(toHtmlTable([['h'], ['d']], true)).toBe(
      '<table><tr><th>h</th></tr><tr><td>d</td></tr></table>',
    )
  })
})

describe('decodeBytes', () => {
  it('UTF-8 한글', () => {
    const bytes = new TextEncoder().encode('이름,값\n김,1')
    const r = decodeBytes(bytes.buffer as ArrayBuffer)
    expect(r.encoding).toBe('utf-8')
    expect(r.text).toBe('이름,값\n김,1')
  })

  it('BOM 제거', () => {
    const bytes = new TextEncoder().encode('﻿a,b')
    expect(decodeBytes(bytes.buffer as ArrayBuffer).text).toBe('a,b')
  })

  it('cp949 바이트를 감지해 폴백', () => {
    // '한글' in cp949 = C7 D1 B1 DB
    const bytes = new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb, 0x2c, 0x31])
    const r = decodeBytes(bytes.buffer as ArrayBuffer)
    expect(r.encoding).toBe('cp949')
    expect(r.text).toBe('한글,1')
  })
})
