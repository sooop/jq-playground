import type { CellRef, Range, Selection } from './types'

/** r0<=r1, c0<=c1 로 정규화한다. */
export function normalize(r: Range): Range {
  return {
    r0: Math.min(r.r0, r.r1),
    r1: Math.max(r.r0, r.r1),
    c0: Math.min(r.c0, r.c1),
    c1: Math.max(r.c0, r.c1),
    kind: r.kind,
  }
}

export function contains(r: Range, row: number, col: number): boolean {
  return row >= r.r0 && row <= r.r1 && col >= r.c0 && col <= r.c1
}

export function rangeCellCount(r: Range): number {
  return (r.r1 - r.r0 + 1) * (r.c1 - r.c0 + 1)
}

/** 여러 범위를 모두 감싸는 최소 사각형. */
export function boundingBox(ranges: readonly Range[]): Range | null {
  if (ranges.length === 0) return null
  let { r0, r1, c0, c1 } = ranges[0]
  for (let i = 1; i < ranges.length; i++) {
    const r = ranges[i]
    if (r.r0 < r0) r0 = r.r0
    if (r.r1 > r1) r1 = r.r1
    if (r.c0 < c0) c0 = r.c0
    if (r.c1 > c1) c1 = r.c1
  }
  return { r0, r1, c0, c1, kind: 'cell' }
}

/**
 * 선택 모델.
 *
 * 좌표계는 모두 **뷰 좌표**다 — 행은 `viewRows` 인덱스, 열은 `colOrder` 인덱스.
 * 필터·정렬이 바뀌면 뷰 좌표의 의미가 사라지므로 호출부가 {@link clear}를 부른다.
 */
export class SelectionStore {
  ranges = $state.raw<Range[]>([])
  /** 범위 확장의 기준점 (Shift+클릭/방향키) */
  anchor = $state.raw<CellRef>({ r: 0, c: 0 })
  /** 커서 위치 — 편집 시작 대상이고, 굵은 테두리로 표시된다 */
  active = $state.raw<CellRef>({ r: 0, c: 0 })

  /** 드래그 중인지 — 드래그 중에는 마지막 범위를 계속 갱신한다 */
  dragging = $state(false)
  /** 드래그로 갱신할 범위의 인덱스 */
  #dragIndex = -1

  get isEmpty(): boolean {
    return this.ranges.length === 0
  }

  get cellCount(): number {
    // 겹침을 정확히 빼려면 비용이 크다. 단일 범위(대부분의 경우)는 정확하고,
    // 다중 범위는 합집합 상한이므로 상태바 표기에 '≈'를 붙인다.
    let n = 0
    for (const r of this.ranges) n += rangeCellCount(r)
    return n
  }

  /** 다중 범위가 서로 겹칠 수 있어 cellCount가 근사치인지 */
  get countIsApprox(): boolean {
    if (this.ranges.length < 2) return false
    for (let i = 0; i < this.ranges.length; i++) {
      for (let j = i + 1; j < this.ranges.length; j++) {
        const a = this.ranges[i]
        const b = this.ranges[j]
        if (a.r0 <= b.r1 && b.r0 <= a.r1 && a.c0 <= b.c1 && b.c0 <= a.c1) return true
      }
    }
    return false
  }

  snapshot(): Selection {
    return {
      ranges: this.ranges.map((r) => ({ ...r })),
      anchor: { ...this.anchor },
      active: { ...this.active },
    }
  }

  restore(s: Selection | null): void {
    if (!s) {
      this.clear()
      return
    }
    this.ranges = s.ranges.map((r) => ({ ...r }))
    this.anchor = { ...s.anchor }
    this.active = { ...s.active }
  }

  clear(): void {
    this.ranges = []
    this.dragging = false
    this.#dragIndex = -1
  }

