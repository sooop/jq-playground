import { matrixToCSV } from '../core/csv-converter';
import { openColumnFilterMenu } from './ColumnFilterMenu';
import { compileColumnFilters, uniqueValues } from '../core/grid/column-filter';
import { openColumnManager } from './ColumnManager';
import type { ColumnManagerColumn, ColumnManagerHandle } from './ColumnManager';
import { writeTable } from '../core/grid/clipboard';
import { buildMatrix } from '../core/grid/export';
import type { ExportScope } from '../core/grid/export';
import { SelectionStore } from '../core/grid/selection';
import { toggleSort } from '../core/grid/sort';
import { View } from '../core/grid/view';
import type { Matrix } from '../core/grid/view';
import { buildOffsets, columnAt } from '../utils/prefix-sum';
import type { ComponentElement } from '../types';

const ROW_H = 24;
const OVERSCAN_R = 6;
const OVERSCAN_C = 2;
/** 헤더 우변에서 리사이즈 핸들로 인식하는 폭 */
const RESIZE_ZONE = 5;
/** 클릭과 드래그를 가르는 이동 거리 */
const DRAG_THRESHOLD = 4;
/** 찾기 매치 상한 — 초과분은 truncated로 알린다 */
const FIND_CAP = 20000;

export interface DataGridApi {
  setData(data: Matrix): void;
  clear(): void;
  copySelection(): Promise<void>;
  getCSV(scope?: ExportScope): string;
  find(query: string): { total: number; truncated: boolean };
  nextMatch(): void;
  prevMatch(): void;
  getMatchInfo(): { current: number; total: number };
  getStats(): { rows: number; totalRows: number; cols: number; hidden: number; filtered: number };
  /** 정렬/숨김/필터 등 그리드 내부 조작으로 통계가 바뀔 때마다 호출된다. */
  setOnStatsChange(cb: (() => void) | null): void;
  openColumnManager(anchor: HTMLElement): void;
  relayout(): void;
  destroy(): void;
}

interface RowEntry {
  row: HTMLElement;
  cells: HTMLElement[];
}

type HeadDrag =
  | { kind: 'resize'; viewCol: number; startX: number; startW: number }
  | { kind: 'maybe'; viewCol: number; startX: number; shift: boolean; ctrl: boolean }
  | { kind: 'reorder'; viewCol: number };

