import { describe, expect, it } from 'vitest'
import { parsePastedTable } from '../src/lib/parse/pasteTable'

describe('parsePastedTable - HTML 표', () => {
  it('thead/tbody, 엔티티, br, 태그 제거', () => {
    const html =
      '<meta charset="utf-8"><table><thead><tr><th>이름</th><th>R&amp;D &lt;x&gt; &quot;q&quot; &#39;a&#39;</th></tr></thead>' +
      '<tbody><tr><td><b>철수</b>&nbsp;님</td><td>1<br>2 &#x41; &#66;</td></tr></tbody></table>'
    expect(parsePastedTable('', html)).toEqual({
      kind: 'html',
      header: ['이름', `R&D <x> "q" 'a'`],
      rows: [['철수 님', '1\n2 A B']],
    })
  })

  it('thead 가 없고 th 도 없으면 첫 행을 header 로', () => {
    const html = '<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>'
    expect(parsePastedTable('', html)).toEqual({ kind: 'html', header: ['a', 'b'], rows: [['1', '2']] })
  })

  it('colspan 은 첫 칸만 값, 나머지는 빈 문자열', () => {
    const html =
      '<table><tr><th colspan="2">제목</th><th>끝</th></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>'
    expect(parsePastedTable('', html)).toEqual({
      kind: 'html',
      header: ['제목', '', '끝'],
      rows: [['1', '2', '3']],
    })
  })

  it('rowspan 은 첫 행에만 값, 아래 행 칸은 빈 문자열', () => {
    const html =
      '<table><tr><th>지역</th><th>값</th></tr>' +
      '<tr><td rowspan="2">서울</td><td>1</td></tr>' +
      '<tr><td>2</td></tr></table>'
    expect(parsePastedTable('', html)).toEqual({
      kind: 'html',
      header: ['지역', '값'],
      rows: [
        ['서울', '1'],
        ['', '2'],
      ],
    })
  })

  it('여러 표가 있으면 첫 표만 쓴다', () => {
    const html = '<table><tr><td>a</td><td>b</td></tr></table><table><tr><td>x</td><td>y</td></tr></table>'
    expect(parsePastedTable('', html)).toEqual({ kind: 'html', header: ['a', 'b'], rows: [] })
  })

  it('표가 없는 html 이면 text 규칙으로 넘어간다', () => {
    expect(parsePastedTable('a,b\n1,2', '<p>hello</p>')).toEqual({
      kind: 'delimited',
      header: ['a', 'b'],
      rows: [['1', '2']],
    })
  })

  it('html 표가 CRLF 와 들여쓰기를 가져도 동작한다', () => {
    const html = '﻿<table>\r\n  <tr>\r\n    <th>k</th>\r\n    <th>v</th>\r\n  </tr>\r\n  <tr><td>1</td><td>2</td></tr>\r\n</table>\r\n'
    expect(parsePastedTable('', html)).toEqual({ kind: 'html', header: ['k', 'v'], rows: [['1', '2']] })
  })
})