  /** 셀 하나를 선택 (일반 클릭) */
  selectCell(r: number, c: number): void {
    this.ranges = [{ r0: r, r1: r, c0: c, c1: c, kind: 'cell' }]
    this.anchor = { r, c }
    this.active = { r, c }
  }

  /** 셀 하나를 별도 범위로 추가 (Ctrl+클릭) */
  addCell(r: number, c: number): void {
    this.ranges = [...this.ranges, { r0: r, r1: r, c0: c, c1: c, kind: 'cell' }]
    this.anchor = { r, c }
    this.active = { r, c }
  }

  /** anchor에서 (r,c)까지 마지막 범위를 확장 (Shift+클릭) */
  extendTo(r: number, c: number): void {
    const a = this.anchor
    const box = normalize({ r0: a.r, r1: r, c0: a.c, c1: c, kind: 'cell' })
    if (this.ranges.length === 0) this.ranges = [box]
    else this.ranges = [...this.ranges.slice(0, -1), box]
    this.active = { r, c }
  }

  /** 드래그 시작. `additive`면 기존 범위를 유지하고 새 범위를 덧붙인다. */
  beginDrag(r: number, c: number, additive: boolean): void {
    const box: Range = { r0: r, r1: r, c0: c, c1: c, kind: 'cell' }
    if (additive) {
      this.ranges = [...this.ranges, box]
      this.#dragIndex = this.ranges.length - 1
    } else {
      this.ranges = [box]
      this.#dragIndex = 0
    }
    this.anchor = { r, c }
    this.active = { r, c }
    this.dragging = true
  }

