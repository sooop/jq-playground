<script lang="ts">
  import { untrack } from 'svelte'
  import type { Dataset } from '../data/dataset.svelte'
  import { planReplace, type ReplacePlan, type ReplaceSpec } from '../data/find'
  import type { SelectionStore } from '../data/selection.svelte'
  import type { View } from '../data/view.svelte'
  import { num } from '../util/format'
  import { load, save } from '../util/storage'
  import Modal from './Modal.svelte'

  type Scope = 'all' | 'view' | 'selection'

  interface Props {
    ds: Dataset
    view: View
    sel: SelectionStore
    /** 찾기 패널에서 넘어온 초기 검색어 */
    initialQuery?: string
    initialRegex?: boolean
    onApply: (plan: ReplacePlan, label: string) => void
    onClose: () => void
  }
  let { ds, view, sel, initialQuery = '', initialRegex, onApply, onClose }: Props = $props()

  /*
   * 초기값은 다이얼로그가 열릴 때 한 번만 가져온다 — 이후 찾기 패널에서 검색어가 바뀌어도
   * 사용자가 입력 중인 값을 덮어쓰면 안 된다. 의도적으로 초기값만 읽는다.
   */
  let query = $state(untrack(() => initialQuery))
  let replacement = $state('')
  let regex = $state<boolean>(untrack(() => initialRegex) ?? load('findRegex', false))
  let caseSensitive = $state<boolean>(load('findCase', false))
  let wholeCell = $state<boolean>(load('findWhole', false))
  let scope = $state<Scope>(load('replaceScope', 'view'))

  let queryEl = $state<HTMLInputElement | null>(null)

  const hasSelection = $derived(sel.ranges.length > 0)

  // 선택이 없으면 '선택 영역'을 고를 수 없다
  $effect(() => {
    if (scope === 'selection' && !hasSelection) scope = 'view'
  })

  // 초기 포커스는 Modal이 준다 — 여기서는 기존 검색어를 선택 상태로만 만든다
  $effect(() => {
    queryEl?.select()
  })

  const spec = $derived<ReplaceSpec>({ query, replacement, regex, caseSensitive, wholeCell })

  /**
   * 미리보기와 실제 적용이 **같은 함수**를 쓴다 — 건수가 어긋나면 신뢰할 수 없는 UI가 된다.
   * 대용량에서 입력마다 전체 스캔이 도는 것은 감수한다(계획은 값만 만들고 데이터는 안 건드린다).
   */
  const plan = $derived.by(() => {
    void ds.version
    return planReplace(ds, view, spec, scope, sel.ranges)
  })

  /** 앞부분 변경 예시 */
  const samples = $derived(plan.changes.slice(0, 4))

  const scopes: { v: Scope; label: string; desc: string; disabled?: boolean }[] = $derived([
    { v: 'all', label: '전체', desc: `필터 무시 · ${num(ds.rowCount)}행` },
    { v: 'view', label: '보이는 부분', desc: `${num(view.visibleCount)}행` },
    {
      v: 'selection',
      label: '선택 영역',
      desc: hasSelection ? `${num(sel.cellCount)}셀` : '선택 없음',
      disabled: !hasSelection,
    },
  ])

  function apply(): void {
    if (plan.changes.length === 0) return
    save('replaceScope', scope)
    save('findRegex', regex)
    save('findCase', caseSensitive)
    save('findWhole', wholeCell)
    onApply(plan, `${num(plan.occurrences)}건 · ${num(plan.cells)}셀 바꿈`)
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault()
      apply()
    }
  }
</script>

