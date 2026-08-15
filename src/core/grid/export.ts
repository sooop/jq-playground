import { boundingBox } from './selection';
import type { SelectionStore } from './selection';
import type { View } from './view';

export type ExportScope = 'selection' | 'view' | 'all';

function isSelected(sel: SelectionStore, r: number, c: number): boolean {
  for (const rg of sel.ranges) {
    if (r >= rg.r0 && r <= rg.r1 && c >= rg.c0 && c <= rg.c1) return true;
  }
  return false;
}

/**
 * 내보낼 2차원 배열을 만든다 (헤더 행 포함).
 *
 * - `all`: 필터·정렬을 무시한 원본 전체, 현재 화면 칼럼 순서 적용
 * - `view`: 화면에 보이는 대로 (필터 + 정렬 + 칼럼 순서 + 숨김 제외)
 * - `selection`: 선택 영역만. 다중 범위는 합집합의 바운딩 사각형을 쓰고,
 *   선택되지 않은 셀은 빈 값으로 둔다.
 */
export function buildMatrix(
  view: View,
  sel: SelectionStore,
  scope: ExportScope
): string[][] {
  const cols = view.viewCols;

  if (scope === 'selection') {
    const box = boundingBox(sel.ranges);
    if (!box) return [];

    const c0 = Math.max(0, box.c0);
    const c1 = Math.min(cols.length - 1, box.c1);

    const out: string[][] = [];
    const header: string[] = [];
    for (let c = c0; c <= c1; c++) header.push(view.header[cols[c]] ?? '');
    out.push(header);

    for (let r = box.r0; r <= box.r1; r++) {
      const src = view.viewRows[r];
      if (src === undefined) continue;
      const row = view.rows[src];
      const line: string[] = [];
      for (let c = c0; c <= c1; c++) {
        line.push(isSelected(sel, r, c) ? row?.[cols[c]] ?? '' : '');
      }
      out.push(line);
    }
    return out;
  }

  const out: string[][] = [cols.map(c => view.header[c] ?? '')];
  if (scope === 'all') {
    for (const row of view.rows) out.push(cols.map(c => row[c] ?? ''));
  } else {
    const idx = view.viewRows;
    for (let i = 0; i < idx.length; i++) {
      const row = view.rows[idx[i]];
      out.push(cols.map(c => row?.[c] ?? ''));
    }
  }
  return out;
}
