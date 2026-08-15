import { describe, it, expect } from 'vitest';
import { SelectionStore, boundingBox, contains, normalize } from '../src/core/grid/selection';

describe('SelectionStore', () => {
  it('selectCell은 단일 셀 범위를 만든다', () => {
    const sel = new SelectionStore();
    sel.selectCell(2, 3);
    expect(sel.ranges).toEqual([{ r0: 2, r1: 2, c0: 3, c1: 3, kind: 'cell' }]);
    expect(sel.active).toEqual({ r: 2, c: 3 });
  });

  it('extendTo는 anchor에서 마지막 범위를 확장한다', () => {
    const sel = new SelectionStore();
    sel.selectCell(1, 1);
    sel.extendTo(3, 4);
    expect(sel.ranges).toEqual([{ r0: 1, r1: 3, c0: 1, c1: 4, kind: 'cell' }]);
  });

  it('beginDrag(additive)는 새 범위를 추가한다', () => {
    const sel = new SelectionStore();
    sel.selectCell(0, 0);
    sel.beginDrag(5, 5, true);
    expect(sel.ranges.length).toBe(2);
    sel.updateDrag(6, 7);
    expect(sel.ranges[1]).toEqual({ r0: 5, r1: 6, c0: 5, c1: 7, kind: 'cell' });
  });

  it('selectRows/selectCols는 행/열 전체 범위를 만든다', () => {
    const sel = new SelectionStore();
    sel.selectRows(1, 3, 9, 'set');
    expect(sel.ranges).toEqual([{ r0: 1, r1: 3, c0: 0, c1: 9, kind: 'row' }]);
    expect(sel.isRowFullySelected(2, 9)).toBe(true);
    expect(sel.isRowFullySelected(4, 9)).toBe(false);

    sel.selectCols(2, 2, 9, 'set');
    expect(sel.isColFullySelected(2, 9)).toBe(true);
  });

  it('clampTo는 범위를 축소된 뷰 크기로 자른다', () => {
    const sel = new SelectionStore();
    sel.selectCell(0, 0);
    sel.extendTo(9, 9);
    sel.clampTo(5, 5);
    expect(sel.ranges).toEqual([{ r0: 0, r1: 4, c0: 0, c1: 4, kind: 'cell' }]);
  });

  it('clampTo(0, n)은 선택을 완전히 비운다', () => {
    const sel = new SelectionStore();
    sel.selectCell(0, 0);
    sel.clampTo(0, 5);
    expect(sel.ranges).toEqual([]);
  });

  it('remapCols는 열 범위만 재매핑하고 나머지는 버린다', () => {
    const sel = new SelectionStore();
    sel.selectCols(2, 2, 9, 'set');
    sel.selectCell(1, 1); // 셀 범위는 remapCols가 버린다
    sel.selectCols(2, 2, 9, 'set');
    sel.remapCols([0, 1, 5, 3, 4]); // 이전 열 2 → 새 열 5
    expect(sel.ranges).toEqual([{ r0: 0, r1: 9, c0: 5, c1: 5, kind: 'col' }]);
  });

  it('onChange 콜백이 변경 시마다 호출된다', () => {
    const sel = new SelectionStore();
    let calls = 0;
    sel.onChange = () => calls++;
    sel.selectCell(0, 0);
    sel.extendTo(1, 1);
    sel.clear();
    expect(calls).toBe(3);
  });
});

describe('boundingBox', () => {
  it('여러 범위를 감싸는 최소 사각형을 만든다', () => {
    const box = boundingBox([
      { r0: 0, r1: 1, c0: 0, c1: 1, kind: 'cell' },
      { r0: 3, r1: 4, c0: 2, c1: 5, kind: 'cell' },
    ]);
    expect(box).toEqual({ r0: 0, r1: 4, c0: 0, c1: 5, kind: 'cell' });
  });

  it('빈 배열은 null을 반환한다', () => {
    expect(boundingBox([])).toBeNull();
  });
});

describe('contains / normalize', () => {
  it('정규화되지 않은 범위를 정렬한다', () => {
    expect(normalize({ r0: 5, r1: 1, c0: 3, c1: 0, kind: 'cell' })).toEqual({
      r0: 1, r1: 5, c0: 0, c1: 3, kind: 'cell',
    });
  });

  it('contains는 경계 포함 여부를 검사한다', () => {
    const r = { r0: 1, r1: 3, c0: 1, c1: 3, kind: 'cell' as const };
    expect(contains(r, 1, 1)).toBe(true);
    expect(contains(r, 3, 3)).toBe(true);
    expect(contains(r, 0, 1)).toBe(false);
  });
});