<Modal label="바꾸기" title="바꾸기" width="460px" initialFocus={() => queryEl} {onClose} onKeydown={onKeydown}>
    <label class="row">
      <span class="label">찾을 내용</span>
      <input
        bind:this={queryEl}
        bind:value={query}
        class="field"
        class:error={!!plan.error}
        placeholder={regex ? '정규식 패턴' : '찾을 문자열'}
        spellcheck="false"
        autocomplete="off"
      />
    </label>

    <label class="row">
      <span class="label">바꿀 내용</span>
      <input
        bind:value={replacement}
        class="field"
        placeholder={regex ? '$1 로 그룹 참조 가능' : '바꿀 문자열 (비우면 삭제)'}
        spellcheck="false"
        autocomplete="off"
      />
    </label>

    <div class="togs">
      <button class="tog" class:on={regex} onclick={() => (regex = !regex)} title="정규식">
        .* 정규식
      </button>
      <button
        class="tog"
        class:on={caseSensitive}
        onclick={() => (caseSensitive = !caseSensitive)}
        title="대소문자 구분">Aa 대소문자</button
      >
      <button
        class="tog"
        class:on={wholeCell}
        onclick={() => (wholeCell = !wholeCell)}
        title="셀 값 전체가 일치할 때만">[·] 셀 전체</button
      >
    </div>

    <section>
      <span class="label">적용 범위</span>
      <div class="stack">
        {#each scopes as s (s.v)}
          <button
            class="opt"
            class:on={scope === s.v}
            disabled={s.disabled}
            onclick={() => (scope = s.v)}
          >
            <span class="radio"></span>
            <span class="opt-main">{s.label}</span>
            <span class="opt-sub">{s.desc}</span>
          </button>
        {/each}
      </div>
    </section>

    {#if plan.error}
      <p class="err" role="alert">{plan.error}</p>
    {:else if query !== ''}
      <div class="preview">
        {#if plan.changes.length === 0}
          <p class="none">바뀔 셀이 없습니다</p>
        {:else}
          {#each samples as c (c.r + ':' + c.c)}
            <div class="sample">
              <span class="from">{c.before}</span>
              <span class="arrow" aria-hidden="true">→</span>
              <span class="to">{c.after}</span>
            </div>
          {/each}
          {#if plan.changes.length > samples.length}
            <p class="more">그 외 {num(plan.changes.length - samples.length)}개 셀</p>
          {/if}
        {/if}
      </div>
    {/if}

  {#snippet footer()}
    <span class="sum">
      {#if query === ''}
        찾을 내용을 입력하세요
      {:else if plan.error}
        <span class="bad">패턴 오류</span>
      {:else}
        <b>{num(plan.occurrences)}</b>건 · <b>{num(plan.cells)}</b>개 셀
      {/if}
    </span>
    <button class="btn" onclick={onClose}>취소</button>
    <button class="btn primary" disabled={plan.changes.length === 0} onclick={apply}>
      모두 바꾸기
    </button>
  {/snippet}
</Modal>

<style>
  .row {
    display: block;
    margin-bottom: 9px;
  }
  .row .label {
    display: block;
    margin-bottom: 4px;
  }
  .row .field {
    width: 100%;
  }
  .field.error {
    border-color: var(--danger);
  }

  .togs {
    display: flex;
    gap: 4px;
    margin-bottom: 4px;
  }
  .tog {
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text-faint);
    font-size: 11px;
    transition:
      background var(--dur) var(--ease),
      color var(--dur) var(--ease),
      border-color var(--dur) var(--ease);
  }
  .tog:hover {
    color: var(--text-dim);
    border-color: var(--border-strong);
  }
  .tog.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }

  section {
    padding: 11px 0 0;
  }
  section > .label {
    display: block;
    margin-bottom: 6px;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 9px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    text-align: left;
    transition:
      border-color var(--dur) var(--ease),
      background var(--dur) var(--ease);
  }
  .opt:hover:not(:disabled) {
    border-color: var(--border-strong);
  }
  .opt.on {
    border-color: var(--accent-line);
    background: var(--accent-soft);
  }
  .opt:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .radio {
    flex: none;
    width: 11px;
    height: 11px;
    border: 1px solid var(--border-strong);
    border-radius: 50%;
    transition: all var(--dur) var(--ease);
  }
  .opt.on .radio {
    border-color: var(--accent);
    border-width: 3.5px;
  }
  .opt-main {
    flex: none;
    font-size: 12px;
  }
  .opt-sub {
    flex: 1;
    text-align: right;
    color: var(--text-faint);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }

  .preview {
    margin-top: 12px;
    padding: 8px 9px;
    background: var(--bg);
    border: 1px solid var(--border-soft);
    border-radius: 6px;
  }
  .sample {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 11px;
    line-height: 1.7;
    white-space: pre;
  }
  .sample > span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .from {
    flex: 1;
    color: var(--text-faint);
    text-decoration: line-through;
  }
  .arrow {
    flex: none;
    color: var(--text-faint);
  }
  .to {
    flex: 1;
    color: var(--ok);
  }
  .none {
    margin: 0;
    color: var(--text-faint);
    font-size: 11px;
    text-align: center;
  }
  .more {
    margin: 4px 0 0;
    color: var(--text-faint);
    font-size: 10px;
  }

  .err {
    margin: 10px 0 0;
    color: var(--danger);
    font-size: 11px;
  }

  .sum {
    flex: 1;
    color: var(--text-dim);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .sum b {
    color: var(--text);
  }
  .sum .bad {
    color: var(--danger);
  }
</style>
