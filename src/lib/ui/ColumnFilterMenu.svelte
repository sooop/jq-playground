<script lang="ts">
  import { compileColumnFilters, uniqueValues } from '../data/columnFilter'
  import type { Dataset } from '../data/dataset.svelte'
  import type { View } from '../data/view.svelte'
  import { num } from '../util/format'
  import { dismissable } from './dismiss'

  interface Props {
    ds: Dataset
    view: View
    /** source 칼럼 인덱스 */
    col: number
    /** 드롭다운을 띄울 기준 요소 */
    anchor: HTMLElement
    onClose: () => void
  }
  let { ds, view, col, anchor, onClose }: Props = $props()

  /** 고유값이 이보다 많으면 체크박스 목록이 비실용적이라 텍스트 탭을 기본으로 연다 */
  const HIGH_CARDINALITY = 5000
  const LIST_LIMIT = 1000

  const existing = $derived(view.getColumnFilter(col))

  /**
   * 고유값 집계. **다른 칼럼의 필터만** 적용된 행을 대상으로 한다 (Excel 동작).
   * 이 칼럼 자신의 필터를 빼야 체크를 해제했던 값이 목록에서 사라지지 않는다.
   */
  const uniq = $derived.by(() => {
    void ds.version
    const rows = ds.rows

    // 이 칼럼 자신의 필터는 빼야, 체크를 해제했던 값이 목록에서 사라지지 않는다.
    // view.columnFiltered는 자신의 필터까지 포함하므로 재사용할 수 없다.
    const others = new Map(view.columnFilters)
    others.delete(col)
    const compiled = compileColumnFilters(others, ds.colTypes)

    const base = new Uint32Array(rows.length)
    let n = 0
    for (let i = 0; i < rows.length; i++) {
      let ok = true
      for (let f = 0; f < compiled.length; f++) {
        if (!compiled[f].test(rows[i][compiled[f].col] ?? '')) {
          ok = false
          break
        }
      }
      if (ok) base[n++] = i
    }
    return uniqueValues(rows, base.subarray(0, n), col, LIST_LIMIT)
  })

  const highCard = $derived(uniq.total > HIGH_CARDINALITY)

  let tab = $state<'values' | 'text'>('values')
  let search = $state('')
  /** 체크가 **해제된** 값들 — 필터 모델과 같은 방향(제외 집합)으로 유지 */
  let excluded = $state.raw<Set<string>>(new Set())

  let textQuery = $state('')
  let textRegex = $state(false)
  let textNegate = $state(false)

  let searchEl = $state<HTMLInputElement | null>(null)

  // 기존 필터 상태로 초기화 (한 번만)
  let initialized = false
  $effect(() => {
    if (initialized) return
    initialized = true
    const f = existing
    if (f?.mode === 'values') {
      excluded = new Set(f.excluded)
      tab = 'values'
    } else if (f?.mode === 'text') {
      textQuery = f.query
      textRegex = f.regex
      textNegate = f.negate
      tab = 'text'
    } else {
      tab = highCard ? 'text' : 'values'
    }
    searchEl?.focus()
  })

  const filteredValues = $derived.by(() => {
    const q = search.trim().toLowerCase()
    if (q === '') return uniq.values
    return uniq.values.filter((v) => v.value.toLowerCase().includes(q))
  })

  const allChecked = $derived(filteredValues.every((v) => !excluded.has(v.value)))
  const noneChecked = $derived(filteredValues.every((v) => excluded.has(v.value)))

  function toggleValue(value: string): void {
    const next = new Set(excluded)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    excluded = next
  }

  /** 검색으로 걸러진 항목들만 전체 선택/해제 */
  function toggleAllVisible(): void {
    const next = new Set(excluded)
    if (allChecked) for (const v of filteredValues) next.add(v.value)
    else for (const v of filteredValues) next.delete(v.value)
    excluded = next
  }

  function apply(): void {
    if (tab === 'values') {
      view.setColumnFilter(col, excluded.size === 0 ? null : { mode: 'values', excluded })
    } else {
      view.setColumnFilter(
        col,
        textQuery.trim() === ''
          ? null
          : { mode: 'text', query: textQuery, regex: textRegex, negate: textNegate },
      )
    }
    onClose()
  }

  function reset(): void {
    view.setColumnFilter(col, null)
    onClose()
  }

  function onKeyDown(e: KeyboardEvent): void {
    e.stopPropagation()
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      apply()
    }
  }

  /** 앵커 기준 위치 계산 — 화면 밖으로 나가지 않게 좌우/상하 반전 */
  const pos = $derived.by(() => {
    const r = anchor.getBoundingClientRect()
    const W = 268
    const H = 358
    let left = r.left
    if (left + W > window.innerWidth - 8) left = Math.max(8, window.innerWidth - W - 8)
    let top = r.bottom + 4
    if (top + H > window.innerHeight - 8) top = Math.max(8, r.top - H - 4)
    return { left, top }
  })

</script>

<div
  class="panel pop"
  style="left:{pos.left}px;top:{pos.top}px"
  onkeydown={onKeyDown}
  role="dialog"
  aria-label="{ds.header[col]} 필터"
  tabindex="-1"
  {@attach dismissable(onClose)}
