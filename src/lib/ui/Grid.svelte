<script lang="ts">
  import type { Dataset } from '../data/dataset.svelte'
  import { splitHighlight } from '../data/filter'
  import type { FindStore } from '../data/findState.svelte'
  import { contains, type SelectionStore } from '../data/selection.svelte'
  import type { View } from '../data/view.svelte'
  import { buildOffsets, columnAt } from '../util/prefixSum'

  interface Props {
    ds: Dataset
    view: View
    sel: SelectionStore
    /** 찾기 상태 — 매치 셀 강조에만 쓴다 (패널이 열려 있지 않으면 결과가 비어 있다) */
    find: FindStore
    /**
     * 읽기 전용 — 셀 편집·붙여넣기·내용 지우기·헤더 이름 변경·행 순서 변경을 막는다.
     * 정렬·필터·선택·복사·열 폭·열 순서는 뷰 조작이므로 그대로 허용한다(jq 출력 뷰가 쓴다).
     */
    readonly?: boolean
    /** 셀 편집 확정 */
    onCommitCell: (srcRow: number, srcCol: number, value: string) => void
    /** 헤더명 변경 확정 */
    onRenameHeader: (srcCol: number, name: string) => void
    /** 열 순서 변경 (뷰 인덱스 기준) */
    onMoveCol: (fromView: number, toView: number) => void
    /** 행 순서 변경 (뷰 행 인덱스 목록 → 목표 뷰 행 인덱스) */
    onMoveRows: (viewRows: number[], toViewRow: number) => void
    onSortToggle: (srcCol: number, additive: boolean) => void
    /** 칼럼 필터 드롭다운 열기 */
    onOpenColumnFilter: (srcCol: number, anchor: HTMLElement) => void
    /** 컨텍스트 메뉴 */
    onContextMenu: (e: MouseEvent) => void
    onCopy: () => void
    onPasteText: (text: string) => void
    onDeleteContents: () => void
    onNotice: (msg: string) => void
  }

  let {
    ds,
    view,
    sel,
    find,
    readonly = false,
    onCommitCell,
    onRenameHeader,
    onMoveCol,
    onMoveRows,
    onSortToggle,
    onOpenColumnFilter,
    onContextMenu,
    onCopy,
    onPasteText,
    onDeleteContents,
    onNotice,
  }: Props = $props()

  const ROW_H = 28
  const OVERSCAN_R = 6
  const OVERSCAN_C = 2
  /** 헤더 우변에서 리사이즈 핸들로 인식하는 폭 */
  const RESIZE_ZONE = 5
  /** 클릭과 드래그를 가르는 이동 거리 */
  const DRAG_THRESHOLD = 4

  /**
   * 포인터 캡처는 실패할 수 있다 (합성 이벤트, 이미 해제된 포인터 등). 실패해도 드래그 자체는
   * 동작하므로 예외로 흐름을 끊지 않는다.
   */
  function capture(el: Element, id: number): void {
    try {
      el.setPointerCapture(id)
    } catch {
      /* 무시 */
    }
  }
  function release(el: Element, id: number): void {
    try {
      if (el.hasPointerCapture(id)) el.releasePointerCapture(id)
    } catch {
      /* 무시 */
    }
  }

  let bodyEl: HTMLDivElement
  let headTrack: HTMLDivElement
  let gutTrack: HTMLDivElement
  let rootEl: HTMLDivElement

  let scrollTop = $state(0)
  let scrollLeft = $state(0)
  let viewportH = $state(600)
  let viewportW = $state(900)

  // --- 레이아웃 계산 ---

  /** 뷰 순서로 늘어놓은 칼럼 폭 (colWidths는 source 인덱스 기준) */
  const widths = $derived(view.viewCols.map((c) => ds.colWidths[c] ?? 120))
  const offsets = $derived(buildOffsets(widths))
  const totalW = $derived(offsets[offsets.length - 1] ?? 0)

  const rowCount = $derived(view.viewRows.length)
  const colCount = $derived(view.viewCols.length)
  const totalH = $derived(rowCount * ROW_H)

  const firstRow = $derived(Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN_R))
  const rowSlots = $derived(
    Math.max(0, Math.min(rowCount - firstRow, Math.ceil(viewportH / ROW_H) + OVERSCAN_R * 2)),
  )

  const firstCol = $derived(Math.max(0, columnAt(offsets, scrollLeft) - OVERSCAN_C))
  const lastCol = $derived(
    Math.min(colCount - 1, columnAt(offsets, scrollLeft + viewportW - 1) + OVERSCAN_C),
  )
  const colSpan = $derived(Math.max(0, lastCol - firstCol + 1))

  /**
   * 셀 선택 여부.
   *
   * 가시 창 비트맵을 미리 만드는 편이 빨라 보이지만, 그러면 인덱스가 `firstRow`에 묶여
   * **스크롤할 때마다 재사용 중인 셀까지 전부 무효화된다**. 절대 좌표를 받아 `sel.ranges`만
   * 읽는 함수로 두면 스크롤 중에는 의존성이 변하지 않아 재평가가 일어나지 않는다.
   * 범위 개수는 보통 1~3개라 셀당 비용도 무시할 수준이다.
   */
  function isSel(r: number, c: number): boolean {
    const ranges = sel.ranges
    for (let i = 0; i < ranges.length; i++) {
      const rg = ranges[i]
      if (r >= rg.r0 && r <= rg.r1 && c >= rg.c0 && c <= rg.c1) return true
    }
    return false
  }

  const matcher = $derived(view.matcher)
  const highlighting = $derived(matcher.kind !== 'empty' && !(matcher.kind === 'regex' && !matcher.re))

  // --- 스크롤 동기화 ---
  //
  // 헤더/거터는 스크롤 컨테이너 밖에 있으므로 transform으로 따라붙인다. transform은 스크롤
  // 이벤트에서 **직접 DOM에 쓴다** — 반응성 경로를 타면 한 프레임 늦어 본문과 어긋나 보인다.
  // 반면 가시 창 계산은 $state를 통하고, 한 프레임 늦어도 오버스캔이 흡수한다.
  // 셀 좌표는 모두 캔버스 절대 좌표라 렌더가 늦어도 이미 그려진 셀은 제자리에 있다.
  function syncScroll(): void {
    const el = bodyEl
    if (!el) return
    if (headTrack) headTrack.style.transform = `translate3d(${-el.scrollLeft}px,0,0)`
    if (gutTrack) gutTrack.style.transform = `translate3d(0,${-el.scrollTop}px,0)`
    scrollLeft = el.scrollLeft
    scrollTop = el.scrollTop
  }

  /**
   * 뷰포트 크기를 다시 잰다. ResizeObserver가 평소에는 알아서 하지만, 숨겨졌다가 다시 보이는
   * 페인(모드 전환)처럼 관측이 어긋날 수 있는 순간에 호출자가 직접 부를 수 있게 노출한다.
   */
  export function remeasure(): void {
    const el = bodyEl
    if (!el) return
    viewportH = el.clientHeight
    viewportW = el.clientWidth
    syncScroll()
  }

  $effect(() => {
    const el = bodyEl
    if (!el) return
    const ro = new ResizeObserver(() => {
      viewportH = el.clientHeight
      viewportW = el.clientWidth
    })
    ro.observe(el)
    viewportH = el.clientHeight
    viewportW = el.clientWidth
    return () => ro.disconnect()
  })

  /**
   * 거터·헤더 페인 위에서의 휠 스크롤.
   *
   * 두 페인은 `overflow: hidden`이라 자체 스크롤이 없다. 그래서 행 번호 위에 커서를 두고 휠을
   * 굴리면 아무 일도 일어나지 않았다 — 표를 훑을 때 커서가 자연스럽게 놓이는 자리인데도.
   * 휠 델타를 본문 스크롤로 넘겨준다.
   *
   * `preventDefault`가 필요하므로 `{ passive: false }`로 직접 등록한다 (선언적 `onwheel`은
   * 브라우저·프레임워크에 따라 passive로 붙을 수 있다).
   */
  $effect(() => {
    const panes = [gutTrack?.parentElement, headTrack?.parentElement].filter(
      (e): e is HTMLElement => !!e,
    )
    if (panes.length === 0) return

    const onWheel = (e: WheelEvent) => {
      const el = bodyEl
      if (!el) return
      e.preventDefault()
      el.scrollTop += e.deltaY
      el.scrollLeft += e.deltaX
      syncScroll()
    }
    for (const p of panes) p.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      for (const p of panes) p.removeEventListener('wheel', onWheel)
    }
  })

  /** 데이터셋이 바뀌면 맨 위로 돌아간다 */
  $effect(() => {
    void ds.version
    void view.viewRows
    if (bodyEl && bodyEl.scrollTop > totalH) {
      bodyEl.scrollTop = 0
      syncScroll()
    }
  })

  // --- 좌표 ↔ 셀 변환 ---

  function cellAtEvent(e: { clientX: number; clientY: number }): { r: number; c: number } | null {
    if (!bodyEl || rowCount === 0 || colCount === 0) return null
    const rect = bodyEl.getBoundingClientRect()
    const x = e.clientX - rect.left + bodyEl.scrollLeft
    const y = e.clientY - rect.top + bodyEl.scrollTop
    const r = Math.floor(y / ROW_H)
    return {
      r: Math.max(0, Math.min(rowCount - 1, r)),
      c: columnAt(offsets, Math.max(0, Math.min(totalW - 1, x))),
    }
  }

  /** 활성 셀이 화면에 보이도록 스크롤 */
  export function scrollToCell(r: number, c: number): void {
    const el = bodyEl
    if (!el) return
    const top = r * ROW_H
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW_H > el.scrollTop + el.clientHeight)
      el.scrollTop = top + ROW_H - el.clientHeight

    const left = offsets[c] ?? 0
    const w = widths[c] ?? 0
    if (left < el.scrollLeft) el.scrollLeft = left
    else if (left + w > el.scrollLeft + el.clientWidth) el.scrollLeft = left + w - el.clientWidth
    syncScroll()
  }

  export function focusGrid(): void {
    rootEl?.focus()
  }

  // --- 본문 포인터 조작 ---

  let autoScrollTimer: number | null = null
  let lastPointer = { clientX: 0, clientY: 0 }

  function stopAutoScroll(): void {
    if (autoScrollTimer !== null) {
      clearInterval(autoScrollTimer)
      autoScrollTimer = null
    }
  }

  /** 포인터가 본문의 스크롤바 위(콘텐츠 영역 바깥)에 있는지 */
  function onScrollbar(e: { clientX: number; clientY: number }): boolean {
    if (!bodyEl) return false
    const rect = bodyEl.getBoundingClientRect()
    return e.clientX - rect.left >= bodyEl.clientWidth || e.clientY - rect.top >= bodyEl.clientHeight
  }

  /** 드래그가 뷰포트 가장자리에 닿으면 계속 스크롤한다 */
  function startAutoScroll(): void {
    if (autoScrollTimer !== null) return
    autoScrollTimer = window.setInterval(() => {
      if (!sel.dragging || !bodyEl) {
        stopAutoScroll()
        return
      }
      const rect = bodyEl.getBoundingClientRect()
      // 스크롤바 두께를 뺀 실제 콘텐츠 영역을 기준으로 가장자리를 판정한다
      const right = rect.left + bodyEl.clientWidth
      const bottom = rect.top + bodyEl.clientHeight
      const EDGE = 36
      const { clientX: px, clientY: py } = lastPointer
      let dx = 0
      let dy = 0
      if (py < rect.top + EDGE) dy = -Math.min(28, (rect.top + EDGE - py) / 2)
      else if (py > bottom - EDGE) dy = Math.min(28, (py - bottom + EDGE) / 2)
      if (px < rect.left + EDGE) dx = -Math.min(28, (rect.left + EDGE - px) / 2)
      else if (px > right - EDGE) dx = Math.min(28, (px - right + EDGE) / 2)
      if (dx === 0 && dy === 0) return
      bodyEl.scrollTop += dy
      bodyEl.scrollLeft += dx
      syncScroll()
      const hit = cellAtEvent(lastPointer)
      if (hit) sel.updateDrag(hit.r, hit.c)
    }, 16)
  }

  function onBodyPointerDown(e: PointerEvent): void {
    if (e.button === 2) return // 컨텍스트 메뉴는 별도 처리
    if (onScrollbar(e)) return // 스크롤바 드래그를 셀 선택으로 오인하지 않는다
    const hit = cellAtEvent(e)
    if (!hit) return
    rootEl?.focus()
    commitEdit()

    if (e.shiftKey) {
      sel.extendTo(hit.r, hit.c)
    } else {
      sel.beginDrag(hit.r, hit.c, e.ctrlKey || e.metaKey)
      capture(bodyEl, e.pointerId)
      startAutoScroll()
    }
    e.preventDefault()
  }

  function onBodyPointerMove(e: PointerEvent): void {
    lastPointer = { clientX: e.clientX, clientY: e.clientY }
    if (!sel.dragging) return
    const hit = cellAtEvent(e)
    if (hit) sel.updateDrag(hit.r, hit.c)
  }

  function onBodyPointerUp(e: PointerEvent): void {
    if (sel.dragging) {
      sel.endDrag()
      stopAutoScroll()
      release(bodyEl, e.pointerId)
    }
  }

  function onBodyDblClick(e: MouseEvent): void {
    if (onScrollbar(e)) return
    const hit = cellAtEvent(e)
    if (!hit) return
    sel.selectCell(hit.r, hit.c)
    if (!readonly) startEdit()
  }

  // --- 셀 편집 ---

  let editing = $state<{ r: number; c: number } | null>(null)
  let editValue = $state('')
  let editEl = $state<HTMLInputElement | null>(null)

  function cellText(viewRow: number, viewCol: number): string {
    const src = view.viewRows[viewRow]
    if (src === undefined) return ''
    return ds.rows[src]?.[view.srcCol(viewCol)] ?? ''
  }

  export function startEdit(initial?: string): void {
    if (readonly) return
    if (rowCount === 0 || colCount === 0) return
    const { r, c } = sel.active
    if (r >= rowCount || c >= colCount) return
    editing = { r, c }
    editValue = initial ?? cellText(r, c)
    scrollToCell(r, c)
  }

  $effect(() => {
    if (editing && editEl) {
      editEl.focus()
      editEl.select()
    }
  })

  function commitEdit(): void {
    if (!editing) return
    const { r, c } = editing
    const src = view.viewRows[r]
    editing = null
    if (src === undefined) return
    const srcCol = view.srcCol(c)
    if (ds.rows[src]?.[srcCol] !== editValue) onCommitCell(src, srcCol, editValue)
  }

  function cancelEdit(): void {
    editing = null
  }

  function onEditKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      commitEdit()
      moveActive(e.shiftKey ? -1 : 1, 0, false)
      rootEl?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      cancelEdit()
      rootEl?.focus()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      commitEdit()
      moveActive(0, e.shiftKey ? -1 : 1, false)
      rootEl?.focus()
    }
  }

  // --- 키보드 내비게이션 ---

  function moveActive(dr: number, dc: number, extend: boolean): void {
    if (rowCount === 0 || colCount === 0) return
    const r = Math.max(0, Math.min(rowCount - 1, sel.active.r + dr))
    const c = Math.max(0, Math.min(colCount - 1, sel.active.c + dc))
    if (extend) sel.extendTo(r, c)
    else sel.selectCell(r, c)
    scrollToCell(r, c)
  }

  function moveToEdge(dr: number, dc: number, extend: boolean): void {
    if (rowCount === 0 || colCount === 0) return
    const r = dr === 0 ? sel.active.r : dr < 0 ? 0 : rowCount - 1
    const c = dc === 0 ? sel.active.c : dc < 0 ? 0 : colCount - 1
    if (extend) sel.extendTo(r, c)
    else sel.selectCell(r, c)
    scrollToCell(r, c)
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (editing) return
    const mod = e.ctrlKey || e.metaKey
    const page = Math.max(1, Math.floor(viewportH / ROW_H) - 1)

    switch (e.key) {
      case 'ArrowDown':
        mod ? moveToEdge(1, 0, e.shiftKey) : moveActive(1, 0, e.shiftKey)
        break
      case 'ArrowUp':
        mod ? moveToEdge(-1, 0, e.shiftKey) : moveActive(-1, 0, e.shiftKey)
        break
      case 'ArrowRight':
        mod ? moveToEdge(0, 1, e.shiftKey) : moveActive(0, 1, e.shiftKey)
        break
      case 'ArrowLeft':
        mod ? moveToEdge(0, -1, e.shiftKey) : moveActive(0, -1, e.shiftKey)
        break
      case 'PageDown':
        moveActive(page, 0, e.shiftKey)
        break
      case 'PageUp':
        moveActive(-page, 0, e.shiftKey)
        break
      case 'Home':
        mod ? moveToEdge(-1, -1, e.shiftKey) : moveToEdge(0, -1, e.shiftKey)
        break
      case 'End':
        mod ? moveToEdge(1, 1, e.shiftKey) : moveToEdge(0, 1, e.shiftKey)
        break
      case 'Enter':
      case 'F2':
        startEdit()
        break
      case 'Tab':
        moveActive(0, e.shiftKey ? -1 : 1, false)
        break
      case 'Escape':
        sel.clear()
        break
      case 'Delete':
      case 'Backspace':
        if (!readonly) onDeleteContents()
        break
      case 'a':
      case 'A':
        if (mod) {
          sel.selectAll(rowCount - 1, colCount - 1)
          break
        }
        return typeToEdit(e)
      case 'c':
      case 'C':
        if (mod) {
          onCopy()
          break
        }
        return typeToEdit(e)
      case 'v':
      case 'V':
        if (mod) return // paste 이벤트에서 처리
        return typeToEdit(e)
      default:
        return typeToEdit(e)
    }
    e.preventDefault()
  }

  /** 인쇄 가능한 문자를 누르면 그 문자로 편집을 시작한다 (스프레드시트 관행) */
  function typeToEdit(e: KeyboardEvent): void {
    if (readonly) return // preventDefault보다 먼저 — 키를 삼키면 안 된다
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key.length !== 1) return
    e.preventDefault()
    startEdit(e.key)
  }

  function onPaste(e: ClipboardEvent): void {
    if (editing || readonly) return
    const text = e.clipboardData?.getData('text/plain')
    if (!text) return
    e.preventDefault()
    onPasteText(text)
  }

  // --- 헤더: 정렬 / 리사이즈 / 순서 변경 ---

  type HeadDrag =
    | { kind: 'resize'; viewCol: number; startX: number; startW: number }
    | { kind: 'maybe'; viewCol: number; startX: number; shift: boolean; ctrl: boolean }
    | { kind: 'reorder'; viewCol: number }

  let headDrag: HeadDrag | null = null
  /** 열 순서 변경 중 삽입 위치 표시 (뷰 인덱스, colCount면 맨 끝) */
  let dropCol = $state(-1)

  function onHeadPointerDown(e: PointerEvent, viewCol: number): void {
    if (e.button !== 0) return
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    rootEl?.focus()
    commitEdit()

    if (rect.right - e.clientX <= RESIZE_ZONE) {
      headDrag = {
        kind: 'resize',
        viewCol,
        startX: e.clientX,
        startW: widths[viewCol] ?? 120,
      }
    } else {
      headDrag = {
        kind: 'maybe',
        viewCol,
        startX: e.clientX,
        shift: e.shiftKey,
        ctrl: e.ctrlKey || e.metaKey,
      }
    }
    capture(el, e.pointerId)
    e.preventDefault()
  }

  function onHeadPointerMove(e: PointerEvent): void {
    const d = headDrag
    if (!d) return

    if (d.kind === 'resize') {
      ds.setColWidth(view.srcCol(d.viewCol), d.startW + (e.clientX - d.startX))
      return
    }
    if (d.kind === 'maybe') {
      if (Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD) return
      headDrag = { kind: 'reorder', viewCol: d.viewCol }
    }
    // 순서 변경 중 — 삽입 위치 계산
    const rect = bodyEl.getBoundingClientRect()
    const x = e.clientX - rect.left + bodyEl.scrollLeft
    let target = columnAt(offsets, Math.max(0, Math.min(totalW - 1, x)))
    // 칼럼 중앙을 넘으면 그 뒤로
    if (x > (offsets[target] ?? 0) + (widths[target] ?? 0) / 2) target++
    dropCol = Math.max(0, Math.min(colCount, target))
  }

  function onHeadPointerUp(e: PointerEvent): void {
    const d = headDrag
    headDrag = null
    release(e.currentTarget as HTMLElement, e.pointerId)

    if (!d) return
    if (d.kind === 'resize') return

    if (d.kind === 'maybe') {
      // 이동이 없었으므로 클릭으로 처리 — 헤더 클릭의 기본 동작은 **열 선택**이다.
      // 정렬은 우측의 별도 버튼이 담당한다(빈 열도 클릭만으로 선택·삭제할 수 있어야 하므로).
      selectColumn(d.viewCol, d.ctrl ? 'add' : d.shift ? 'extend' : 'set')
      dropCol = -1
      return
    }

    // reorder 확정
    const from = d.viewCol
    let to = dropCol
    if (to > from) to-- // 자신이 빠진 뒤의 인덱스
    if (to >= 0 && to !== from) onMoveCol(from, to)
    dropCol = -1
  }

  function onHeadDblClick(e: MouseEvent, viewCol: number): void {
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    if (rect.right - e.clientX <= RESIZE_ZONE) {
      ds.autoWidth(view.srcCol(viewCol))
      return
    }
    if (!readonly) startRenameHeader(viewCol)
  }

  /**
   * 열 전체 선택.
   *
   * 보이는 행이 0개여도(필터로 전부 걸러진 경우) 선택을 허용한다 — 그래야 그 상태에서도
   * 열 삭제 같은 조작이 가능하다. `r1 = -1`이 되지만 `fullySelectedCols`의 판정과 일관된다.
   */
  function selectColumn(viewCol: number, mode: 'set' | 'add' | 'extend'): void {
    const from = mode === 'extend' ? sel.anchor.c : viewCol
    sel.selectCols(from, viewCol, rowCount - 1, mode)
  }

  // --- 헤더명 변경 ---

  let renaming = $state<number | null>(null)
  let renameValue = $state('')
  let renameEl = $state<HTMLInputElement | null>(null)

  function startRenameHeader(viewCol: number): void {
    renaming = viewCol
    renameValue = ds.header[view.srcCol(viewCol)] ?? ''
  }

  $effect(() => {
    if (renaming !== null && renameEl) {
      renameEl.focus()
      renameEl.select()
    }
  })

  function commitRename(): void {
    const vc = renaming
    if (vc === null) return
    renaming = null
    const srcCol = view.srcCol(vc)
    const name = renameValue.trim()
    if (name !== '' && name !== ds.header[srcCol]) onRenameHeader(srcCol, name)
  }

  function onRenameKeyDown(e: KeyboardEvent): void {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      commitRename()
      rootEl?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      renaming = null
      rootEl?.focus()
    }
  }

  // --- 거터: 행 선택 / 순서 변경 ---

  type GutDrag =
    | { kind: 'maybe'; viewRow: number; startY: number; shift: boolean; ctrl: boolean }
    | { kind: 'reorder'; rows: number[] }

  let gutDrag: GutDrag | null = null
  let dropRow = $state(-1)

  function onGutPointerDown(e: PointerEvent, viewRow: number): void {
    if (e.button !== 0) return
    rootEl?.focus()
    commitEdit()
    const ctrl = e.ctrlKey || e.metaKey
    const shift = e.shiftKey

    // 이미 선택된 행에서 드래그를 시작하면 그 선택 전체를 옮기려는 의도로 본다
    const already = sel.isRowFullySelected(viewRow, colCount - 1)
    if (!already || ctrl || shift) {
      const from = shift ? sel.anchor.r : viewRow
      sel.selectRows(from, viewRow, colCount - 1, ctrl ? 'add' : shift ? 'extend' : 'set')
    }

    gutDrag = { kind: 'maybe', viewRow, startY: e.clientY, shift, ctrl }
    capture(e.currentTarget as HTMLElement, e.pointerId)
    e.preventDefault()
  }

  function onGutPointerMove(e: PointerEvent): void {
    const d = gutDrag
    if (!d) return

    if (d.kind === 'maybe') {
      if (Math.abs(e.clientY - d.startY) < DRAG_THRESHOLD) return
      if (readonly) {
        gutDrag = null
        return
      }
      if (view.isSorted) {
        onNotice('정렬을 해제해야 행 순서를 바꿀 수 있습니다')
        gutDrag = null
        return
      }
      const rows = sel.fullySelectedRows(colCount - 1)
      if (rows.length === 0) {
        gutDrag = null
        return
      }
      gutDrag = { kind: 'reorder', rows }
    }

    const rect = bodyEl.getBoundingClientRect()
    const y = e.clientY - rect.top + bodyEl.scrollTop
    let target = Math.floor(y / ROW_H)
    if (y > target * ROW_H + ROW_H / 2) target++
    dropRow = Math.max(0, Math.min(rowCount, target))
  }

  function onGutPointerUp(e: PointerEvent): void {
    const d = gutDrag
    gutDrag = null
    release(e.currentTarget as HTMLElement, e.pointerId)

    if (d?.kind === 'reorder' && dropRow >= 0) onMoveRows(d.rows, dropRow)
    dropRow = -1
  }

  /**
   * 우클릭 시, 커서 아래 대상이 선택에 포함되어 있지 않으면 그것을 먼저 선택한다
   * (스프레드시트 관행 — 메뉴 명령이 엉뚱한 대상에 적용되는 것을 막는다).
   *
   * 셀뿐 아니라 **행 번호와 헤더에서도** 같게 동작해야 한다. 그렇지 않으면
   * "행 번호 우클릭 → 행 삭제"가 왼쪽 클릭 한 번을 먼저 요구하고, 그 사이에 선택이
   * 비어 있어 메뉴 항목이 비활성으로 뜬다.
   */
  function onGridContextMenu(e: MouseEvent): void {
    e.preventDefault()

    if (bodyEl?.contains(e.target as Node)) {
      const hit = cellAtEvent(e)
      if (hit && !sel.ranges.some((r) => contains(r, hit.r, hit.c))) {
        sel.selectCell(hit.r, hit.c)
      }
    } else {
      const gt = (e.target as HTMLElement).closest?.('[role=rowheader]')
      const th = (e.target as HTMLElement).closest?.('[role=columnheader]')
      if (gt) {
        const r = Number(gt.getAttribute('aria-rowindex')) - 1
        if (r >= 0 && !sel.isRowFullySelected(r, colCount - 1)) {
          sel.selectRows(r, r, colCount - 1, 'set')
        }
      } else if (th) {
        const c = Number(th.getAttribute('aria-colindex')) - 1
        if (c >= 0 && !sel.isColFullySelected(c, rowCount - 1)) selectColumn(c, 'set')
      }
    }

    onContextMenu(e)
  }

  // --- 렌더링 보조 ---

  /**
   * 화면에 그릴 **절대** 행/열 인덱스. `{#each}`의 키로 이 절대값을 쓰는 것이 중요하다.
   *
   * 슬롯 번호(0..n)를 키로 쓰면 스크롤할 때마다 모든 슬롯의 내용이 바뀌어 43행 × 20열 전체가
   * 다시 그려진다(3행 스크롤과 32행 스크롤의 비용이 같아진다). 절대 인덱스를 키로 쓰면 Svelte가
   * 그대로 남는 행을 **이동만** 시키고, 새로 들어온 몇 행만 만든다.
   */
  const rowIdx = $derived(Array.from({ length: rowSlots }, (_, i) => firstRow + i))
  const colIdx = $derived(Array.from({ length: colSpan }, (_, i) => firstCol + i))

  const typeGlyph: Record<string, string> = { number: '#', date: '◷', string: 'T' }
  const typeName: Record<string, string> = { number: '숫자', date: '날짜', string: '문자열' }