describe('parsePastedTable - 마크다운 파이프 표', () => {
  it('양끝 파이프, 정렬 콜론, 셀 공백 제거', () => {
    const text = '| 이름 | 점수 |\n|:---|---:|\n| 철수 | 90 |\n| 영희 | 85 |'
    expect(parsePastedTable(text)).toEqual({
      kind: 'mdtable',
      header: ['이름', '점수'],
      rows: [
        ['철수', '90'],
        ['영희', '85'],
      ],
    })
  })

  it('양끝 파이프가 없어도 인식한다', () => {
    const text = 'a | b\n--- | :--:\n1 | 2'
    expect(parsePastedTable(text)).toEqual({ kind: 'mdtable', header: ['a', 'b'], rows: [['1', '2']] })
  })

  it('\\| 는 셀 안의 | 로, <br> 는 개행으로 복원', () => {
    const text = '| k | v |\n|---|---|\n| a\\|b | 1<br>2 |'
    expect(parsePastedTable(text)).toEqual({
      kind: 'mdtable',
      header: ['k', 'v'],
      rows: [['a|b', '1\n2']],
    })
  })

  it('CRLF 과 앞뒤 공백 줄을 견딘다', () => {
    const text = '\r\n\r\n| a | b |\r\n|---|---|\r\n| 1 | 2 |\r\n\r\n'
    expect(parsePastedTable(text)).toEqual({ kind: 'mdtable', header: ['a', 'b'], rows: [['1', '2']] })
  })

  it('구분선이 없으면 null', () => {
    expect(parsePastedTable('| a | b |\n| 1 | 2 |')).toBeNull()
  })

  it('데이터 행의 열 수가 다르면 null', () => {
    expect(parsePastedTable('| a | b |\n|---|---|\n| 1 | 2 | 3 |')).toBeNull()
  })
})

describe('parsePastedTable - 박스 문자 표', () => {
  it('단선 박스 표', () => {
    const text = [
      '┌────┬────┐',
      '│ 이름 │ 점수 │',
      '├────┼────┤',
      '│ 철수 │ 90 │',
      '├────┼────┤',
      '│ 영희 │ 85 │',
      '└────┴────┘',
    ].join('\n')
    expect(parsePastedTable(text)).toEqual({
      kind: 'box',
      header: ['이름', '점수'],
      rows: [
        ['철수', '90'],
        ['영희', '85'],
      ],
    })
  })

  it('이중선 박스 표', () => {
    const text = ['╔══╦══╗', '║ a ║ b ║', '╠══╬══╣', '║ 1 ║ 2 ║', '╚══╩══╝'].join('\r\n')
    expect(parsePastedTable(text)).toEqual({ kind: 'box', header: ['a', 'b'], rows: [['1', '2']] })
  })

  it('구분선 없이 이어지는 줄은 한 행으로 합쳐 개행으로 잇는다', () => {
    const text = [
      '┌────┬────┐',
      '│ 이름 │ 메모 │',
      '├────┼────┤',
      '│ 철수 │ 첫줄 │',
      '│      │ 둘째 │',
      '├────┼────┤',
      '│ 영희 │ 하나 │',
      '└────┴────┘',
    ].join('\n')
    expect(parsePastedTable(text)).toEqual({
      kind: 'box',
      header: ['이름', '메모'],
      rows: [
        ['철수', '첫줄\n둘째'],
        ['영희', '하나'],
      ],
    })
  })

  it('ASCII +---+ 표', () => {
    const text = ['+-----+-----+', '| a   | b   |', '+-----+-----+', '| 1   | 2   |', '+-----+-----+'].join('\n')
    expect(parsePastedTable(text)).toEqual({ kind: 'box', header: ['a', 'b'], rows: [['1', '2']] })
  })

  it('열 수가 맞지 않는 박스 줄이 있으면 null', () => {
    const text = ['┌──┬──┐', '│ a │ b │', '│ 1 │', '└──┴──┘'].join('\n')
    expect(parsePastedTable(text)).toBeNull()
  })

  it('닫히지 않은 박스(마지막이 내용 줄)면 null', () => {
    const text = ['┌──┬──┐', '│ a │ b │', '│ 1 │ 2 │'].join('\n')
    expect(parsePastedTable(text)).toBeNull()
  })
})

