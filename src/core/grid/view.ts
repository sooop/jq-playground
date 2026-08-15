import { compileColumnFilters } from './column-filter';
import type { ColumnFilter } from './column-filter';
import { detectColTypes } from './coltype';
import type { ColType } from './coltype';
import { sortIndices } from './sort';
import type { SortSpec } from './sort';

export interface Matrix {
  header: string[];
  rows: string[][];
}

/** 0..n-1 인덱스 배열. 필터가 없을 때 쓰는 항등 매핑. */
function identity(n: number): Uint32Array {
  const a = new Uint32Array(n);
  for (let i = 0; i < n; i++) a[i] = i;
  return a;
}

const DEFAULT_COL_WIDTH = 120;

/**
 * 뷰 파이프라인: `rows` → 칼럼 필터 → 정렬 → `viewRows`.
 *
 * xsv-playground의 `$derived` 체인을 명시적 `recompute()` 호출로 바꾼 버전.
 * 원본 데이터는 절대 건드리지 않고 `Uint32Array` 인덱스 배열만 만든다.
 * 편집·실행취소가 없는 읽기 전용 뷰이므로 Dataset/History 계층은 두지 않는다.
 */
export class View {
  header: string[] = [];
  rows: string[][] = [];

  colOrder: number[] = [];
  colWidths: number[] = [];
  colTypes: ColType[] = [];

  sorts: SortSpec[] = [];
  /** source 칼럼 인덱스 → 필터 */
  columnFilters: Map<number, ColumnFilter> = new Map();
  /** 숨긴 칼럼 (source 인덱스) */
  hiddenCols: Set<number> = new Set();

  viewCols: number[] = [];
  viewRows: Uint32Array = new Uint32Array(0);

  onChange: (() => void) | null = null;

  setData(matrix: Matrix): void {
    this.header = matrix.header;
    this.rows = matrix.rows;
    this.colOrder = matrix.header.map((_, i) => i);
    this.colWidths = matrix.header.map(() => DEFAULT_COL_WIDTH);
    this.colTypes = detectColTypes(matrix.header, matrix.rows);
    this.sorts = [];
    this.columnFilters = new Map();
    this.hiddenCols = new Set();
    this.recompute();
  }

  get colCount(): number {
    return this.header.length;
  }

  /** 뷰 행 인덱스 → source 행 인덱스 */
  srcRow(viewRow: number): number {
    return this.viewRows[viewRow] ?? 0;
  }

  /** 뷰 칼럼 인덱스 → source 칼럼 인덱스 */
  srcCol(viewCol: number): number {
    return this.viewCols[viewCol] ?? 0;
  }

  cell(viewRow: number, viewCol: number): string {
    const src = this.viewRows[viewRow];
    if (src === undefined) return '';
    return this.rows[src]?.[this.srcCol(viewCol)] ?? '';
  }

  setColWidth(srcCol: number, width: number): void {
    this.colWidths[srcCol] = Math.max(40, width);
    this.onChange?.();
  }

  autoWidth(srcCol: number, sampleLimit = 500): void {
    const label = this.header[srcCol] ?? '';
    let maxLen = label.length;
    const step = Math.max(1, Math.floor(this.rows.length / sampleLimit));
    for (let i = 0; i < this.rows.length; i += step) {
      const v = this.rows[i][srcCol];
      if (v && v.length > maxLen) maxLen = v.length;
    }
    this.setColWidth(srcCol, Math.min(400, Math.max(60, maxLen * 7 + 24)));
  }

  sortStateOf(col: number): { dir: 'asc' | 'desc'; rank: number } | null {
    const at = this.sorts.findIndex(s => s.col === col);
    return at < 0 ? null : { dir: this.sorts[at].dir, rank: at + 1 };
  }

  setSorts(sorts: SortSpec[]): void {
    this.sorts = sorts;
    this.recompute();
  }

  getColumnFilter(col: number): ColumnFilter | undefined {
    return this.columnFilters.get(col);
  }

  setColumnFilter(col: number, f: ColumnFilter | null): void {
    const next = new Map(this.columnFilters);
    if (f === null) next.delete(col);
    else next.set(col, f);
    this.columnFilters = next;
    this.recompute();
  }

  get activeColumnFilterCount(): number {
    return this.columnFilters.size;
  }

  /**
   * 칼럼 숨기기. 모든 칼럼을 숨기려 하면 아무것도 하지 않는다(빈 화면 방지).
   * `colOrder`는 숨김과 무관한 전체 순서를 유지하므로, 숨김을 풀면 원래 자리로 돌아온다.
   */
  hideCols(srcCols: readonly number[]): boolean {
    const next = new Set(this.hiddenCols);
    for (const c of srcCols) next.add(c);
    if (next.size >= this.colCount) return false;
    this.hiddenCols = next;
    this.recompute();
    return true;
  }

  showCol(srcCol: number): void {
    const next = new Set(this.hiddenCols);
    next.delete(srcCol);
    this.hiddenCols = next;
    this.recompute();
  }

  showAllCols(): void {
    this.hiddenCols = new Set();
    this.recompute();
  }

  get hiddenColCount(): number {
    return this.hiddenCols.size;
  }

  setColOrder(order: number[]): void {
    this.colOrder = order;
    this.recompute();
  }

  /** 뷰 파이프라인 재계산. 칼럼/행 필터·정렬·숨김이 바뀌면 항상 호출한다. */
  recompute(): void {
    this.viewCols = this.hiddenCols.size === 0
      ? this.colOrder
      : this.colOrder.filter(c => !this.hiddenCols.has(c));

    const compiled = compileColumnFilters(this.columnFilters, this.colTypes);
    let filtered: Uint32Array;
    if (compiled.length === 0) {
      filtered = identity(this.rows.length);
    } else {
      const out = new Uint32Array(this.rows.length);
      let n = 0;
      for (let i = 0; i < this.rows.length; i++) {
        const row = this.rows[i];
        let ok = true;
        for (let f = 0; f < compiled.length; f++) {
          if (!compiled[f].test(row[compiled[f].col] ?? '')) {
            ok = false;
            break;
          }
        }
        if (ok) out[n++] = i;
      }
      filtered = out.subarray(0, n);
    }

    let sorted = filtered;
    if (this.sorts.length > 0) {
      sorted = new Uint32Array(filtered);
      sortIndices(sorted, this.rows, this.sorts, this.colTypes);
    }
    this.viewRows = sorted;
    this.onChange?.();
  }
}
