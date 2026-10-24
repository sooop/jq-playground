<script lang="ts">
  /**
   * 출력 패널 — JSON 뷰(가상 스크롤 + 검색)와 CSV 그리드(읽기 전용 GridWorkbench)를 전환한다.
   *
   * 에러가 나면 결과를 지우지 않고 흐리게 남긴 뒤 "이전 결과" 라벨을 붙인다 — 쿼리를 고치는
   * 중에 화면이 비어 버리면 뭘 고치는지 알 수 없기 때문이다(원본 `OutputPanel.ts:496-532`).
   */
  import { untrack } from 'svelte'
  import { Dataset } from '../../../lib/data/dataset.svelte'
  import { FindStore } from '../../../lib/data/findState.svelte'
  import { SelectionStore } from '../../../lib/data/selection.svelte'
  import { View } from '../../../lib/data/view.svelte'
  import { finalize } from '../../../lib/parse/detect'
  import type { MenuItem } from '../../../lib/ui/ContextMenu.svelte'
  import GridWorkbench from '../../../lib/ui/GridWorkbench.svelte'
  import { toasts } from '../../../lib/ui/toasts.svelte'
  import { downloadText } from '../core/file-handler'
  import { matrixToCSV } from '../core/csv-converter'
  import { jq } from '../jqState.svelte'
  import OutputJson from './OutputJson.svelte'

  interface Props {
    /** 표 결과를 전체 화면 뷰어로 확대한다 */
    onExpand: () => void
  }
  let { onExpand }: Props = $props()

  // 출력 패널 전용 인스턴스 — 뷰어는 자기 인스턴스를 만든다(정렬·열 순서가 출력에 번지지 않도록)
  const ds = new Dataset()
  const view = new View(ds)
  const sel = new SelectionStore()
  const find = new FindStore(ds, view, sel, 'jq.')

  let json = $state<OutputJson | null>(null)
  let bench = $state<GridWorkbench | null>(null)
  let searchOpen = $state(false)
  let searchTerm = $state('')
  let searchInfo = $state('')
  let searchEl = $state<HTMLInputElement | null>(null)
  let searchDebounce: ReturnType<typeof setTimeout> | null = null

  const isGrid = $derived(jq.format === 'csv')
  const hasResult = $derived(jq.resultText !== null || jq.matrix !== null)

  // ── 결과 → 그리드 ──────────────────────────────────────────────────────────

  // jq 결과 행렬이 바뀔 때마다 데이터셋을 갈아 끼운다.
  // 텍스트로 직렬화했다가 다시 파싱하지 않고 `finalize` 로 바로 넣는다.
  //
  // 적재 본문은 반드시 `untrack` 안에서 돌린다 — `loadParsed` 는 쓰면서 동시에
  // `ds.rows` 를 다시 읽으므로(검색 인덱스·열 폭 추정), 추적되면 effect 가 자기 쓰기에
  // 반응해 무한 루프가 된다(svelte: effect_update_depth_exceeded).
  $effect(() => {
    const m = jq.matrix
    if (!m) return
    untrack(() => {
      const pr = finalize([m.header, ...m.rows], ',', true, false)
      ds.loadParsed(pr, jq.inputName ?? 'jq 결과')
      view.clearAll()
      sel.clear()
    })
  })

  // ── 검색(JSON 뷰 / 그리드 공통 진입점) ─────────────────────────────────────

  export function openSearch(): void {
    if (isGrid) {
      bench?.openFind()
      return
    }
    searchOpen = true
    requestAnimationFrame(() => {
      searchEl?.focus()
      searchEl?.select()
    })
  }

  function closeSearch(): void {
    searchOpen = false
    searchTerm = ''
    searchInfo = ''
    json?.search('')
  }

  function runSearch(): void {
    const r = json?.search(searchTerm)
    if (!searchTerm) {
      searchInfo = ''
      return
    }
    searchInfo = r && r.total > 0 ? `1 / ${r.total}` : '결과 없음'
  }

  function onSearchInput(): void {
    if (searchDebounce) clearTimeout(searchDebounce)
    searchDebounce = setTimeout(runSearch, 200)
  }

  function step(dir: 1 | -1): void {
    if (dir === 1) json?.nextMatch()
    else json?.prevMatch()
    const info = json?.matchInfo()
    searchInfo = info ? `${info.current} / ${info.total}` : '결과 없음'
  }

  function onSearchKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      step(e.shiftKey ? -1 : 1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeSearch()
    }
  }

  // ── 복사 / 내려받기 ────────────────────────────────────────────────────────

  async function copyOut(): Promise<void> {
    const text = isGrid
      ? matrixToCSV(jq.matrix?.header ?? [], jq.matrix?.rows ?? [])
      : (json?.fullText() ?? jq.resultText ?? '')
    if (!text) {
      toasts.push('복사할 결과가 없습니다.', 'warn')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      toasts.push('결과를 클립보드에 복사했습니다.', 'ok')
    } catch {
      toasts.push('클립보드 복사에 실패했습니다.', 'warn')
    }
  }

  function downloadOut(): void {
    const text = isGrid
      ? matrixToCSV(jq.matrix?.header ?? [], jq.matrix?.rows ?? [])
      : (jq.resultText ?? '')
    if (!text) {
      toasts.push('내려받을 결과가 없습니다.', 'warn')
      return
    }
    downloadText(text, isGrid ? 'output.csv' : 'output.json')
  }

  // ── 노출 API ───────────────────────────────────────────────────────────────

  export function focusOutput(): void {
    if (isGrid) bench?.focusGrid()
    else json?.focusView()
  }
  export function remeasure(): void {
    bench?.remeasure()
  }
  export function closePopups(): void {
    bench?.closeAllPopups()
  }
  export function closeTop(): boolean {
    if (searchOpen) {
      closeSearch()
      return true
    }
    return bench?.closeTopOverlay() ?? false
  }
  export function gridKeydown(e: KeyboardEvent): boolean {
    return isGrid ? (bench?.handleKeydown(e) ?? false) : false
  }

  function contextItems(defaults: MenuItem[]): MenuItem[] {
    return [
      ...defaults,
      { label: '', sep: true },
      { label: '확대해서 보기', accel: 'e', run: onExpand },
    ]
  }

  const stats = $derived.by(() => {
    const out: string[] = []
    if (jq.execMs !== undefined) out.push(jq.execMs < 1 ? '<1ms' : `${jq.execMs.toFixed(1)}ms`)
    if (isGrid && jq.matrix) {
      out.push(`${jq.matrix.rows.length.toLocaleString()}행`)
      out.push(`${jq.matrix.header.length.toLocaleString()}열`)
    } else if (jq.resultText) {
      out.push(`${jq.resultText.split('\n').length.toLocaleString()}줄`)
      out.push(jq.format)
    }
    if (jq.lastRunAt) out.push(jq.lastRunAt)
    return out
  })