export function createDataGrid() {
  const root = document.createElement('div');
  root.className = 'dgrid';
  root.tabIndex = 0;
  root.setAttribute('role', 'grid');

  root.innerHTML = `
    <button type="button" class="dgrid-corner" title="전체 선택 (Ctrl+A)"><span class="dgrid-corner-mark"></span></button>
    <div class="dgrid-head"><div class="dgrid-head-track"></div></div>
    <div class="dgrid-gutter"><div class="dgrid-gutter-track"></div></div>
    <div class="dgrid-body"><div class="dgrid-canvas"></div></div>
    <div class="dgrid-empty">표시할 데이터가 없습니다</div>
  `;

  const corner = root.querySelector<HTMLButtonElement>('.dgrid-corner')!;
  const headClip = root.querySelector<HTMLElement>('.dgrid-head')!;
  const headTrack = root.querySelector<HTMLElement>('.dgrid-head-track')!;
  const gutClip = root.querySelector<HTMLElement>('.dgrid-gutter')!;
  const gutTrack = root.querySelector<HTMLElement>('.dgrid-gutter-track')!;
  const body = root.querySelector<HTMLElement>('.dgrid-body')!;
  const canvas = root.querySelector<HTMLElement>('.dgrid-canvas')!;
  const emptyEl = root.querySelector<HTMLElement>('.dgrid-empty')!;

  const view = new View();
  const sel = new SelectionStore();

  let widths: number[] = [];
  let offsets: Float64Array = new Float64Array([0]);
  let totalW = 0;
  let totalH = 0;

  let scrollTop = 0;
  let scrollLeft = 0;
  let viewportH = 0;
  let viewportW = 0;

  let lastColWindowKey = '';
  let renderScheduled = false;

  const rowPool = new Map<number, RowEntry>();
  const gutPool = new Map<number, HTMLElement>();
  let headerCells: HTMLElement[] = [];

  let findMatches: { r: number; c: number }[] = [];
  let findSet = new Set<string>();
  let findIndex = -1;

  let colMenuHandle: ColumnManagerHandle | null = null;
  let onStatsChange: (() => void) | null = null;

  // ───────────────────────── 지오메트리 ─────────────────────────

  function computeGeometry(): void {
    widths = view.viewCols.map(c => view.colWidths[c] ?? 120);
    offsets = buildOffsets(widths);
    totalW = offsets[offsets.length - 1] ?? 0;
    totalH = view.viewRows.length * ROW_H;
    canvas.style.width = totalW + 'px';
    canvas.style.height = totalH + 'px';
    headTrack.style.width = totalW + 'px';
    gutTrack.style.height = totalH + 'px';
  }

  function clearPools(): void {
    for (const [, entry] of rowPool) entry.row.remove();
    rowPool.clear();
    for (const [, g] of gutPool) g.remove();
    gutPool.clear();
  }

  function fullRelayout(): void {
    computeGeometry();
    clearPools();
    lastColWindowKey = '';
    renderHeader();
    renderWindow();
    const rowCount = view.viewRows.length;
    const colCount = view.viewCols.length;
    root.setAttribute('aria-rowcount', String(rowCount));
    root.setAttribute('aria-colcount', String(colCount));
    emptyEl.classList.toggle('show', rowCount === 0 || colCount === 0);
    onStatsChange?.();
  }

  function scheduleRender(): void {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      renderWindow();
    });
  }

  // ───────────────────────── 헤더 렌더링 ─────────────────────────

  function renderHeader(): void {
    headTrack.innerHTML = '';
    headerCells = [];
    const rowCount = view.viewRows.length;

    view.viewCols.forEach((srcCol, viewCol) => {
      const th = document.createElement('div');
      th.className = 'dgrid-th';
      th.setAttribute('role', 'columnheader');
      th.style.left = (offsets[viewCol] ?? 0) + 'px';
      th.style.width = (widths[viewCol] ?? 0) + 'px';
      th.title = view.header[srcCol] ?? '';

      const type = view.colTypes[srcCol] ?? 'string';
      if (type !== 'string') {
        const glyph = document.createElement('span');
        glyph.className = 'dgrid-th-glyph';
        glyph.dataset.type = type;
        glyph.textContent = type === 'number' ? '#' : '◷';
        th.appendChild(glyph);
      }

      const name = document.createElement('span');
      name.className = 'dgrid-th-name';
      name.textContent = view.header[srcCol] ?? '';
      th.appendChild(name);

      const st = view.sortStateOf(srcCol);
      const sortBtn = document.createElement('button');
      sortBtn.type = 'button';
      sortBtn.className = 'dgrid-th-btn dgrid-th-sort' + (st ? ' on' : '');
      sortBtn.title = st
        ? `정렬 ${st.dir === 'asc' ? '오름차순' : '내림차순'} — 클릭하면 ${st.dir === 'asc' ? '내림차순' : '해제'}`
        : '정렬 (Shift+클릭: 다중 정렬에 추가)';
      sortBtn.innerHTML = `<svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
        <path d="M5 0.6L8 4H2z" fill="currentColor" opacity="${st ? (st.dir === 'asc' ? 1 : 0.22) : 0.55}"/>
        <path d="M5 9.4L2 6h6z" fill="currentColor" opacity="${st ? (st.dir === 'desc' ? 1 : 0.22) : 0.55}"/>
      </svg>${st && view.sorts.length > 1 ? `<i>${st.rank}</i>` : ''}`;
      sortBtn.addEventListener('pointerdown', e => e.stopPropagation());
      sortBtn.addEventListener('click', e => {
        e.stopPropagation();
        onSortToggle(srcCol, e.shiftKey);
      });
      th.appendChild(sortBtn);

      const filtered = !!view.getColumnFilter(srcCol);
      const filterBtn = document.createElement('button');
      filterBtn.type = 'button';
      filterBtn.className = 'dgrid-th-btn dgrid-th-filter' + (filtered ? ' on' : '');
      filterBtn.title = '칼럼 필터';
      filterBtn.innerHTML =
        '<svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true"><path d="M0.5 1.5h9L6 5.6V9L4 7.7V5.6z" fill="currentColor"/></svg>';
      filterBtn.addEventListener('pointerdown', e => e.stopPropagation());
      filterBtn.addEventListener('click', e => {
        e.stopPropagation();
        onOpenColumnFilter(srcCol, filterBtn);
      });
      th.appendChild(filterBtn);

      const grip = document.createElement('span');
      grip.className = 'dgrid-th-grip';
      th.appendChild(grip);

      th.classList.toggle('sel', sel.isColFullySelected(viewCol, rowCount - 1));
      th.classList.toggle('sorted', !!st);

      th.addEventListener('pointerdown', e => onHeadPointerDown(e, viewCol, th));
      th.addEventListener('pointermove', onHeadPointerMove);
      th.addEventListener('pointerup', onHeadPointerUp);
      th.addEventListener('dblclick', e => onHeadDblClick(e, viewCol, th));

      headTrack.appendChild(th);
      headerCells.push(th);
    });
  }

  function paintHeaderSelection(): void {
    const rowCount = view.viewRows.length;
    headerCells.forEach((th, viewCol) => {
      th.classList.toggle('sel', sel.isColFullySelected(viewCol, rowCount - 1));
    });
  }

  // ───────────────────────── 본문/거터 가상 스크롤 ─────────────────────────

  function buildRow(absRow: number, firstCol: number, lastCol: number): RowEntry {
    const row = document.createElement('div');
    row.className = 'dgrid-row' + (absRow % 2 === 1 ? ' odd' : '');
    row.style.top = absRow * ROW_H + 'px';

    const src = view.viewRows[absRow];
    const rowData = src !== undefined ? view.rows[src] : undefined;
    const cells: HTMLElement[] = [];

    for (let c = firstCol; c <= lastCol; c++) {
      const cell = document.createElement('div');
      cell.className = 'dgrid-cell';
      const srcCol = view.viewCols[c];
      const type = view.colTypes[srcCol] ?? 'string';
      if (type !== 'string') cell.dataset.type = type;
      cell.dataset.vc = String(c);
      cell.style.left = (offsets[c] ?? 0) + 'px';
      cell.style.width = (widths[c] ?? 0) + 'px';
      cell.textContent = rowData?.[srcCol] ?? '';
      row.appendChild(cell);
      cells.push(cell);
    }
    return { row, cells };
  }

  function renderWindow(): void {
    const rowCount = view.viewRows.length;
    const colCount = view.viewCols.length;

    if (rowCount === 0 || colCount === 0) {
      clearPools();
      return;
    }

    const firstRow = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN_R);
    const rowSlots = Math.max(
      0,
      Math.min(rowCount - firstRow, Math.ceil(viewportH / ROW_H) + OVERSCAN_R * 2)
    );
    const firstCol = Math.max(0, columnAt(offsets, scrollLeft) - OVERSCAN_C);
    const lastCol = Math.min(
      colCount - 1,
      columnAt(offsets, scrollLeft + Math.max(0, viewportW - 1)) + OVERSCAN_C
    );

    const colWindowKey = `${firstCol}:${lastCol}`;
    const colWindowChanged = colWindowKey !== lastColWindowKey;
    lastColWindowKey = colWindowKey;

    const want = new Set<number>();
    for (let i = 0; i < rowSlots; i++) want.add(firstRow + i);

    for (const [absRow, entry] of rowPool) {
      if (!want.has(absRow)) {
        entry.row.remove();
        rowPool.delete(absRow);
      }
    }
    for (const [absRow, g] of gutPool) {
      if (!want.has(absRow)) {
        g.remove();
        gutPool.delete(absRow);
      }
    }

    for (const absRow of want) {
      const entry = rowPool.get(absRow);
      if (!entry) {
        const built = buildRow(absRow, firstCol, lastCol);
        rowPool.set(absRow, built);
        canvas.appendChild(built.row);
      } else if (colWindowChanged) {
        const rebuilt = buildRow(absRow, firstCol, lastCol);
        canvas.replaceChild(rebuilt.row, entry.row);
        rowPool.set(absRow, rebuilt);
      }
      if (!gutPool.has(absRow)) {
        const g = buildGutterRow(absRow);
        gutPool.set(absRow, g);
        gutTrack.appendChild(g);
      }
    }

    paintSelection();
  }

  function buildGutterRow(absRow: number): HTMLElement {
    const g = document.createElement('div');
    g.className = 'dgrid-gt';
    g.setAttribute('role', 'rowheader');
    g.style.top = absRow * ROW_H + 'px';
    g.textContent = String(absRow + 1);
    g.dataset.row = String(absRow);
    g.addEventListener('pointerdown', onGutPointerDown);
    g.addEventListener('pointermove', onGutPointerMove);
    g.addEventListener('pointerup', onGutPointerUp);
    return g;
  }

  function isSel(r: number, c: number): boolean {
    const ranges = sel.ranges;
    for (let i = 0; i < ranges.length; i++) {
      const rg = ranges[i];
      if (r >= rg.r0 && r <= rg.r1 && c >= rg.c0 && c <= rg.c1) return true;
    }
    return false;
  }

  function paintSelection(): void {
    const curMatch = findIndex >= 0 ? findMatches[findIndex] : null;
    for (const [absRow, entry] of rowPool) {
      for (const cell of entry.cells) {
        const c = Number(cell.dataset.vc);
        const key = absRow + ':' + c;
        cell.classList.toggle('sel', isSel(absRow, c));
        cell.classList.toggle('active', sel.active.r === absRow && sel.active.c === c);
        cell.classList.toggle('find-hit', findSet.has(key));
        cell.classList.toggle('find-cur', !!curMatch && curMatch.r === absRow && curMatch.c === c);
      }
    }
    const colCount = view.viewCols.length;
    for (const [absRow, g] of gutPool) {
      g.classList.toggle('sel', sel.isRowFullySelected(absRow, colCount - 1));
    }
    paintHeaderSelection();
  }

  sel.onChange = () => paintSelection();

  // ───────────────────────── 스크롤 동기화 ─────────────────────────

  function onBodyScroll(): void {
    headTrack.style.transform = `translate3d(${-body.scrollLeft}px,0,0)`;
    gutTrack.style.transform = `translate3d(0,${-body.scrollTop}px,0)`;
    scrollLeft = body.scrollLeft;
    scrollTop = body.scrollTop;
    scheduleRender();
  }
  body.addEventListener('scroll', onBodyScroll);

  function forwardWheel(e: WheelEvent): void {
    e.preventDefault();
    body.scrollTop += e.deltaY;
    body.scrollLeft += e.deltaX;
    onBodyScroll();
  }
  headClip.addEventListener('wheel', forwardWheel, { passive: false });
  gutClip.addEventListener('wheel', forwardWheel, { passive: false });

  const ro = new ResizeObserver(() => {
    viewportH = body.clientHeight;
    viewportW = body.clientWidth;
    scheduleRender();
  });
  ro.observe(body);

  // ───────────────────────── 좌표 ↔ 셀 변환 ─────────────────────────

  function cellAtEvent(e: { clientX: number; clientY: number }): { r: number; c: number } | null {
    const rowCount = view.viewRows.length;
    const colCount = view.viewCols.length;
    if (rowCount === 0 || colCount === 0) return null;
    const rect = body.getBoundingClientRect();
    const x = e.clientX - rect.left + body.scrollLeft;
    const y = e.clientY - rect.top + body.scrollTop;
    const r = Math.floor(y / ROW_H);
    return {
      r: Math.max(0, Math.min(rowCount - 1, r)),
      c: columnAt(offsets, Math.max(0, Math.min(totalW - 1, x))),
    };
  }

  function rowAtClientY(clientY: number): number | null {
    const rowCount = view.viewRows.length;
    if (rowCount === 0) return null;
    const rect = body.getBoundingClientRect();
    const y = clientY - rect.top + body.scrollTop;
    return Math.max(0, Math.min(rowCount - 1, Math.floor(y / ROW_H)));
  }

  function scrollToCell(r: number, c: number): void {
    const top = r * ROW_H;
    if (top < body.scrollTop) body.scrollTop = top;
    else if (top + ROW_H > body.scrollTop + body.clientHeight)
      body.scrollTop = top + ROW_H - body.clientHeight;

    const left = offsets[c] ?? 0;
    const w = widths[c] ?? 0;
    if (left < body.scrollLeft) body.scrollLeft = left;
    else if (left + w > body.scrollLeft + body.clientWidth)
      body.scrollLeft = left + w - body.clientWidth;
    onBodyScroll();
  }

  // ───────────────────────── 본문 포인터: 범위 선택 ─────────────────────────

  let autoScrollTimer: number | null = null;
  let lastPointer = { clientX: 0, clientY: 0 };

  function stopAutoScroll(): void {
    if (autoScrollTimer !== null) {
      clearInterval(autoScrollTimer);
      autoScrollTimer = null;
    }
  }

  function startAutoScroll(): void {
    if (autoScrollTimer !== null) return;
    autoScrollTimer = window.setInterval(() => {
      if (!sel.dragging) {
        stopAutoScroll();
        return;
      }
      const rect = body.getBoundingClientRect();
      const EDGE = 36;
      const { clientX: px, clientY: py } = lastPointer;
      let dx = 0;
      let dy = 0;
      if (py < rect.top + EDGE) dy = -Math.min(28, (rect.top + EDGE - py) / 2);
      else if (py > rect.bottom - EDGE) dy = Math.min(28, (py - rect.bottom + EDGE) / 2);
      if (px < rect.left + EDGE) dx = -Math.min(28, (rect.left + EDGE - px) / 2);
      else if (px > rect.right - EDGE) dx = Math.min(28, (px - rect.right + EDGE) / 2);
      if (dx === 0 && dy === 0) return;
      body.scrollTop += dy;
      body.scrollLeft += dx;
      onBodyScroll();
      const hit = cellAtEvent(lastPointer);
      if (hit) sel.updateDrag(hit.r, hit.c);
    }, 16);
  }

  function onBodyPointerDown(e: PointerEvent): void {
    if (e.button === 2) return;
    const hit = cellAtEvent(e);
    if (!hit) return;
    root.focus();
    if (e.shiftKey) {
      sel.extendTo(hit.r, hit.c);
    } else {
      sel.beginDrag(hit.r, hit.c, e.ctrlKey || e.metaKey);
      try {
        body.setPointerCapture(e.pointerId);
      } catch {
        /* 무시 */
      }
      startAutoScroll();
    }
    e.preventDefault();
  }

  function onBodyPointerMove(e: PointerEvent): void {
    lastPointer = { clientX: e.clientX, clientY: e.clientY };
    if (!sel.dragging) return;
    const hit = cellAtEvent(e);
    if (hit) sel.updateDrag(hit.r, hit.c);
  }

  function onBodyPointerUp(e: PointerEvent): void {
    if (sel.dragging) {
      sel.endDrag();
      stopAutoScroll();
      try {
        if (body.hasPointerCapture(e.pointerId)) body.releasePointerCapture(e.pointerId);
      } catch {
        /* 무시 */
      }
    }
  }

  body.addEventListener('pointerdown', onBodyPointerDown);
  body.addEventListener('pointermove', onBodyPointerMove);
  body.addEventListener('pointerup', onBodyPointerUp);
  body.addEventListener('pointercancel', onBodyPointerUp);

  // ───────────────────────── 거터: 행 선택 ─────────────────────────

  let gutDragging = false;
  let gutDragAnchor = -1;

  function onGutPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const g = e.currentTarget as HTMLElement;
    const viewRow = Number(g.dataset.row);
    root.focus();
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const colCount = view.viewCols.length;
    const from = shift ? sel.anchor.r : viewRow;
    sel.selectRows(from, viewRow, colCount - 1, ctrl ? 'add' : shift ? 'extend' : 'set');
    gutDragging = true;
    gutDragAnchor = from;
    try {
      g.setPointerCapture(e.pointerId);
    } catch {
      /* 무시 */
    }
    e.preventDefault();
  }

  function onGutPointerMove(e: PointerEvent): void {
    if (!gutDragging) return;
    const hit = rowAtClientY(e.clientY);
    if (hit === null) return;
    const colCount = view.viewCols.length;
    sel.selectRows(gutDragAnchor, hit, colCount - 1, 'set');
  }

  function onGutPointerUp(e: PointerEvent): void {
    gutDragging = false;
    const g = e.currentTarget as HTMLElement;
    try {
      if (g.hasPointerCapture(e.pointerId)) g.releasePointerCapture(e.pointerId);
    } catch {
      /* 무시 */
    }
  }

  corner.addEventListener('click', () => {
    const rowCount = view.viewRows.length;
    const colCount = view.viewCols.length;
    if (rowCount > 0 && colCount > 0) sel.selectAll(rowCount - 1, colCount - 1);
  });

  // ───────────────────────── 헤더: 정렬 / 리사이즈 / 순서 변경 ─────────────────────────

  let headDrag: HeadDrag | null = null;
  let dropCol = -1;
  let dropLine: HTMLElement | null = null;
  let pendingResize: { srcCol: number; width: number } | null = null;
  let resizeRafScheduled = false;

  function showDropLine(): void {
    if (!dropLine) {
      dropLine = document.createElement('span');
      dropLine.className = 'dgrid-drop-v';
      headTrack.appendChild(dropLine);
    }
    dropLine.style.display = 'block';
  }
  function updateDropLine(): void {
    if (!dropLine) return;
    const colCount = view.viewCols.length;
    const left = dropCol >= colCount ? totalW : offsets[dropCol] ?? 0;
    dropLine.style.left = left + 'px';
  }
  function hideDropLine(): void {
    if (dropLine) dropLine.style.display = 'none';
  }

  function scheduleResizeApply(): void {
    if (resizeRafScheduled) return;
    resizeRafScheduled = true;
    requestAnimationFrame(() => {
      resizeRafScheduled = false;
      if (!pendingResize) return;
      view.setColWidth(pendingResize.srcCol, pendingResize.width);
      pendingResize = null;
      computeGeometry();
      renderHeader();
      lastColWindowKey = '';
      renderWindow();
    });
  }

  function onHeadPointerDown(e: PointerEvent, viewCol: number, th: HTMLElement): void {
    if (e.button !== 0) return;
    const rect = th.getBoundingClientRect();
    root.focus();
    if (rect.right - e.clientX <= RESIZE_ZONE) {
      headDrag = { kind: 'resize', viewCol, startX: e.clientX, startW: widths[viewCol] ?? 120 };
    } else {
      headDrag = {
        kind: 'maybe',
        viewCol,
        startX: e.clientX,
        shift: e.shiftKey,
        ctrl: e.ctrlKey || e.metaKey,
      };
    }
    try {
      th.setPointerCapture(e.pointerId);
    } catch {
      /* 무시 */
    }
    e.preventDefault();
  }

  function onHeadPointerMove(e: PointerEvent): void {
    const d = headDrag;
    if (!d) return;

    if (d.kind === 'resize') {
      pendingResize = { srcCol: view.srcCol(d.viewCol), width: Math.max(40, d.startW + (e.clientX - d.startX)) };
      scheduleResizeApply();
      return;
    }
    if (d.kind === 'maybe') {
      if (Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD) return;
      headDrag = { kind: 'reorder', viewCol: d.viewCol };
      showDropLine();
    }
    const rect = body.getBoundingClientRect();
    const x = e.clientX - rect.left + body.scrollLeft;
    let target = columnAt(offsets, Math.max(0, Math.min(totalW - 1, x)));
    if (x > (offsets[target] ?? 0) + (widths[target] ?? 0) / 2) target++;
    dropCol = Math.max(0, Math.min(view.viewCols.length, target));
    updateDropLine();
  }

  function onHeadPointerUp(e: PointerEvent): void {
    const d = headDrag;
    headDrag = null;
    const el = e.currentTarget as HTMLElement;
    try {
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    } catch {
      /* 무시 */
    }
    hideDropLine();
    if (!d) return;
    if (d.kind === 'resize') return;

    if (d.kind === 'maybe') {
      selectColumn(d.viewCol, d.ctrl ? 'add' : d.shift ? 'extend' : 'set');
      dropCol = -1;
      return;
    }

    const from = d.viewCol;
    let to = dropCol;
    if (to > from) to--;
    if (to >= 0 && to !== from) moveCol(from, to);
    dropCol = -1;
  }

  function onHeadDblClick(e: MouseEvent, viewCol: number, th: HTMLElement): void {
    const rect = th.getBoundingClientRect();
    if (rect.right - e.clientX <= RESIZE_ZONE) {
      view.autoWidth(view.srcCol(viewCol));
      fullRelayout();
    }
  }

  function selectColumn(viewCol: number, mode: 'set' | 'add' | 'extend'): void {
    const rowCount = view.viewRows.length;
    const from = mode === 'extend' ? sel.anchor.c : viewCol;
    sel.selectCols(from, viewCol, rowCount - 1, mode);
  }

  function moveCol(fromView: number, toView: number): void {
    const visible = view.viewCols.slice();
    const item = visible[fromView];
    const reordered = visible.slice();
    reordered.splice(fromView, 1);
    reordered.splice(toView, 0, item);

    const hidden = view.hiddenCols;
    const before = view.colOrder;
    const after: number[] = [];
    let k = 0;
    for (const c of before) after.push(hidden.has(c) ? c : reordered[k++]);

    const inverse: number[] = new Array(visible.length);
    for (let i = 0; i < visible.length; i++) inverse[i] = reordered.indexOf(visible[i]);
    sel.remapCols(inverse);

    view.setColOrder(after);
    fullRelayout();
  }

  function onSortToggle(srcCol: number, additive: boolean): void {
    view.setSorts(toggleSort(view.sorts, srcCol, additive));
    sel.clear();
    fullRelayout();
  }

  // ───────────────────────── 칼럼 필터 ─────────────────────────

  function onOpenColumnFilter(srcCol: number, anchorEl: HTMLElement): void {
    const others = new Map(view.columnFilters);
    others.delete(srcCol);
    const compiled = compileColumnFilters(others, view.colTypes);

    let base: number[];
    if (compiled.length === 0) {
      base = view.rows.map((_, i) => i);
    } else {
      base = [];
      for (let i = 0; i < view.rows.length; i++) {
        const row = view.rows[i];
        let ok = true;
        for (const f of compiled) {
          if (!f.test(row[f.col] ?? '')) {
            ok = false;
            break;
          }
        }
        if (ok) base.push(i);
      }
    }

    const { values, truncated } = uniqueValues(view.rows, base, srcCol, 200);
    const existing = view.getColumnFilter(srcCol);
    const excluded = existing?.mode === 'values' ? existing.excluded : new Set<string>();

    openColumnFilterMenu({
      anchor: anchorEl,
      columnName: view.header[srcCol] ?? '',
      values,
      truncated,
      excluded,
      onApply: ex => {
        view.setColumnFilter(srcCol, { mode: 'values', excluded: ex });
        sel.clear();
        fullRelayout();
      },
      onClear: () => {
        view.setColumnFilter(srcCol, null);
        sel.clear();
        fullRelayout();
      },
    });
  }

  // ───────────────────────── 열 관리자 ─────────────────────────

  function isColumnEmpty(srcCol: number): boolean {
    return view.rows.every(row => (row[srcCol] ?? '') === '');
  }

  function collectColumns(): ColumnManagerColumn[] {
    return view.colOrder.map(srcCol => ({
      srcCol,
      name: view.header[srcCol] ?? '',
      hidden: view.hiddenCols.has(srcCol),
      empty: isColumnEmpty(srcCol),
    }));
  }

  function refreshColumnManager(): void {
    colMenuHandle?.refresh(collectColumns());
  }

  function openColumnManagerFor(anchor: HTMLElement): void {
    colMenuHandle?.close();
    colMenuHandle = openColumnManager({
      anchor,
      columns: collectColumns(),
      onToggle: (srcCol, hidden) => {
        if (hidden) {
          const ok = view.hideCols([srcCol]);
          if (!ok) {
            refreshColumnManager();
            return;
          }
        } else {
          view.showCol(srcCol);
        }
        sel.clampTo(view.viewRows.length, view.viewCols.length);
        fullRelayout();
        refreshColumnManager();
      },
      onShowAll: () => {
        view.showAllCols();
        sel.clampTo(view.viewRows.length, view.viewCols.length);
        fullRelayout();
        refreshColumnManager();
      },
      onHideEmpty: () => {
        const emptyCols = view.colOrder.filter(c => !view.hiddenCols.has(c) && isColumnEmpty(c));
        if (emptyCols.length) view.hideCols(emptyCols);
        sel.clampTo(view.viewRows.length, view.viewCols.length);
        fullRelayout();
        refreshColumnManager();
      },
    });
  }

  // ───────────────────────── 키보드 내비게이션 ─────────────────────────

  function moveActive(dr: number, dc: number, extend: boolean): void {
    const rowCount = view.viewRows.length;
    const colCount = view.viewCols.length;
    if (rowCount === 0 || colCount === 0) return;
    const r = Math.max(0, Math.min(rowCount - 1, sel.active.r + dr));
    const c = Math.max(0, Math.min(colCount - 1, sel.active.c + dc));
    if (extend) sel.extendTo(r, c);
    else sel.selectCell(r, c);
    scrollToCell(r, c);
  }

  function moveToEdge(dr: number, dc: number, extend: boolean): void {
    const rowCount = view.viewRows.length;
    const colCount = view.viewCols.length;
    if (rowCount === 0 || colCount === 0) return;
    const r = dr === 0 ? sel.active.r : dr < 0 ? 0 : rowCount - 1;
    const c = dc === 0 ? sel.active.c : dc < 0 ? 0 : colCount - 1;
    if (extend) sel.extendTo(r, c);
    else sel.selectCell(r, c);
    scrollToCell(r, c);
  }

  function onKeyDown(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey;
    const page = Math.max(1, Math.floor(viewportH / ROW_H) - 1);

    switch (e.key) {
      case 'ArrowDown':
        mod ? moveToEdge(1, 0, e.shiftKey) : moveActive(1, 0, e.shiftKey);
        break;
      case 'ArrowUp':
        mod ? moveToEdge(-1, 0, e.shiftKey) : moveActive(-1, 0, e.shiftKey);
        break;
      case 'ArrowRight':
        mod ? moveToEdge(0, 1, e.shiftKey) : moveActive(0, 1, e.shiftKey);
        break;
      case 'ArrowLeft':
        mod ? moveToEdge(0, -1, e.shiftKey) : moveActive(0, -1, e.shiftKey);
        break;
      case 'PageDown':
        moveActive(page, 0, e.shiftKey);
        break;
      case 'PageUp':
        moveActive(-page, 0, e.shiftKey);
        break;
      case 'Home':
        mod ? moveToEdge(-1, -1, e.shiftKey) : moveToEdge(0, -1, e.shiftKey);
        break;
      case 'End':
        mod ? moveToEdge(1, 1, e.shiftKey) : moveToEdge(0, 1, e.shiftKey);
        break;
      case 'Escape':
        sel.clear();
        break;
      case 'a':
      case 'A':
        if (!mod) return;
        {
          const rowCount = view.viewRows.length;
          const colCount = view.viewCols.length;
          if (rowCount > 0 && colCount > 0) sel.selectAll(rowCount - 1, colCount - 1);
        }
        break;
      case 'c':
      case 'C':
        if (!mod) return;
        void api.copySelection();
        break;
      default:
        return;
    }
    e.preventDefault();
  }
  root.addEventListener('keydown', onKeyDown);

  // ───────────────────────── 찾기 ─────────────────────────

  function find(query: string): { total: number; truncated: boolean } {
    findMatches = [];
    findSet = new Set();
    findIndex = -1;
    let truncated = false;

    if (query) {
      const q = query.toLowerCase();
      const rows = view.viewRows;
      const cols = view.viewCols;
      outer: for (let r = 0; r < rows.length; r++) {
        const src = rows[r];
        const rowData = view.rows[src];
        for (let c = 0; c < cols.length; c++) {
          const v = rowData[cols[c]] ?? '';
          if (v.toLowerCase().includes(q)) {
            findMatches.push({ r, c });
            findSet.add(r + ':' + c);
            if (findMatches.length >= FIND_CAP) {
              truncated = true;
              break outer;
            }
          }
        }
      }
      findIndex = findMatches.length ? 0 : -1;
      if (findIndex >= 0) {
        sel.selectCell(findMatches[0].r, findMatches[0].c);
        scrollToCell(findMatches[0].r, findMatches[0].c);
      }
    }
    renderWindow();
    return { total: findMatches.length, truncated };
  }

  function stepMatch(delta: number): void {
    if (findMatches.length === 0) return;
    findIndex = (findIndex + delta + findMatches.length) % findMatches.length;
    const m = findMatches[findIndex];
    sel.selectCell(m.r, m.c);
    scrollToCell(m.r, m.c);
    renderWindow();
  }

  // ───────────────────────── API ─────────────────────────

  function setData(data: Matrix): void {
    view.setData(data);
    sel.clear();
    findMatches = [];
    findSet = new Set();
    findIndex = -1;
    body.scrollTop = 0;
    body.scrollLeft = 0;
    scrollTop = 0;
    scrollLeft = 0;
    viewportH = body.clientHeight;
    viewportW = body.clientWidth;
    fullRelayout();
  }

  const api: DataGridApi = {
    setData,
    clear: () => setData({ header: [], rows: [] }),
    copySelection: async () => {
      const scope: ExportScope = sel.isEmpty ? 'view' : 'selection';
      const matrix = buildMatrix(view, sel, scope);
      if (matrix.length === 0) return;
      await writeTable(matrix, { headerRow: true });
    },
    getCSV: (scope: ExportScope = 'all') => {
      const matrix = buildMatrix(view, sel, scope);
      if (matrix.length === 0) return '';
      const [header, ...rows] = matrix;
      return matrixToCSV(header, rows);
    },
    find,
    nextMatch: () => stepMatch(1),
    prevMatch: () => stepMatch(-1),
    getMatchInfo: () => ({
      current: findMatches.length ? findIndex + 1 : 0,
      total: findMatches.length,
    }),
    getStats: () => ({
      rows: view.viewRows.length,
      totalRows: view.rows.length,
      cols: view.viewCols.length,
      hidden: view.hiddenColCount,
      filtered: view.activeColumnFilterCount,
    }),
    setOnStatsChange: cb => {
      onStatsChange = cb;
    },
    openColumnManager: openColumnManagerFor,
    relayout: () => {
      viewportH = body.clientHeight;
      viewportW = body.clientWidth;
      scheduleRender();
    },
    destroy: () => {
      ro.disconnect();
      stopAutoScroll();
      colMenuHandle?.close();
    },
  };

  const el = root as unknown as ComponentElement<DataGridApi>;
  el.api = api;
  return el;
}
