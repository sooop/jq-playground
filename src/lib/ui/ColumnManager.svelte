<script lang="ts">
  import type { Dataset } from '../data/dataset.svelte'
  import type { View } from '../data/view.svelte'
  import { num } from '../util/format'
  import { dismissable } from './dismiss'

  interface Props {
    ds: Dataset
    view: View
    /** 패널을 띄울 기준 요소 */
    anchor: HTMLElement
    onClose: () => void
    onNotice: (msg: string, kind?: 'info' | 'ok' | 'warn') => void
  }
  let { ds, view, anchor, onClose, onNotice }: Props = $props()

  let search = $state('')
  let searchEl = $state<HTMLInputElement | null>(null)

  $effect(() => {
    requestAnimationFrame(() => searchEl?.focus())
  })

  /** 빈 열은 한눈에 알아볼 수 있게 표시한다 — 정리할 때 가장 먼저 끄는 대상이다 */
  const emptySet = $derived.by(() => {
    void ds.version
    return new Set(ds.emptyCols())
  })

  /**
   * 목록은 **화면 순서(colOrder)**로 보여준다. 숨긴 열도 자리를 지키므로,
   * 다시 켰을 때 어디로 돌아올지 목록에서 그대로 예상할 수 있다.
   */
  const rows = $derived.by(() => {
    void ds.version
    const q = search.trim().toLowerCase()
    return ds.colOrder
      .map((srcCol, pos) => ({
        srcCol,
        pos,
        name: ds.header[srcCol] ?? '',
        type: ds.colTypes[srcCol] ?? 'string',
        visible: !view.hiddenCols.has(srcCol),
        empty: emptySet.has(srcCol),
      }))
      .filter((r) => q === '' || r.name.toLowerCase().includes(q))
  })

  const visibleCount = $derived(view.viewCols.length)
  const emptyVisible = $derived(
    ds.emptyCols().filter((c) => !view.hiddenCols.has(c)).length,
  )

  function toggle(srcCol: number): void {
    if (view.hiddenCols.has(srcCol)) {
      const next = new Set(view.hiddenCols)
      next.delete(srcCol)
      view.hiddenCols = next
      return
    }
    if (!view.hideCols([srcCol])) onNotice('마지막 열은 숨길 수 없습니다', 'warn')
  }

  function showAll(): void {
    view.showAllCols()
  }

  /** 검색으로 걸러진 열만 일괄 처리 — 목록에 보이는 것에만 작용해야 예측 가능하다 */
  function setFiltered(visible: boolean): void {
    const targets = rows.map((r) => r.srcCol)
    if (visible) {
      const next = new Set(view.hiddenCols)
      for (const c of targets) next.delete(c)
      view.hiddenCols = next
      return
    }
    if (!view.hideCols(targets)) onNotice('모든 열을 숨길 수는 없습니다', 'warn')
  }

  function hideEmpty(): void {
    const fresh = ds.emptyCols().filter((c) => !view.hiddenCols.has(c))
    if (fresh.length === 0) {
      onNotice('숨길 빈 열이 없습니다')
      return
    }
    if (!view.hideCols(fresh)) onNotice('모든 열이 비어 있어 숨길 수 없습니다', 'warn')
    else onNotice(`빈 열 ${num(fresh.length)}개 숨김`, 'ok')
  }

  const pos = $derived.by(() => {
    const r = anchor.getBoundingClientRect()
    const W = 288
    const H = 420
    let left = r.left
    if (left + W > window.innerWidth - 8) left = Math.max(8, window.innerWidth - W - 8)
    let top = r.bottom + 4
    if (top + H > window.innerHeight - 8) top = Math.max(8, window.innerHeight - H - 8)
    return { left, top }
  })

  const typeGlyph: Record<string, string> = { number: '#', date: '◷', string: 'T' }
</script>

<div
  class="panel pop"
  style="left:{pos.left}px;top:{pos.top}px"
  role="dialog"
  aria-label="열 관리"
  tabindex="-1"
  {@attach dismissable(onClose, { ignore: () => [anchor] })}