>
  <header>
    <span class="name" title={ds.header[col]}>{ds.header[col]}</span>
    <span class="type">{ds.colTypes[col]}</span>
  </header>

  <nav class="tabs">
    <button class:on={tab === 'values'} onclick={() => (tab = 'values')}>
      고유값 <i>{num(uniq.total)}</i>
    </button>
    <button class:on={tab === 'text'} onclick={() => (tab = 'text')}>조건</button>
  </nav>

  {#if tab === 'values'}
    {#if highCard}
      <p class="warn">고유값이 {num(uniq.total)}개입니다. 조건 탭이 더 편할 수 있습니다.</p>
    {/if}

    <div class="search">
      <input
        bind:this={searchEl}
        bind:value={search}
        placeholder="값 검색…"
        spellcheck="false"
        autocomplete="off"
      />
    </div>

    <button class="row all" onclick={toggleAllVisible}>
      <span class="box" class:on={allChecked} class:part={!allChecked && !noneChecked}></span>
      <span class="val">{search.trim() ? '표시된 항목 전체' : '(전체)'}</span>
      <span class="cnt">{num(filteredValues.length)}</span>
    </button>

    <div class="list">
      {#each filteredValues as v (v.value)}
        <button class="row" onclick={() => toggleValue(v.value)}>
          <span class="box" class:on={!excluded.has(v.value)}></span>
          <span class="val" class:empty={v.value === ''} title={v.value}>
            {v.value === '' ? '(빈 값)' : v.value}
          </span>
          <span class="cnt">{num(v.count)}</span>
        </button>
      {:else}
        <p class="none">일치하는 값이 없습니다</p>
      {/each}
    </div>

    {#if uniq.truncated}
      <p class="warn bottom">
        상위 {num(LIST_LIMIT)}개만 표시 — 검색으로 좁히거나 조건 탭을 쓰세요
      </p>
    {/if}
  {:else}
    <div class="text-tab">
      <input
        class="field"
        bind:value={textQuery}
        placeholder={ds.colTypes[col] === 'number' ? '>100,  10..20,  !=0' : '포함할 텍스트…'}
        spellcheck="false"
        autocomplete="off"
      />
      <label><input type="checkbox" bind:checked={textRegex} /> 정규식</label>
      <label><input type="checkbox" bind:checked={textNegate} /> 조건에 맞는 행 제외</label>
      {#if ds.colTypes[col] === 'number'}
        <p class="tip">숫자 칼럼: <code>&gt;100</code> <code>&lt;=0</code> <code>10..20</code></p>
      {/if}
    </div>
  {/if}

  <footer>
    <button class="btn" onclick={reset}>초기화</button>
    <span class="spacer"></span>
    <button class="btn" onclick={onClose}>취소</button>
    <button class="btn primary" onclick={apply}>적용</button>
  </footer>
</div>

<style>
  .panel {
    position: fixed;
    z-index: var(--z-popover);
    width: 268px;
    display: flex;
    flex-direction: column;
    max-height: 358px;
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
    align-items: baseline;
    gap: 6px;
    padding: 8px 10px 6px;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 600;
  }
  .type {
    flex: none;
    font-size: var(--fs-label);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .tabs {
    display: flex;
    gap: 2px;
    padding: 0 8px;
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    padding: 5px 8px 6px;
    border-bottom: 2px solid transparent;
    color: var(--text-faint);
    font-size: 11px;
    transition: color var(--dur) var(--ease);
  }
  .tabs button:hover {
    color: var(--text-dim);
  }
  .tabs button.on {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  .tabs i {
    font-style: normal;
    color: var(--text-faint);
    font-size: 10px;
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
    font-size: 11.5px;
    outline: none;
  }
  .search input:focus {
    border-color: var(--accent-line);
  }

  .list {
    flex: 1;
    min-height: 60px;
    overflow-y: auto;
    padding: 0 4px 4px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    height: 23px;
    padding: 0 6px;
    border-radius: 4px;
    text-align: left;
    transition: background var(--dur) var(--ease);
  }
  .row:hover {
    background: var(--bg-hover);
  }
  .row.all {
    margin: 0 4px 3px;
    width: calc(100% - 8px);
    border-bottom: 1px solid var(--border-soft);
    border-radius: 4px 4px 0 0;
    color: var(--text-dim);
  }

  .box {
    flex: none;
    position: relative;
    width: 12px;
    height: 12px;
    border: 1px solid var(--border-strong);
    border-radius: 3px;
    background: var(--bg);
    transition:
      background var(--dur) var(--ease),
      border-color var(--dur) var(--ease);
  }
  .box.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .box.on::after {
    content: '';
    position: absolute;
    left: 2.5px;
    top: 1px;
    width: 4px;
    height: 7px;
    border-right: 1.6px solid var(--accent-text);
    border-bottom: 1.6px solid var(--accent-text);
    transform: rotate(40deg);
  }
  .box.part::after {
    content: '';
    position: absolute;
    left: 2px;
    top: 4.6px;
    width: 6px;
    height: 0;
    border-top: 1.6px solid var(--accent);
  }

  .val {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11.5px;
  }
  .val.empty {
    color: var(--text-faint);
    font-style: italic;
  }
  .cnt {
    flex: none;
    color: var(--text-faint);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }

  .none {
    margin: 14px 0;
    text-align: center;
    color: var(--text-faint);
    font-size: 11px;
  }

  .warn {
    margin: 0;
    padding: 6px 10px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 10.5px;
    line-height: 1.4;
  }
  .warn.bottom {
    border-top: 1px solid var(--border-soft);
  }

  .text-tab {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 10px;
  }
  .text-tab .field {
    width: 100%;
  }
  .text-tab label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-dim);
    font-size: 11.5px;
    cursor: pointer;
  }
  .text-tab input[type='checkbox'] {
    accent-color: var(--accent);
    margin: 0;
  }
  .tip {
    margin: 0;
    color: var(--text-faint);
    font-size: 10.5px;
  }
  .tip code {
    padding: 1px 3px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 3px;
  }

  footer {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 7px 8px;
    border-top: 1px solid var(--border);
    background: var(--bg-header);
  }
  .spacer {
    flex: 1;
  }
</style>
