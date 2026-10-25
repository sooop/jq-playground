<script lang="ts">
  /**
   * 그리드 워크벤치 — "표 하나를 훑고·걸러내고·찾고·내보내는" 묶음.
   *
   * `Grid` + 스마트 필터 + 칼럼 필터 드롭다운 + 열 관리 + 찾기 패널 + 내보내기 + 상태바 +
   * 컨텍스트 메뉴를 한 컴포넌트로 묶는다. 이 조각들은 전부 `ds/view/sel/find` 네 인스턴스에만
   * 의존하고 편집 Op에는 의존하지 않으므로, 읽기 전용 표(jq 출력)와 편집 가능한 표(CSV)가
   * 같은 껍데기를 쓸 수 있다. 툴바의 모드 고유 버튼은 `toolbarStart`/`toolbarEnd` 스니펫으로
   * 끼워 넣고, 컨텍스트 메뉴는 기본 항목을 받아 가공하는 `contextItems`로 확장한다.
   *
   * 편집 콜백을 주지 않으면(또는 `readonly`) 셀 편집·붙여넣기·행 이동은 일어나지 않는다.
   * 열 순서 변경만은 기본 구현이 있다 — 뷰 조작이라 히스토리가 없어도 되고, jq 출력 뷰도
   * 원래 허용하던 기능이기 때문이다.
   */
  import type { Snippet } from 'svelte'
  import { writeTable } from '../data/clipboard'
  import type { Dataset } from '../data/dataset.svelte'
  import { buildMatrix, runExport } from '../data/export'
  import type { FindStore } from '../data/findState.svelte'
  import type { SelectionStore } from '../data/selection.svelte'
  import { toggleSort } from '../data/sort'
  import type { ExportOptions } from '../data/types'
  import type { View } from '../data/view.svelte'
  import { num } from '../util/format'
  import ColumnFilterMenu from './ColumnFilterMenu.svelte'
  import ColumnManager from './ColumnManager.svelte'
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte'
  import ExportDialog from './ExportDialog.svelte'
  import FindPanel from './FindPanel.svelte'
  import Grid from './Grid.svelte'
  import SmartFilter from './SmartFilter.svelte'
  import StatusBar from './StatusBar.svelte'
  import { anchor } from './feedback/anchors'
  import { feedback } from './feedback/feedback.svelte'
  import PanelNotice from './feedback/PanelNotice.svelte'

  type NoticeKind = 'info' | 'ok' | 'warn'

  interface Props {
    ds: Dataset
    view: View
    sel: SelectionStore
    find: FindStore
    /** 읽기 전용 표(jq 출력 등). 편집 계열 상호작용을 Grid 단에서 막는다. */
    readonly?: boolean
    /** Grid 로 그대로 전달하는 표시 옵션 — 행 높이(px)·줄바꿈·왼쪽 고정 열 수 */
    rowH?: number
    wrap?: boolean
    frozen?: number
    /** 정규식 토글 상태를 기억할 localStorage 키 — 모드마다 달라야 서로 전이되지 않는다 */
    filterStorageKey?: string
    /** 툴바 왼쪽(스마트 필터 앞)·오른쪽(열 관리 뒤)에 끼울 모드 고유 버튼 */
    toolbarStart?: Snippet
    toolbarEnd?: Snippet
    /** 상태바 우측 정보 */
    encoding?: string
    docName?: string | null
    /**
     * 컨텍스트 메뉴 항목. 기본 항목(복사·열/행 숨기기·숨김 모두 해제·찾기·내보내기)을 받아
     * 그대로 돌려주거나 사이에 끼워 넣는다. 없으면 기본 항목만 쓴다.
     */
    contextItems?: (defaults: MenuItem[], e: MouseEvent) => MenuItem[]
    onNotice?: (msg: string, kind?: NoticeKind) => void
    /**
     * 피드백 범위. 알림 배너가 앵커 `<scope>.panel`, 내보내기 버튼이 `<scope>.export`가 된다.
     * 한 화면에 워크벤치가 둘 이상(jq 출력 그리드와 뷰어) 있으면 서로 달라야 한다.
     */
    noticeScope?: string
    // --- 편집 콜백 (readonly면 Grid가 부르지 않는다) ---
    onCommitCell?: (srcRow: number, srcCol: number, value: string) => void
    onRenameHeader?: (srcCol: number, name: string) => void
    onMoveCol?: (fromView: number, toView: number) => void
    onMoveRows?: (viewRows: number[], toViewRow: number) => void
    onPasteText?: (text: string) => void
    onDeleteContents?: () => void
    onOpenReplace?: () => void
  }

  let {
    ds,
    view,
    sel,
    find,
    readonly = false,
    rowH = 28,
    wrap = false,
    frozen = 0,
    filterStorageKey = 'regexMode',
    toolbarStart,
    toolbarEnd,
    encoding = 'utf-8',
    docName = null,
    contextItems,
    onNotice,
    noticeScope = 'grid',
    onCommitCell,
    onRenameHeader,
    onMoveCol,
    onMoveRows,
    onPasteText,
    onDeleteContents,
    onOpenReplace,
  }: Props = $props()

  /**
   * 그리드 조작 결과. 컨텍스트 메뉴 항목·닫힌 팝오버는 앵커가 될 수 없으므로 패널 배너로 보낸다.
   * 같은 key 라 새 알림이 이전 것을 교체한다(ok→info, warn은 사용자가 닫거나 다음 알림이 올 때까지).
   */
  const notice = (msg: string, kind: NoticeKind = 'info') => {
    if (onNotice) return onNotice(msg, kind)
    feedback.report({
      key: `${noticeScope}.notice`,
      kind: kind === 'warn' ? 'warn' : 'info',
      title: msg,
      anchors: [`${noticeScope}.panel`],
    })
  }

  let grid = $state<Grid | null>(null)
  let filterBar = $state<SmartFilter | null>(null)
  let findPanel = $state<FindPanel | null>(null)

  const viewColCount = $derived(view.viewCols.length)

  // --- 정렬 / 열 이동 (뷰 조작 — 히스토리 불필요) ---

  function sortByCol(srcCol: number, additive: boolean): void {
    view.sorts = toggleSort(view.sorts, srcCol, additive)
    sel.clear() // 뷰 좌표의 의미가 바뀐다
  }

  /** 기본 열 순서 변경 — CSV 모드의 구현과 같은 알고리즘이되 히스토리 없이 바로 적용한다 */
  function moveColDefault(fromView: number, toView: number): void {
    const before = ds.colOrder.slice()
    const visible = view.viewCols.slice()
    if (fromView < 0 || fromView >= visible.length) return
    const reordered = visible.slice()
    const [moved] = reordered.splice(fromView, 1)
    reordered.splice(Math.max(0, Math.min(reordered.length, toView)), 0, moved)
    const hidden = view.hiddenCols
    const after: number[] = []
    let k = 0
    for (const c of before) after.push(hidden.has(c) ? c : reordered[k++])
    if (after.length !== before.length) return
    ds.apply({ t: 'setColOrder', before, after })
    const inverse: number[] = new Array(visible.length)
    for (let i = 0; i < visible.length; i++) inverse[i] = reordered.indexOf(visible[i])
    sel.remapCols(inverse)
  }

  // --- 복사 ---

  async function copySelection(): Promise<void> {
    if (sel.ranges.length === 0) {
      notice('복사할 선택이 없습니다')
      return
    }
    const { matrix, truncatedFromMultiRange } = buildMatrix(ds, view, sel, {
      scope: 'selection',
      format: 'tsv',
      target: 'clipboard',
      includeHeader: false,
      applyColOrder: true,
      quoting: 'minimal',
      newline: '\n',
      bom: false,
    })
    if (matrix.length === 0) return
    await writeTable(matrix, { headerRow: false })
    if (truncatedFromMultiRange) notice('여러 범위를 감싸는 사각형으로 복사했습니다 (선택 밖은 빈 값)', 'warn')
    else notice(`${num(matrix.length)}행 × ${matrix[0].length}열 복사`, 'ok')
  }

  // --- 숨기기 ---

  function hideSelectedCols(): void {
    const viewCols = sel.fullySelectedCols(view.visibleCount - 1)
    if (viewCols.length === 0) return
    const srcCols = viewCols.map((c) => view.srcCol(c))
    if (!view.hideCols(srcCols)) {
      notice('모든 열을 숨길 수는 없습니다', 'warn')
      return
    }
    sel.clear()
    notice(`${num(srcCols.length)}열 숨김`, 'ok')
  }

  function hideSelectedRows(): void {
    const viewRows = sel.fullySelectedRows(viewColCount - 1)
    if (viewRows.length === 0) return
    const srcRows = viewRows.map((r) => view.viewRows[r]).filter((v) => v !== undefined)
    if (srcRows.length === 0) return
    view.hideRows(srcRows)
    sel.clear()
    notice(`${num(srcRows.length)}행 숨김`, 'ok')
  }

  function showAllHidden(): void {
    const c = view.hiddenColCount
    const r = view.hiddenRowCount
    if (c === 0 && r === 0) return
    view.showAll()
    const parts: string[] = []
    if (c > 0) parts.push(`${num(c)}열`)
    if (r > 0) parts.push(`${num(r)}행`)
    notice(`${parts.join(' · ')} 숨김 해제`, 'ok')
  }

  // --- 컨텍스트 메뉴 ---

  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null)

  function openContextMenu(e: MouseEvent): void {
    const rowSel = sel.fullySelectedRows(viewColCount - 1)
    const colSel = sel.fullySelectedCols(view.visibleCount - 1)
    const hasSel = sel.ranges.length > 0
    const n = (k: number) => (k > 1 ? ` (${k})` : '')
    const hiddenTotal = view.hiddenColCount + view.hiddenRowCount
    const defaults: MenuItem[] = [
      { label: '복사', accel: 'c', hint: 'Ctrl C', disabled: !hasSel, run: () => void copySelection() },
      { label: '', sep: true },
      { label: `행 숨기기${n(rowSel.length)}`, accel: 'h', disabled: rowSel.length === 0, run: hideSelectedRows },
      { label: `열 숨기기${n(colSel.length)}`, accel: 'i', disabled: colSel.length === 0, run: hideSelectedCols },
      {
        label: `숨김 모두 해제${hiddenTotal > 0 ? ` (${hiddenTotal})` : ''}`,
        accel: 'u',
        disabled: hiddenTotal === 0,
        run: showAllHidden,
      },
      { label: '', sep: true },
      { label: '찾기…', accel: 'f', hint: 'Ctrl F', run: openFind },
      { label: '내보내기…', accel: 'x', hint: 'Ctrl E', run: () => (showExport = true) },
    ]
    menu = { x: e.clientX, y: e.clientY, items: contextItems ? contextItems(defaults, e) : defaults }
  }

  // --- 칼럼 필터 / 열 관리 / 내보내기 / 찾기 ---

  let colMenu = $state<{ col: number; anchor: HTMLElement } | null>(null)
  let colManagerAnchor = $state<HTMLElement | null>(null)
  let showExport = $state(false)

  export function openFind(): void {
    find.open = true
    requestAnimationFrame(() => findPanel?.focus())
  }

  export function closeFind(): void {
    find.open = false
    find.reset()
    grid?.focusGrid()
  }

  function gotoHit(hit: { r: number; c: number } | null): void {
    if (!hit) return
    sel.selectCell(hit.r, hit.c)
    grid?.scrollToCell(hit.r, hit.c)
  }

  async function doExport(opts: ExportOptions): Promise<void> {
    showExport = false
    const id = `${noticeScope}.export`
    try {
      const res = await runExport(ds, view, sel, opts)
      feedback.clear(id)
      if (!res.ok) {
        // 다이얼로그는 이미 닫혔다. 버튼이 아니라 패널에 경고로 남긴다.
        feedback.report({
          key: id,
          kind: 'warn',
          title: res.message,
          anchors: [`${noticeScope}.panel`, id],
          actions: [{ label: '내보내기 설정', run: () => (showExport = true) }],
        })
        return
      }
      feedback.ok(id, '내보냄')
      // 결과 메시지(행×열·파일명)는 길어서 버튼 칩에 담지 않고 배너에 남긴다
      feedback.report({ key: `${noticeScope}.notice`, kind: 'info', title: res.message, anchors: [`${noticeScope}.panel`] })
    } catch (e) {
      feedback.report({
        key: id,
        kind: 'error',
        title: '내보내지 못했습니다',
        detail: e instanceof Error ? e.message : String(e),
        anchors: [id],
        actions: [{ label: '설정 다시 열기', run: () => (showExport = true) }],
      })
    }
  }

  // --- 외부에 노출 ---

  export function focusGrid(): void {
    grid?.focusGrid()
  }
  export function scrollToCell(r: number, c: number): void {
    grid?.scrollToCell(r, c)
  }
  export function remeasure(): void {
    grid?.remeasure()
  }
  export function focusFilter(): void {
    filterBar?.focus()
  }
  export function openExport(): void {
    showExport = true
  }
  export function closeAllPopups(): void {
    menu = null
    colMenu = null
    colManagerAnchor = null
  }
  /** 떠 있는 오버레이가 있으면 하나 닫고 true. 모드의 Escape 처리 체인에서 먼저 부른다. */
  export function closeTopOverlay(): boolean {
    if (menu || colMenu || colManagerAnchor) {
      closeAllPopups()
      return true
    }
    if (showExport) {
      showExport = false
      return true
    }
    if (find.open) {
      closeFind()
      return true
    }
    return false
  }

  function inEditable(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null
    if (!el) return false
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
  }

  /**
   * 워크벤치 공통 단축키 — `/` 필터, Ctrl+F 찾기, F3 순회, Ctrl+E 내보내기, Escape.
   * 모드가 자기 단축키를 먼저 본 뒤 남는 것을 넘긴다. 처리했으면 true.
   */
  export function handleKeydown(e: KeyboardEvent): boolean {
    const mod = e.ctrlKey || e.metaKey
    const take = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    if (!inEditable(e.target) && !mod && !e.altKey && e.key === '/') {
      take()
      filterBar?.focus()
      return true
    }
    if (mod && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
      take()
      if (find.open) findPanel?.focus()
      else openFind()
      return true
    }
    if (e.key === 'F3' && find.open) {
      take()
      gotoHit(find.step(e.shiftKey ? -1 : 1))
      return true
    }
    if (mod && (e.key === 'e' || e.key === 'E')) {
      take()
      showExport = true
      return true
    }
    if (e.key === 'Escape' && closeTopOverlay()) {
      take()
      return true
    }
    return false
  }
