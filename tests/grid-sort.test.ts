import { describe, it, expect } from 'vitest';
import { sortIndices, toggleSort } from '../src/core/grid/sort';

describe('toggleSort', () => {
  it('일반 클릭: 없음 → asc → desc → 해제', () => {
    let specs = toggleSort([], 0, false);
    expect(specs).toEqual([{ col: 0, dir: 'asc' }]);

    specs = toggleSort(specs, 0, false);
    expect(specs).toEqual([{ col: 0, dir: 'desc' }]);

    specs = toggleSort(specs, 0, false);
    expect(specs).toEqual([]);
  });

  it('일반 클릭은 다른 칼럼의 정렬을 모두 대체한다', () => {
    const specs = toggleSort([{ col: 5, dir: 'asc' }], 0, false);
    expect(specs).toEqual([{ col: 0, dir: 'asc' }]);
  });

  it('Shift 클릭은 다중 정렬에 추가/순환한다', () => {
    let specs = toggleSort([{ col: 0, dir: 'asc' }], 1, true);
    expect(specs).toEqual([{ col: 0, dir: 'asc' }, { col: 1, dir: 'asc' }]);

    specs = toggleSort(specs, 1, true);
    expect(specs).toEqual([{ col: 0, dir: 'asc' }, { col: 1, dir: 'desc' }]);

    specs = toggleSort(specs, 1, true);
    expect(specs).toEqual([{ col: 0, dir: 'asc' }]);
  });
});

describe('sortIndices', () => {
  it('숫자 칼럼을 오름차순 정렬한다', () => {
    const rows = [['3'], ['1'], ['2']];
    const idx = Uint32Array.from([0, 1, 2]);
    sortIndices(idx, rows, [{ col: 0, dir: 'asc' }], ['number']);
    expect(Array.from(idx)).toEqual([1, 2, 0]);
  });

  it('내림차순 정렬한다', () => {
    const rows = [['3'], ['1'], ['2']];
    const idx = Uint32Array.from([0, 1, 2]);
    sortIndices(idx, rows, [{ col: 0, dir: 'desc' }], ['number']);
    expect(Array.from(idx)).toEqual([0, 2, 1]);
  });

  it('빈 값은 방향과 무관하게 항상 끝으로 보낸다', () => {
    const rows = [['3'], [''], ['1']];
    const asc = Uint32Array.from([0, 1, 2]);
    sortIndices(asc, rows, [{ col: 0, dir: 'asc' }], ['number']);
    expect(Array.from(asc)).toEqual([2, 0, 1]);

    const desc = Uint32Array.from([0, 1, 2]);
    sortIndices(desc, rows, [{ col: 0, dir: 'desc' }], ['number']);
    expect(Array.from(desc)).toEqual([0, 2, 1]);
  });

  it('다중 정렬은 앞선 칼럼을 우선한다', () => {
    const rows = [
      ['a', '2'],
      ['a', '1'],
      ['b', '1'],
    ];
    const idx = Uint32Array.from([0, 1, 2]);
    sortIndices(
      idx,
      rows,
      [{ col: 0, dir: 'asc' }, { col: 1, dir: 'asc' }],
      ['string', 'number']
    );
    expect(Array.from(idx)).toEqual([1, 0, 2]);
  });

  it('동률은 안정 정렬로 원래 순서를 유지한다', () => {
    const rows = [['1'], ['1'], ['1']];
    const idx = Uint32Array.from([0, 1, 2]);
    sortIndices(idx, rows, [{ col: 0, dir: 'asc' }], ['number']);
    expect(Array.from(idx)).toEqual([0, 1, 2]);
  });

  it('문자열은 자연 정렬(숫자 인식)을 쓴다', () => {
    const rows = [['item10'], ['item2'], ['item1']];
    const idx = Uint32Array.from([0, 1, 2]);
    sortIndices(idx, rows, [{ col: 0, dir: 'asc' }], ['string']);
    expect(Array.from(idx).map(i => rows[i][0])).toEqual(['item1', 'item2', 'item10']);
  });
});