  /** 드래그 중 커서 이동 — 시작점에서 현재 위치까지의 사각형으로 갱신 */
  updateDrag(r: number, c: number): void {
    if (!this.dragging || this.#dragIndex < 0) return
    const a = this.anchor
    const box = normalize({ r0: a.r, r1: r, c0: a.c, c1: c, kind: 'cell' })
    const next = this.ranges.slice()
    next[this.#dragIndex] = box
    this.ranges = next
    this.active = { r, c }
  }

  endDrag(): void {
    this.dragging = false
    this.#dragIndex = -1
  }

  /**
   * 행 전체 선택. `mode`에 따라 교체/추가/확장한다.
   * @param lastCol 마지막 뷰 칼럼 인덱스
   */
  selectRows(from: number, to: number, lastCol: number, mode: 'set' | 'add' | 'extend'): void {
    const r0 = Math.min(from, to)
    const r1 = Math.max(from, to)
    const box: Range = { r0, r1, c0: 0, c1: lastCol, kind: 'row' }
    if (mode === 'add') this.ranges = [...this.ranges, box]
    else if (mode === 'extend' && this.ranges.length > 0)
      this.ranges = [...this.ranges.slice(0, -1), box]
    else this.ranges = [box]
    if (mode !== 'extend') this.anchor = { r: from, c: 0 }
    this.active = { r: to, c: 0 }
  }

  /** 열 전체 선택. */
  selectCols(from: number, to: number, lastRow: number, mode: 'set' | 'add' | 'extend'): void {
    const c0 = Math.min(from, to)
    const c1 = Math.max(from, to)
    const box: Range = { r0: 0, r1: lastRow, c0, c1, kind: 'col' }
    if (mode === 'add') this.ranges = [...this.ranges, box]
    else if (mode === 'extend' && this.ranges.length > 0)
      this.ranges = [...this.ranges.slice(0, -1), box]
    else this.ranges = [box]
    if (mode !== 'extend') this.anchor = { r: 0, c: from }
    this.active = { r: 0, c: to }
  }

  selectAll(lastRow: number, lastCol: number): void {
    this.ranges = [{ r0: 0, r1: lastRow, c0: 0, c1: lastCol, kind: 'cell' }]
    this.anchor = { r: 0, c: 0 }
    this.active = { r: 0, c: 0 }
  }

  /** 뷰 크기가 줄었을 때 선택을 유효 범위로 자른다. */
  clampTo(rowCount: number, colCount: number): void {
    if (rowCount <= 0 || colCount <= 0) {
      this.clear()
      return
    }
    const lastR = rowCount - 1
    const lastC = colCount - 1
    const next: Range[] = []
    for (const r of this.ranges) {
      if (r.r0 > lastR || r.c0 > lastC) continue
      next.push({
        r0: r.r0,
        r1: Math.min(r.r1, lastR),
        c0: r.c0,
        c1: Math.min(r.c1, lastC),
        kind: r.kind,
      })
    }
    this.ranges = next
    this.active = {
      r: Math.min(this.active.r, lastR),
      c: Math.min(this.active.c, lastC),
    }
    this.anchor = {
      r: Math.min(this.anchor.r, lastR),
      c: Math.min(this.anchor.c, lastC),
    }
  }

  /**
   * 열 순서 변경에 맞춰 선택을 다시 매핑한다.
   * @param map 이전 뷰 칼럼 인덱스 → 새 뷰 칼럼 인덱스
   */
  remapCols(map: readonly number[]): void {
    // 범위가 열 구간이므로 정확한 재매핑은 불가능한 경우가 있다(연속 구간이 흩어짐).
    // 열 단위 선택만 유지하고 나머지는 해제하는 게 예측 가능하다.
    const next: Range[] = []
    for (const r of this.ranges) {
      if (r.kind !== 'col' || r.c0 !== r.c1) continue
      const nc = map[r.c0]
      if (nc === undefined) continue
      next.push({ ...r, c0: nc, c1: nc })
    }
    this.ranges = next
    const na = map[this.active.c]
    if (na !== undefined) this.active = { ...this.active, c: na }
    const nb = map[this.anchor.c]
    if (nb !== undefined) this.anchor = { ...this.anchor, c: nb }
  }

  /**
   * 특정 행에서 선택된 칼럼 구간들을 돌려준다 — 셀 렌더링에서 배경 판정에 쓴다.
   * 행마다 한 번만 호출하고 셀 루프에서는 이 결과만 본다.
   */
  spansForRow(row: number): { c0: number; c1: number }[] {
    const out: { c0: number; c1: number }[] = []
    for (const r of this.ranges) {
      if (row >= r.r0 && row <= r.r1) out.push({ c0: r.c0, c1: r.c1 })
    }
    return out
  }

  /** 이 행이 행 단위로 완전히 선택되었는지 — 거터 강조용 */
  isRowFullySelected(row: number, lastCol: number): boolean {
    for (const r of this.ranges) {
      if (row >= r.r0 && row <= r.r1 && r.c0 === 0 && r.c1 >= lastCol) return true
    }
    return false
  }

  /** 이 열이 열 단위로 완전히 선택되었는지 — 헤더 강조용 */
  isColFullySelected(col: number, lastRow: number): boolean {
    for (const r of this.ranges) {
      if (col >= r.c0 && col <= r.c1 && r.r0 === 0 && r.r1 >= lastRow) return true
    }
    return false
  }

  /** 완전히 선택된 행 인덱스 목록 (오름차순) — 행 삭제/이동 대상 판정 */
  fullySelectedRows(lastCol: number): number[] {
    const set = new Set<number>()
    for (const r of this.ranges) {
      if (r.c0 === 0 && r.c1 >= lastCol) {
        for (let i = r.r0; i <= r.r1; i++) set.add(i)
      }
    }
    return [...set].sort((a, b) => a - b)
  }

  /** 완전히 선택된 열 인덱스 목록 (오름차순) */
  fullySelectedCols(lastRow: number): number[] {
    const set = new Set<number>()
    for (const r of this.ranges) {
      if (r.r0 === 0 && r.r1 >= lastRow) {
        for (let i = r.c0; i <= r.c1; i++) set.add(i)
      }
    }
    return [...set].sort((a, b) => a - b)
  }
}