</script>

<header class="toolbar">
  {@render toolbarStart?.()}

  <SmartFilter bind:this={filterBar} {view} totalRows={ds.rowCount} storageKey={filterStorageKey} />

  {#if view.sorts.length > 0 || view.activeColumnFilterCount > 0}
    <button
      class="btn"
      onclick={() => {
        view.sorts = []
        view.clearColumnFilters()
        sel.clear()
      }}
      title="정렬과 칼럼 필터를 모두 해제"
    >
      초기화
    </button>
  {/if}

  <span class="divider"></span>

  <button
    class="btn"
    class:on={view.hiddenColCount > 0}
    onclick={(e) => (colManagerAnchor = colManagerAnchor ? null : (e.currentTarget as HTMLElement))}
    title="열 관리 — 열을 켜고 끄기"
  >
    열 관리{view.hiddenColCount > 0 ? ` ${view.hiddenColCount}` : ''}
  </button>

  <button
    class="btn"
    title="내보내기 (Ctrl+E)"
    {@attach anchor(`${noticeScope}.export`)}
    onclick={() => (showExport = true)}
  >
    내보내기
  </button>

  {@render toolbarEnd?.()}
</header>

<PanelNotice scope={noticeScope} placement="top" />

<div class="main">
  <Grid
    bind:this={grid}
    {ds}
    {view}
    {sel}
    {find}
    {readonly}
    {rowH}
    {wrap}
    {frozen}
    onCommitCell={onCommitCell ?? (() => {})}
    onRenameHeader={onRenameHeader ?? (() => {})}
    onMoveCol={onMoveCol ?? moveColDefault}
    onMoveRows={onMoveRows ?? (() => {})}
    onSortToggle={sortByCol}
    onOpenColumnFilter={(col, anchor) => (colMenu = { col, anchor })}
    onContextMenu={openContextMenu}
    onCopy={() => void copySelection()}
    onPasteText={onPasteText ?? (() => {})}
    onDeleteContents={onDeleteContents ?? (() => {})}
    onNotice={(m) => notice(m, 'warn')}
  />
  {#if view.visibleCount === 0 && ds.rowCount > 0}
    <div class="empty-filter">
      <p>조건에 맞는 행이 없습니다</p>
      <button
        class="btn outline"
        onclick={() => {
          view.clearAll()
          filterBar?.clear()
        }}
      >
        필터 모두 해제
      </button>
    </div>
  {/if}
  {#if find.open}
    <FindPanel
      bind:this={findPanel}
      {ds}
      {view}
      {find}
      onGoto={gotoHit}
      onClose={closeFind}
      onOpenReplace={onOpenReplace ?? (() => {})}
    />
  {/if}
</div>

<StatusBar {ds} {view} {sel} {encoding} {docName} onShowAllHidden={showAllHidden} />

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = null)} />
{/if}

{#if colMenu}
  <ColumnFilterMenu
    {ds}
    {view}
    col={colMenu.col}
    anchor={colMenu.anchor}
    onClose={() => {
      colMenu = null
      sel.clear()
    }}
  />
{/if}

{#if colManagerAnchor}
  <ColumnManager
    {ds}
    {view}
    anchor={colManagerAnchor}
    onClose={() => (colManagerAnchor = null)}
    onNotice={(m, k) => notice(m, k ?? 'info')}
  />
{/if}

{#if showExport}
  <ExportDialog {ds} {view} {sel} onRun={(o) => void doExport(o)} onClose={() => (showExport = false)} />
{/if}

<style>
  .main {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .empty-filter {
    position: absolute;
    inset: var(--header-h) 0 0 var(--gutter-w);
    display: grid;
    place-content: center;
    gap: 10px;
    justify-items: center;
    color: var(--text-dim);
    background: var(--bg);
    z-index: 5;
  }
  .empty-filter p {
    margin: 0;
    font-size: 13px;
  }
</style>
