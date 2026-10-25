import { describe, it, expect } from 'vitest';
import { jsonToMatrix, matrixToCSV, jsonToCSV } from '../src/modes/jq/core/csv-converter';

describe('jsonToMatrix', () => {
  it('배열의 키 합집합을 정렬된 헤더로 만든다', () => {
    const { header, rows } = jsonToMatrix([{ b: 1, a: 2 }, { a: 3, c: 4 }]);
    expect(header).toEqual(['a', 'b', 'c']);
    expect(rows).toEqual([
      ['2', '1', ''],
      ['3', '', '4'],
    ]);
  });

  it('배열이 아닌 값은 단일 행으로 감싼다', () => {
    const { header, rows } = jsonToMatrix({ x: 1, y: 2 });
    expect(header).toEqual(['x', 'y']);
    expect(rows).toEqual([['1', '2']]);
  });

  it('빈 배열은 빈 매트릭스를 반환한다', () => {
    expect(jsonToMatrix([])).toEqual({ header: [], rows: [] });
  });

  it('중첩 객체를 언더스코어로 평탄화한다', () => {
    const { header, rows } = jsonToMatrix([{ a: { b: 1, c: 2 } }]);
    expect(header).toEqual(['a_b', 'a_c']);
    expect(rows).toEqual([['1', '2']]);
  });

  it('배열 값은 JSON 문자열로 직렬화한다', () => {
    const { header, rows } = jsonToMatrix([{ a: [1, 2, 3] }]);
    expect(header).toEqual(['a']);
    expect(rows).toEqual([['[1,2,3]']]);
  });

  it('null/undefined는 빈 문자열로 취급한다', () => {
    const { rows } = jsonToMatrix([{ a: null, b: undefined }]);
    expect(rows).toEqual([['', '']]);
  });

  it('행 수 제한이 없다 (가상 스크롤이 담당)', () => {
    const data = Array.from({ length: 5000 }, (_, i) => ({ i }));
    const { rows } = jsonToMatrix(data);
    expect(rows.length).toBe(5000);
  });
});

describe('matrixToCSV', () => {
  it('RFC-4180 규칙으로 쉼표/따옴표/개행을 인용한다', () => {
    const csv = matrixToCSV(['a', 'b'], [['x,y', 'he said "hi"'], ['line1\nline2', 'plain']]);
    expect(csv).toBe('a,b\n"x,y","he said ""hi"""\n"line1\nline2",plain\n');
  });

  it('헤더가 없으면 빈 문자열을 반환한다', () => {
    expect(matrixToCSV([], [])).toBe('');
  });
});

describe('jsonToCSV', () => {
  it('jsonToMatrix + matrixToCSV의 합성과 동일하다', () => {
    const data = [{ a: 1, b: 'x,y' }];
    expect(jsonToCSV(data)).toBe(matrixToCSV(...Object.values(jsonToMatrix(data)) as [string[], string[][]]));
  });
});