describe('parsePastedTable - 마크다운 불릿 레코드', () => {
  it('레코드 여러 개를 열 합집합으로 만든다, 없는 값은 빈 문자열', () => {
    const text = [
      '- 이름: 철수',
      '  나이: 30',
      '- 이름: 영희',
      '  도시: 서울',
    ].join('\n')
    expect(parsePastedTable(text)).toEqual({
      kind: 'mdlist',
      header: ['이름', '나이', '도시'],
      rows: [
        ['철수', '30', ''],
        ['영희', '', '서울'],
      ],
    })
  })

  it('값에 콜론이 있어도 첫 ": " 에서만 분리한다', () => {
    const text = '- 시간: 10:30:00\n- 시간: 11:00 (주소: 강남)'
    expect(parsePastedTable(text)).toEqual({
      kind: 'mdlist',
      header: ['시간'],
      rows: [['10:30:00'], ['11:00 (주소: 강남)']],
    })
  })

  it('레코드가 하나뿐이면 null', () => {
    expect(parsePastedTable('- 이름: 철수\n  나이: 30')).toBeNull()
  })

  it('일반 불릿 목록 문장은 null', () => {
    expect(parsePastedTable('- 사과를 산다\n- 바나나를 먹는다')).toBeNull()
  })

  it('키-값이 아닌 줄이 하나라도 섞이면 null', () => {
    expect(parsePastedTable('- 이름: 철수\n  메모 없는 줄\n- 이름: 영희')).toBeNull()
  })
})

describe('parsePastedTable - JSON', () => {
  it('객체 배열은 키 합집합 순서로 표가 되고, 중첩 값은 JSON 문자열', () => {
    const text = JSON.stringify([
      { id: 1, name: 'a', tags: ['x', 'y'] },
      { id: 2, meta: { k: 1 }, ok: true, memo: null },
    ])
    expect(parsePastedTable(text)).toEqual({
      kind: 'json',
      header: ['id', 'name', 'tags', 'meta', 'ok', 'memo'],
      rows: [
        ['1', 'a', '["x","y"]', '', '', ''],
        ['2', '', '', '{"k":1}', 'true', ''],
      ],
    })
  })

  it('배열의 배열은 첫 행을 header 로', () => {
    expect(parsePastedTable('[["a","b"],[1,2]]')).toEqual({
      kind: 'json',
      header: ['a', 'b'],
      rows: [['1', '2']],
    })
  })

  it('객체 하나처럼 표가 아닌 JSON 은 null', () => {
    expect(parsePastedTable('{"a": 1, "b": 2}')).toBeNull()
  })

  it('원시값 배열 같은 표가 아닌 JSON 은 null (구분자 규칙으로 넘기지 않음)', () => {
    expect(parsePastedTable('[1,2,3]')).toBeNull()
    expect(parsePastedTable('{\n  "a": 1,\n  "b": 2\n}')).toBeNull()
  })

  it('JSON 문법이 깨진 배열/객체 모양이면 구분자 규칙으로 표를 만들지 않는다', () => {
    expect(parsePastedTable('[1,2\n3,4]')).toBeNull()
  })
})

