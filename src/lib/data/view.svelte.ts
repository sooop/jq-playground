import { compileColumnFilters, isEmptyFilter } from './columnFilter'
import type { Dataset } from './dataset.svelte'
import { compile, matchRow } from './filter'
import { sortIndices } from './sort'
import type { ColumnFilter, SortSpec } from './types'

/** 0..n-1 인덱스 배열. 필터가 없을 때 쓰는 항등 매핑. */
function identity(n: number): Uint32Array {
  const a = new Uint32Array(n)
  for (let i = 0; i < n; i++) a[i] = i
  return a
}

/**
 * 뷰 파이프라인: `rows` → 칼럼 필터 → 스마트 필터 → 정렬 → `viewRows`.
 *
 * 원본 `rows`는 절대 건드리지 않고 `Uint32Array` 인덱스 배열만 만든다.
 * 각 단계는 `$derived`로 연결되어 관련 입력이 바뀔 때만 다시 계산된다.
 */
export class View {
  /** 스마트 필터 입력 (디바운스가 적용된 값) */
  query = $state('')
  regexMode = $state(false)
  sorts = $state.raw<SortSpec[]>([])
  /** source 칼럼 인덱스 → 필터 */
  columnFilters = $state.raw<Map<number, ColumnFilter>>(new Map())

  /**
   * 숨긴 칼럼·행 (source 인덱스).
   *
   * 숨기기는 **뷰 상태**다 — 필터·정렬과 같은 층이고 편집 히스토리(Undo)에 넣지 않는다.
   * 데이터가 바뀌지 않으므로 Undo 대상이 아니고, 되돌리기는 "숨김 모두 해제"가 담당한다.
   */
  hiddenCols = $state.raw<Set<number>>(new Set())
  hiddenRows = $state.raw<Set<number>>(new Set())

  constructor(private readonly ds: Dataset) {}

  matcher = $derived(compile(this.query, this.regexMode))

  /**
   * 화면에 표시할 칼럼의 source 인덱스 목록 = `colOrder` − 숨긴 칼럼.
   *
   * `colOrder`는 숨김과 무관한 **전체 순서**를 유지한다. 그래야 숨김을 풀 때 원래 자리로 돌아온다.
   * 뷰 칼럼 인덱스로 데이터를 읽는 모든 곳은 `colOrder`가 아니라 이 배열을 써야 한다.
   */
  viewCols = $derived.by(() => {
    const hidden = this.hiddenCols
    const order = this.ds.colOrder
    return hidden.size === 0 ? order : order.filter((c) => !hidden.has(c))
  })

  /** 칼럼 필터만 적용한 인덱스 — 칼럼 필터 드롭다운의 고유값 집계 기준 */
  columnFiltered = $derived.by(() => {
    const ds = this.ds
    ds.version // 데이터 변경 무효화 의존성
    const rows = ds.rows
    const compiled = compileColumnFilters(this.columnFilters, ds.colTypes)
    const hidden = this.hiddenRows
    if (compiled.length === 0 && hidden.size === 0) return identity(rows.length)

    const out = new Uint32Array(rows.length)
    let n = 0
    for (let i = 0; i < rows.length; i++) {
      if (hidden.has(i)) continue
      const row = rows[i]
      let ok = true
      for (let f = 0; f < compiled.length; f++) {
        if (!compiled[f].test(row[compiled[f].col] ?? '')) {
          ok = false
          break
        }
      }
      if (ok) out[n++] = i
    }
    return out.subarray(0, n)
  })

  /**
   * 필터 → 정렬 파이프라인. 소요 시간을 **반환값에 담는다**.
   *
   * `$derived` 안에서 `$state`에 쓰면 Svelte가 `state_unsafe_mutation`으로 막고, 비반응성
   * 필드에 쓰면 상태바가 갱신을 감지하지 못한다. 결과의 일부로 돌려주는 것이 두 문제를 모두 피한다.
   */
  pipeline = $derived.by(() => {
    const ds = this.ds
    ds.version
    const base = this.columnFiltered
    const m = this.matcher

    const t0 = performance.now()
    let filtered: Uint32Array
    if (m.kind === 'empty' || (m.kind === 'regex' && m.re === null)) {
      filtered = base
    } else {
      const rows = ds.rows
      const keys = ds.searchIndex
      const out = new Uint32Array(base.length)
      let n = 0
      for (let i = 0; i < base.length; i++) {
        const src = base[i]
        if (matchRow(m, rows[src], keys[src] ?? '')) out[n++] = src
      }
      filtered = out.subarray(0, n)
    }
    const t1 = performance.now()

    let sorted = filtered
    if (this.sorts.length > 0) {
      sorted = new Uint32Array(filtered) // sortIndices는 제자리 정렬
      sortIndices(sorted, ds.rows, this.sorts, ds.colTypes)
    }
    return { rows: sorted, filterMs: t1 - t0, sortMs: performance.now() - t1 }
  })

