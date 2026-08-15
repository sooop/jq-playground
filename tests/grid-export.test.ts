import { describe, it, expect } from 'vitest';
import { buildMatrix } from '../src/core/grid/export';
import { SelectionStore } from '../src/core/grid/selection';
import { View } from '../src/core/grid/view';

function makeView(): View {
  const view = new View();
  view.setData({
    header: ['a', 'b', 'c'],
    rows: [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
    ],
  });
  return view;
}

describe('buildMatrix', () => {
  it('scope=all은 헤더 + 원본 전체를 반환한다', () => {
    const view = makeView();
    const sel = new SelectionStore();
    expect(buildMatrix(view, sel, 'all')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
    ]);
  });

  it('scope=view는 필터/정렬/숨김이 반영된 화면 그대로를 반환한다', () => {
    const view = makeView();
    view.hideCols([1]); // 'b' 숨김
    const sel = new SelectionStore();
    expect(buildMatrix(view, sel, 'view')).toEqual([
      ['a', 'c'],
      ['1', '3'],
      ['4', '6'],
      ['7', '9'],
    ]);
  });

  it('scope=selection은 단일 범위만 잘라 반환한다', () => {
    const view = makeView();
    const sel = new SelectionStore();
    sel.selectCell(0, 0);
    sel.extendTo(1, 1);
    expect(buildMatrix(view, sel, 'selection')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['4', '5'],
    ]);
  });

  it('scope=selection은 다중 범위를 바운딩 박스로 감싸고 비선택 셀은 비운다', () => {
    const view = makeView();
    const sel = new SelectionStore();
    sel.selectCell(0, 0); // (0,0)
    sel.beginDrag(2, 2, true); // 추가 범위: (2,2)
    sel.updateDrag(2, 2);
    sel.endDrag();

    const matrix = buildMatrix(view, sel, 'selection');
    // 바운딩 박스는 (0,0)~(2,2) 전체이지만 실제 선택은 (0,0)과 (2,2)뿐
    expect(matrix).toEqual([
      ['a', 'b', 'c'],
      ['1', '', ''],
      ['', '', ''],
      ['', '', '9'],
    ]);
  });

  it('scope=selection에서 선택이 비어 있으면 빈 배열을 반환한다', () => {
    const view = makeView();
    const sel = new SelectionStore();
    expect(buildMatrix(view, sel, 'selection')).toEqual([]);
  });
});