describe('parsePastedTable - 구분자 텍스트', () => {
  it('콤마 CSV: 첫 행을 header 로', () => {
    expect(parsePastedTable('name,age\n철수,30\n영희,25')).toEqual({
      kind: 'delimited',
      header: ['name', 'age'],
      rows: [
        ['철수', '30'],
        ['영희', '25'],
      ],
    })
  })

  it('탭(스프레드시트 복사), CRLF, BOM, 앞뒤 공백 줄', () => {
    const text = '﻿\r\n\r\nname\tage\r\n철수\t30\r\n\r\n'
    expect(parsePastedTable(text)).toEqual({
      kind: 'delimited',
      header: ['name', 'age'],
      rows: [['철수', '30']],
    })
  })

  it('탭이 있으면 콤마보다 탭을 우선한다', () => {
    const text = 'a,x\tb\n1,y\t2'
    expect(parsePastedTable(text)).toEqual({
      kind: 'delimited',
      header: ['a,x', 'b'],
      rows: [['1,y', '2']],
    })
  })

  it('세미콜론과 파이프 구분자', () => {
    expect(parsePastedTable('a;b;c\n1;2;3')?.header).toEqual(['a', 'b', 'c'])
    expect(parsePastedTable('a|b\n1|2')?.rows).toEqual([['1', '2']])
  })

  it('인용된 셀 안의 개행과 구분자', () => {
    expect(parsePastedTable('a,b\n"x, y","line1\nline2"')).toEqual({
      kind: 'delimited',
      header: ['a', 'b'],
      rows: [['x, y', 'line1\nline2']],
    })
  })

  it('숫자만 있는 표는 헤더 없이 A,B 열 이름을 쓴다', () => {
    const t = parsePastedTable('1,2\n3,4')
    expect(t?.kind).toBe('delimited')
    expect(t?.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('행 하나뿐이면 null', () => {
    expect(parsePastedTable('a,b,c')).toBeNull()
  })

  it('콤마 하나뿐인 텍스트(문장)는 null', () => {
    expect(parsePastedTable('안녕하세요, 반갑습니다')).toBeNull()
  })

  it('열 수가 들쭉날쭉하면 null', () => {
    expect(parsePastedTable('a,b,c\n1,2\n3')).toBeNull()
    expect(parsePastedTable('a\tb\n1\t2\t3')).toBeNull()
  })

  it('구분자가 없는 일반 문장은 null', () => {
    expect(parsePastedTable('첫 문장입니다.\n둘째 문장입니다.')).toBeNull()
  })

  it('모든 칸이 비어 있는 표는 null', () => {
    expect(parsePastedTable(',\n,')).toBeNull()
  })
})

describe('parsePastedTable - 기타', () => {
  it('빈 문자열과 공백만 있는 입력은 null', () => {
    expect(parsePastedTable('')).toBeNull()
    expect(parsePastedTable('  \n\r\n  ')).toBeNull()
  })

  it('큰 입력(약 5만 행)도 선형으로 처리한다', () => {
    const lines = ['id,name,value']
    for (let i = 0; i < 50_000; i++) lines.push(`${i},n${i},${i * 2}`)
    const t = parsePastedTable(lines.join('\n'))
    expect(t?.kind).toBe('delimited')
    expect(t?.header).toEqual(['id', 'name', 'value'])
    expect(t?.rows.length).toBe(50_000)
    expect(t?.rows[49_999]).toEqual(['49999', 'n49999', '99998'])
  })
})

describe('parsePastedTable - 헤더 선언형 불릿 목록', () => {
  it('첫 항목의 열 이름과 들여쓰기 깊이로 행·열을 가른다', () => {
    const text = ['- 헤더: 이름, 나이, 부서', '- 홍길동', '  - 30', '  - 영업', '- 김철수', '  - 25', '  - 개발'].join('\n')
    expect(parsePastedTable(text)).toEqual({
      kind: 'mdlist',
      header: ['이름', '나이', '부서'],
      rows: [
        ['홍길동', '30', '영업'],
        ['김철수', '25', '개발'],
      ],
    })
  })

  it('칸이 모자라면 빈 칸으로 채우고, 빈 항목은 빈 값이다', () => {
    const text = ['- header: a, b, c', '- 1', '  - 2', '- 3', '  -', '  - 5'].join('\r\n')
    expect(parsePastedTable(text)?.rows).toEqual([
      ['1', '2', ''],
      ['3', '', '5'],
    ])
  })

  it('칸이 헤더보다 많거나 들여쓴 항목이 먼저 나오면 인식하지 않는다', () => {
    expect(parsePastedTable(['- 헤더: a, b', '- 1', '  - 2', '  - 3'].join('\n'))).toBeNull()
    expect(parsePastedTable(['- 헤더: a, b', '  - 1', '- 2'].join('\n'))).toBeNull()
  })

  it('레코드형(이름: 값) 목록은 그대로 레코드형으로 읽는다', () => {
    const t = parsePastedTable(['- 이름: 가', '  나이: 1', '- 이름: 나', '  나이: 2'].join('\n'))
    expect(t?.header).toEqual(['이름', '나이'])
  })
})