  viewRows = $derived(this.pipeline.rows)

  /** 마지막 파이프라인 계산 시간 (ms) — 상태바 표시용 */
  timings = $derived({ filterMs: this.pipeline.filterMs, sortMs: this.pipeline.sortMs })

  get visibleCount(): number {
    return this.viewRows.length
  }

  /** 필터가 하나라도 걸려 있는지 (건수 배지 표시 여부) */
  get hasAnyFilter(): boolean {
    if (this.matcher.kind !== 'empty') return true
    for (const f of this.columnFilters.values()) if (!isEmptyFilter(f)) return true
    return false
  }

  /** 값이 실제로 설정된 칼럼 필터 개수 */
  get activeColumnFilterCount(): number {
    let n = 0
    for (const f of this.columnFilters.values()) if (!isEmptyFilter(f)) n++
    return n
  }

  /** 정렬이 걸려 있는지 — 행 드래그 순서 변경 가능 여부 판정 */
  get isSorted(): boolean {
    return this.sorts.length > 0
  }

  setColumnFilter(col: number, f: ColumnFilter | null): void {
    const next = new Map(this.columnFilters)
    if (f === null || isEmptyFilter(f)) next.delete(col)
    else next.set(col, f)
    this.columnFilters = next
  }

  getColumnFilter(col: number): ColumnFilter | undefined {
    return this.columnFilters.get(col)
  }

  clearColumnFilters(): void {
    this.columnFilters = new Map()
  }

  clearAll(): void {
    this.query = ''
    this.sorts = []
    this.columnFilters = new Map()
    this.hiddenCols = new Set()
    this.hiddenRows = new Set()
  }

  /** 뷰 행 인덱스 → source 행 인덱스 */
  srcRow(viewRow: number): number {
    return this.viewRows[viewRow] ?? 0
  }

  /** 뷰 칼럼 인덱스 → source 칼럼 인덱스 */
  srcCol(viewCol: number): number {
    return this.viewCols[viewCol] ?? 0
  }

  // --- 숨기기 ---

  get hiddenColCount(): number {
    return this.hiddenCols.size
  }
  get hiddenRowCount(): number {
    return this.hiddenRows.size
  }
  get hasHidden(): boolean {
    return this.hiddenCols.size > 0 || this.hiddenRows.size > 0
  }

  /** 칼럼 숨기기. 모든 칼럼을 숨기려 하면 아무것도 하지 않는다(빈 화면 방지). */
  hideCols(srcCols: readonly number[]): boolean {
    const next = new Set(this.hiddenCols)
    for (const c of srcCols) next.add(c)
    if (next.size >= this.ds.colCount) return false
    this.hiddenCols = next
    return true
  }

  hideRows(srcRows: readonly number[]): void {
    const next = new Set(this.hiddenRows)
    for (const r of srcRows) next.add(r)
    this.hiddenRows = next
  }

  showAllCols(): void {
    this.hiddenCols = new Set()
  }
  showAllRows(): void {
    this.hiddenRows = new Set()
  }
  showAll(): void {
    this.hiddenCols = new Set()
    this.hiddenRows = new Set()
  }

  /**
   * 칼럼 삭제로 source 인덱스가 당겨질 때 숨김 집합을 따라 보정한다.
   * @param deleted 삭제된 source 칼럼 인덱스(오름차순)
   */
  remapHiddenColsAfterDelete(deleted: readonly number[]): void {
    if (this.hiddenCols.size === 0) return
    const del = new Set(deleted)
    const next = new Set<number>()
    for (const c of this.hiddenCols) {
      if (del.has(c)) continue
      next.add(c - deleted.filter((d) => d < c).length)
    }
    this.hiddenCols = next
  }

  /** 이 칼럼의 정렬 방향과 우선순위 (없으면 null) */
  sortStateOf(col: number): { dir: 'asc' | 'desc'; rank: number } | null {
    const at = this.sorts.findIndex((s) => s.col === col)
    return at < 0 ? null : { dir: this.sorts[at].dir, rank: at + 1 }
  }
}