>
  <header>
    <span class="title">열 관리</span>
    <span class="cnt">{num(visibleCount)}<span class="dim">/{num(ds.colCount)}</span></span>
    <button class="btn icon" onclick={onClose} aria-label="닫기">✕</button>
  </header>

  <div class="search">
    <input
      bind:this={searchEl}
      bind:value={search}
      placeholder="열 이름 검색…"
      spellcheck="false"
      autocomplete="off"
      aria-label="열 이름 검색"
    />
  </div>

  <div class="bulk">
    <button onclick={() => setFiltered(true)}>{search.trim() ? '표시된 항목' : '모두'} 보이기</button>
    <button onclick={() => setFiltered(false)}>{search.trim() ? '표시된 항목' : '모두'} 숨기기</button>
    <button class="accent" disabled={emptyVisible === 0} onclick={hideEmpty}>
      빈 열 숨기기{emptyVisible > 0 ? ` (${emptyVisible})` : ''}
    </button>
  </div>

  <div class="list">
    {#each rows as r (r.srcCol)}
      <button class="item" class:off={!r.visible} onclick={() => toggle(r.srcCol)}
        role="switch" aria-checked={r.visible}>
        <span class="sw" class:on={r.visible} aria-hidden="true"><i></i></span>
        <span class="glyph" data-type={r.type}>{typeGlyph[r.type]}</span>
        <span class="name" title={r.name}>{r.name}</span>
        {#if r.empty}<span class="tag">빈 열</span>{/if}
      </button>
    {:else}
      <p class="none">일치하는 열이 없습니다</p>
    {/each}
  </div>

  {#if view.hiddenColCount > 0}
    <footer>
      <span class="hid">{num(view.hiddenColCount)}개 열 숨김</span>
      <button class="btn" onclick={showAll}>모두 보이기</button>
    </footer>
  {/if}
</div>

<style>
  .panel {
    position: fixed;
    z-index: var(--z-popover);
    width: 288px;
    max-height: 420px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: in 140ms var(--ease);
  }
  @keyframes in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }

  header {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 8px 6px 7px 11px;
    border-bottom: 1px solid var(--border);
  }
  .title {
    flex: 1;
    font-size: 12px;
    font-weight: 600;
  }
  .cnt {
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }
  .cnt .dim {
    color: var(--text-faint);
  }

  .search {
    padding: 7px 8px 5px;
  }
  .search input {
    width: 100%;
    height: 26px;
    padding: 0 7px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: inherit;
    font-size: 11.5px;
    outline: none;
  }
  .search input:focus {
    border-color: var(--accent-line);
  }

  .bulk {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 0 8px 7px;
  }
  .bulk button {
    height: 22px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 11px;
    color: var(--text-faint);
    font-size: 10.5px;
    white-space: nowrap;
    transition:
      color var(--dur) var(--ease),
      border-color var(--dur) var(--ease);
  }
  .bulk button:hover:not(:disabled) {
    color: var(--text-dim);
    border-color: var(--border-strong);
  }
  .bulk button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .bulk .accent:not(:disabled) {
    color: var(--c-hide);
    border-color: color-mix(in srgb, var(--c-hide) 45%, transparent);
  }

  .list {
    flex: 1;
    min-height: 60px;
    overflow-y: auto;
    padding: 0 4px 4px;
    border-top: 1px solid var(--border-soft);
  }

  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 26px;
    padding: 0 6px;
    border-radius: 4px;
    text-align: left;
    transition: background var(--dur) var(--ease);
  }
  .item:hover {
    background: var(--bg-hover);
  }

  /* 스위치 — 켜짐/꺼짐이 한눈에 구분되어야 목록을 빠르게 훑을 수 있다 */
  .sw {
    flex: none;
    position: relative;
    width: 22px;
    height: 12px;
    border-radius: 6px;
    background: var(--border-strong);
    transition: background var(--dur) var(--ease);
  }
  .sw i {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--bg-raised);
    transition: transform var(--dur) var(--ease);
  }
  .sw.on {
    background: var(--ok);
  }
  .sw.on i {
    transform: translateX(10px);
  }

  .glyph {
    flex: none;
    width: 9px;
    text-align: center;
    color: var(--text-faint);
    font-size: 10px;
  }
  .glyph[data-type='number'] {
    color: var(--c-num);
  }
  .glyph[data-type='date'] {
    color: var(--c-date);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11.5px;
  }
  .item.off .name,
  .item.off .glyph {
    color: var(--text-faint);
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, var(--text-faint) 60%, transparent);
  }

  .tag {
    flex: none;
    padding: 1px 5px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--c-hide) 16%, transparent);
    color: var(--c-hide);
    font-size: 9.5px;
  }

  .none {
    margin: 14px 0;
    text-align: center;
    color: var(--text-faint);
    font-size: 11px;
  }

  footer {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 8px;
    border-top: 1px solid var(--border);
    background: var(--bg-header);
  }
  .hid {
    flex: 1;
    color: var(--c-hide);
    font-size: 10.5px;
  }
</style>