</script>

<div
  class="grid"
  class:no-data={rowCount === 0}
  class:readonly
  bind:this={rootEl}
  tabindex="0"
  role="grid"
  aria-rowcount={rowCount}
  aria-colcount={colCount}
  onkeydown={onKeyDown}
  onpaste={onPaste}
  oncontextmenu={onGridContextMenu}
>
  <!-- 좌상단 코너: 전체 선택 -->
  <button
    class="corner"
    title="전체 선택 (Ctrl+A)"
    onclick={() => rowCount > 0 && sel.selectAll(rowCount - 1, colCount - 1)}
  >
    <span class="corner-mark"></span>
  </button>

  <!-- 헤더 페인 -->
  <div class="head-clip">
    <div class="head-track" bind:this={headTrack} style="width:{totalW}px">
      {#each view.viewCols as srcCol, viewCol (srcCol)}
        {@const st = view.sortStateOf(srcCol)}
        {@const filtered = !!view.getColumnFilter(srcCol)}
        <div
          class="th"
          role="columnheader"
          tabindex="-1"
          aria-colindex={viewCol + 1}
          aria-sort={st ? (st.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
          class:sel={sel.isColFullySelected(viewCol, rowCount - 1)}
          class:sorted={!!st}
          style:left="{offsets[viewCol]}px"
          style:width="{widths[viewCol]}px"
          onpointerdown={(e) => onHeadPointerDown(e, viewCol)}
          onpointermove={onHeadPointerMove}
          onpointerup={onHeadPointerUp}
          ondblclick={(e) => onHeadDblClick(e, viewCol)}
          title={ds.header[srcCol]}
        >
          {#if renaming === viewCol}
            <input
              class="rename"
              bind:this={renameEl}
              bind:value={renameValue}
              onkeydown={onRenameKeyDown}
              onblur={commitRename}
            />
          {:else}
            {@const type = ds.colTypes[srcCol] ?? 'string'}
            <span class="th-glyph" data-type={type} title={typeName[type]}>{typeGlyph[type]}</span>
            <span class="th-name">{ds.header[srcCol]}</span>

            <!-- 정렬 버튼. 헤더 본문 클릭은 열 선택이므로 정렬은 별도 버튼으로 분리했다. -->
            <button
              class="th-btn th-sort"
              class:on={!!st}
              title={st
                ? `정렬 ${st.dir === 'asc' ? '오름차순' : '내림차순'} — 클릭하면 ${st.dir === 'asc' ? '내림차순' : '해제'}`
                : '정렬 (Shift+클릭: 다중 정렬에 추가)'}
              onpointerdown={(e) => e.stopPropagation()}
              onclick={(e) => {
                e.stopPropagation()
                onSortToggle(srcCol, e.shiftKey)
              }}
            >
              <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
                <path
                  d="M5 0.6L8 4H2z"
                  fill="currentColor"
                  opacity={st ? (st.dir === 'asc' ? 1 : 0.22) : 0.55}
                />
                <path
                  d="M5 9.4L2 6h6z"
                  fill="currentColor"
                  opacity={st ? (st.dir === 'desc' ? 1 : 0.22) : 0.55}
                />
              </svg>
              {#if st && view.sorts.length > 1}<i>{st.rank}</i>{/if}
            </button>

            <button
              class="th-btn th-filter"
              class:on={filtered}
              title="칼럼 필터"
              onpointerdown={(e) => e.stopPropagation()}
              onclick={(e) => {
                e.stopPropagation()
                onOpenColumnFilter(srcCol, e.currentTarget as HTMLElement)
              }}
            >
              <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
                <path d="M0.5 1.5h9L6 5.6V9L4 7.7V5.6z" fill="currentColor" />
              </svg>
            </button>
            <span class="th-grip" aria-hidden="true"></span>
          {/if}
        </div>
      {/each}
      {#if dropCol >= 0}
        <span
          class="drop-v"
          style="left:{dropCol >= colCount ? totalW : (offsets[dropCol] ?? 0)}px"
        ></span>
      {/if}
    </div>
  </div>

  <!-- 거터 페인 (행 번호) -->
  <div class="gut-clip">
    <div class="gut-track" bind:this={gutTrack} style="height:{totalH}px">
      {#each rowIdx as r (r)}
        <div
          class="gt"
          role="rowheader"
          tabindex="-1"
          aria-rowindex={r + 1}
          class:sel={sel.isRowFullySelected(r, colCount - 1)}
          style:top="{r * ROW_H}px"
          onpointerdown={(e) => onGutPointerDown(e, r)}
          onpointermove={onGutPointerMove}
          onpointerup={onGutPointerUp}
        >
          {r + 1}
        </div>
      {/each}
      {#if dropRow >= 0}
        <span class="drop-h" style="top:{dropRow * ROW_H}px"></span>
      {/if}
    </div>
  </div>

  <!-- 본문 (유일한 스크롤 컨테이너) -->
  <div
    class="body"
    role="rowgroup"
    bind:this={bodyEl}
    onscroll={syncScroll}
    onpointerdown={onBodyPointerDown}
    onpointermove={onBodyPointerMove}
    onpointerup={onBodyPointerUp}
    onpointercancel={onBodyPointerUp}
    ondblclick={onBodyDblClick}
  >
    <div class="canvas" style="width:{totalW}px;height:{totalH}px">
      {#each rowIdx as r (r)}
        {@const src = view.viewRows[r]}
        <div class="tr" class:odd={r % 2 === 1} style:top="{r * ROW_H}px">
          {#each colIdx as c (c)}
            {@const srcCol = view.srcCol(c)}
            {@const text = ds.cell(src, srcCol)}
            <div
              class="td"
              data-type={ds.colTypes[srcCol] ?? 'string'}
              class:on={isSel(r, c)}
              class:active={sel.active.r === r && sel.active.c === c}
              class:find-hit={find.isHit(r, c)}
              class:find-cur={find.isCurrent(r, c)}
              style:left="{offsets[c]}px"
              style:width="{widths[c]}px"
            >
              {#if highlighting}
                {@const pieces = splitHighlight(text, matcher)}
                {#if pieces.length === 0}
                  {text}
                {:else}
                  {#each pieces as p, pi (pi)}{#if p.hit}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}
                {/if}
              {:else}
                {text}
              {/if}
            </div>
          {/each}
        </div>
      {/each}

      {#if editing && !readonly}
        <input
          class="editor"
          bind:this={editEl}
          bind:value={editValue}
          style:top="{editing.r * ROW_H}px"
          style:left="{offsets[editing.c]}px"
          style:width="{widths[editing.c]}px"
          onkeydown={onEditKeyDown}
          onblur={commitEdit}
        />
      {/if}

      {#if dropRow >= 0}
        <span class="drop-h wide" style="top:{dropRow * ROW_H}px;width:{totalW}px"></span>
      {/if}
      {#if dropCol >= 0}
        <span
          class="drop-v tall"
          style="left:{dropCol >= colCount ? totalW : (offsets[dropCol] ?? 0)}px;height:{totalH}px"
        ></span>
      {/if}
    </div>
  </div>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: var(--gutter-w) minmax(0, 1fr);
    grid-template-rows: var(--header-h) minmax(0, 1fr);
    height: 100%;
    min-height: 0;
    background: var(--bg);
    outline: none;
    font-family: var(--font-mono);
    font-size: var(--fs-cell);
    font-variant-numeric: tabular-nums;
    /* 셀 드래그 중 텍스트 선택 방지 */
    user-select: none;
  }

  /* --- 코너 --- */
  .corner {
    grid-area: 1 / 1;
    display: grid;
    place-items: center;
    background: var(--bg-header);
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    z-index: 3;
  }
  .corner-mark {
    width: 8px;
    height: 8px;
    border-right: 1.5px solid var(--text-faint);
    border-bottom: 1.5px solid var(--text-faint);
    transition: border-color var(--dur) var(--ease);
  }
  .corner:hover .corner-mark {
    border-color: var(--accent);
  }

  /* --- 헤더 --- */
  .head-clip {
    grid-area: 1 / 2;
    position: relative;
    overflow: hidden;
    background: var(--bg-header);
    border-bottom: 1px solid var(--border);
    z-index: 2;
  }
  .head-track {
    position: absolute;
    inset: 0 auto 0 0;
    height: 100%;
    will-change: transform;
  }

  .th {
    position: absolute;
    top: 0;
    height: 100%;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 6px 0 7px;
    border-right: 1px solid var(--border);
    cursor: pointer;
    overflow: hidden;
    transition: background var(--dur) var(--ease);
  }
  .th:hover {
    background: var(--bg-hover);
  }
  .th.sel {
    background: var(--sel-head);
  }
  .th.sorted .th-name {
    color: var(--text);
  }

  /* 타입 글리프에 색을 준다 — 넓은 표에서 칼럼 성격을 한눈에 훑게 하는 기능적 색상 */
  .th-glyph {
    flex: none;
    width: 9px;
    color: var(--text-faint);
    font-size: 10px;
    text-align: center;
    cursor: help;
  }
  .th-glyph[data-type='number'] {
    color: var(--c-num);
  }
  .th-glyph[data-type='date'] {
    color: var(--c-date);
  }

  .th-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-dim);
    /* 한글 칼럼명이 10.5px에서는 판독이 어려워 헤더만 조금 키운다 */
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  /* 헤더 우측 버튼(정렬·필터) — 평소에는 숨고, 활성 상태면 계속 보인다 */
  .th-btn {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1px;
    width: 15px;
    height: 15px;
    border-radius: 3px;
    color: var(--text-faint);
    opacity: 0;
    transition:
      opacity var(--dur) var(--ease),
      color var(--dur) var(--ease),
      background var(--dur) var(--ease);
  }
  .th:hover .th-btn {
    opacity: 1;
  }
  .th-btn:hover {
    background: var(--bg);
    color: var(--text);
  }
  .th-btn.on {
    opacity: 1;
  }
  .th-sort {
    position: relative;
  }
  .th-sort.on {
    color: var(--accent);
  }
  /*
   * 다중 정렬 우선순위 배지. 버튼 폭을 늘리지 않도록 절대 배치한다 —
   * 흐름에 넣으면 정렬을 걸 때마다 헤더 이름이 밀려 잘린다.
   */
  .th-sort i {
    position: absolute;
    right: -2px;
    bottom: -3px;
    font-style: normal;
    font-size: 8px;
    line-height: 1;
    font-weight: 700;
    text-shadow:
      0 0 2px var(--bg-header),
      0 0 2px var(--bg-header);
  }
  /* 필터는 정렬(앰버)과 구분되는 색으로 — 두 상태를 동시에 읽을 수 있어야 한다 */
  .th-filter.on {
    color: var(--c-filter);
  }

  /* 리사이즈 핸들 — 보이지 않지만 만져지는 영역 */
  .th-grip {
    position: absolute;
    top: 0;
    right: 0;
    width: 5px;
    height: 100%;
    cursor: col-resize;
  }
  .th-grip:hover {
    background: var(--accent-line);
  }

  .rename {
    width: 100%;
    height: 22px;
    padding: 0 4px;
    background: var(--bg);
    border: 1px solid var(--accent);
    border-radius: 3px;
    font-size: var(--fs-cell);
    outline: none;
  }

  /* --- 거터 --- */
  .gut-clip {
    grid-area: 2 / 1;
    position: relative;
    overflow: hidden;
    background: var(--bg-gutter);
    border-right: 1px solid var(--border);
    z-index: 1;
  }
  .gut-track {
    position: absolute;
    inset: 0 0 auto 0;
    will-change: transform;
  }
  .gt {
    position: absolute;
    left: 0;
    right: 0;
    height: var(--row-h);
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: 8px;
    color: var(--text-faint);
    font-size: 11px;
    cursor: pointer;
    transition:
      background var(--dur) var(--ease),
      color var(--dur) var(--ease);
  }
  .gt:hover {
    background: var(--bg-hover);
    color: var(--text-dim);
  }
  .gt.sel {
    background: var(--sel-head);
    color: var(--text);
  }

  /* --- 본문 --- */
  .body {
    grid-area: 2 / 2;
    position: relative;
    overflow: auto;
    overscroll-behavior: contain;
  }
  .canvas {
    position: relative;
  }

  .tr {
    position: absolute;
    left: 0;
    height: var(--row-h);
  }
  .tr.odd {
    background: var(--bg-zebra);
  }

  .td {
    position: absolute;
    top: 0;
    height: var(--row-h);
    display: flex;
    align-items: center;
    padding: 0 7px;
    border-right: 1px solid var(--border-soft);
    border-bottom: 1px solid var(--border-soft);
    white-space: pre;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text);
  }
  /*
   * 타입별 색조. 숫자·날짜 칼럼에 아주 옅은 색을 얹어 넓은 표에서 성격이 구분되게 한다.
   * 판독성이 우선이므로 색조는 본문 색에서 살짝 기울인 정도로만 둔다.
   */
  .td[data-type='number'] {
    justify-content: flex-end;
    color: var(--text-num);
  }
  .td[data-type='date'] {
    color: var(--text-date);
  }
  .td.on {
    background: var(--sel-bg);
  }
  .td.active {
    box-shadow: inset 0 0 0 2px var(--sel-line);
    background: var(--bg);
  }

  /*
   * 찾기 매치. 스마트 필터의 앰버 하이라이트와 색이 겹치지 않게 시안 계열을 쓰고,
   * 현재 매치는 링을 굵게 해 어디를 보고 있는지 즉시 알 수 있게 한다.
   */
  .td.find-hit {
    background: var(--find-bg);
  }
  .td.find-cur {
    background: var(--find-bg);
    box-shadow: inset 0 0 0 2px var(--find-cur);
  }
  .td :global(mark) {
    background: var(--hit-bg);
    color: var(--hit-text);
    border-radius: 2px;
    padding: 0 1px;
    margin: 0 -1px;
  }

  .editor {
    position: absolute;
    height: var(--row-h);
    padding: 0 6px;
    background: var(--bg-raised);
    border: 2px solid var(--sel-line);
    border-radius: 2px;
    font-size: var(--fs-cell);
    font-family: inherit;
    outline: none;
    z-index: 5;
    min-width: 90px;
  }

  /* --- 드래그 삽입 위치 표시 --- */
  .drop-v {
    position: absolute;
    top: 0;
    width: 2px;
    height: 100%;
    margin-left: -1px;
    background: var(--accent);
    z-index: 4;
    pointer-events: none;
  }
  .drop-v.tall {
    top: 0;
  }
  .drop-h {
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    margin-top: -1px;
    background: var(--accent);
    z-index: 4;
    pointer-events: none;
  }
  .drop-h.wide {
    right: auto;
  }
</style>