</script>

<section class="panel" aria-label="출력 결과">
  <header class="panel-head">
    <span class="panel-title">
      Output
      {#if jq.loading}<span class="chip">실행 중…</span>{/if}
      {#if jq.stale}<span class="chip prev">이전 결과</span>{/if}
    </span>
    <div class="panel-actions">
      <button
        class="btn"
        class:on={jq.autoPlay}
        title="자동 실행 켜기/끄기 (Ctrl+Shift+E)"
        onclick={() => jq.toggleAutoPlay()}
      >
        {jq.autoPlay ? '자동 ⏸' : '자동 ▶'}
      </button>
      <select class="field fmt" bind:value={jq.format} aria-label="출력 형식">
        <option value="json">JSON</option>
        <option value="csv">CSV</option>
      </select>
      {#if isGrid}
        <button class="btn outline" title="전체 화면 뷰어로 확대" onclick={onExpand}>확대</button>
      {/if}
      <button class="btn" title="찾기 (Ctrl+F)" onclick={openSearch}>찾기</button>
      <button class="btn" onclick={() => void copyOut()}>복사</button>
      <button class="btn" onclick={downloadOut}>내려받기</button>
      <button
        class="btn icon"
        title={jq.maximized ? '출력 패널 복원 (Ctrl+Shift+M / Esc)' : '출력 패널 최대화 (Ctrl+Shift+M)'}
        onclick={() => (jq.maximized = !jq.maximized)}
      >
        {jq.maximized ? '⤡' : '⤢'}
      </button>
    </div>
  </header>

  {#if stats.length > 0}
    <div class="stats">
      {#each stats as s}<span class="stat">{s}</span>{/each}
    </div>
  {/if}

  {#if searchOpen && !isGrid}
    <div class="searchbar">
      <input
        bind:this={searchEl}
        class="field"
        type="text"
        placeholder="결과에서 찾기..."
        bind:value={searchTerm}
        oninput={onSearchInput}
        onkeydown={onSearchKeydown}
      />
      <span class="count">{searchInfo}</span>
      <button class="btn icon" title="이전 (Shift+Enter)" onclick={() => step(-1)}>↑</button>
      <button class="btn icon" title="다음 (Enter)" onclick={() => step(1)}>↓</button>
      <button class="btn icon" title="닫기 (Esc)" onclick={closeSearch}>×</button>
    </div>
  {/if}

  {#if jq.error}
    <p class="err" role="status">{jq.error}</p>
  {/if}

  <div class="panel-body">
    {#if jq.engine === 'loading'}
      <p class="note">jq 엔진을 불러오는 중입니다… (처음 한 번만 CDN에서 받아 이 브라우저에 저장합니다)</p>
    {:else if jq.engine === 'failed'}
      <p class="note warn">
        jq 엔진을 불러오지 못했습니다. 네트워크를 확인한 뒤 다시 실행하세요.
        {#if jq.engineError}<br /><span class="sub">{jq.engineError}</span>{/if}
      </p>
    {:else if !hasResult}
      <p class="note">입력과 쿼리를 넣으면 결과가 여기에 나옵니다.</p>
    {:else if isGrid}
      <div class="grid-wrap" class:stale={jq.stale}>
        <GridWorkbench
          bind:this={bench}
          {ds}
          {view}
          {sel}
          {find}
          readonly
          filterStorageKey="jq.regexMode"
          {contextItems}
        />
      </div>
    {:else}
      <OutputJson bind:this={json} text={jq.resultText ?? ''} stale={jq.stale} />
    {/if}
  </div>
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 7px;
    overflow: hidden;
  }

  .panel-head {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex: none;
    height: var(--header-h);
    padding: 0 6px;
    background: var(--bg-header);
    border-bottom: 1px solid var(--border);
  }

  .panel-title {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding-left: 4px;
    font-size: var(--fs-label);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
    white-space: nowrap;
  }
  .chip {
    padding: 0 5px;
    border-radius: 3px;
    background: var(--accent-soft);
    color: var(--accent);
    text-transform: none;
    letter-spacing: 0;
    font-size: 10px;
    line-height: 15px;
  }
  .chip.prev {
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--text-faint);
  }

  .panel-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .panel-actions :global(.btn) {
    height: 22px;
    padding: 0 7px;
    font-size: var(--fs-label);
  }
  .fmt {
    height: 22px;
    padding: 0 4px;
    font-size: var(--fs-label);
  }

  .stats {
    display: flex;
    gap: 10px;
    flex: none;
    padding: 3px 10px;
    border-bottom: 1px solid var(--border-soft);
    font-size: var(--fs-label);
    color: var(--text-faint);
  }
  .stat {
    font-family: var(--font-mono);
  }

  .searchbar {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: none;
    padding: 5px 7px;
    border-bottom: 1px solid var(--border-soft);
  }
  .searchbar .field {
    flex: 1;
    min-width: 0;
  }
  .count {
    min-width: 62px;
    text-align: right;
    font-size: var(--fs-label);
    color: var(--text-faint);
  }

  .err {
    margin: 0;
    flex: none;
    padding: 5px 10px;
    background: var(--accent-soft);
    border-bottom: 1px solid var(--border-soft);
    color: var(--danger);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    white-space: pre-wrap;
    max-height: 5.4em;
    overflow-y: auto;
  }

  .panel-body {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .note {
    margin: auto;
    padding: 18px;
    text-align: center;
    color: var(--text-faint);
    line-height: 1.6;
  }
  .note.warn {
    color: var(--danger);
  }
  .sub {
    color: var(--text-faint);
    font-size: var(--fs-label);
  }

  .grid-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .grid-wrap.stale {
    opacity: 0.42;
  }
</style>
