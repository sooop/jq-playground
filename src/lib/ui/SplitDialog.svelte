<script lang="ts">
  import type { Dataset } from '../data/dataset.svelte'
  import {
    SPLIT_MAX_PARTS_CAP,
    planSplitToCols,
    planSplitToRows,
    type SplitSpec,
  } from '../data/transform'
  import { num } from '../util/format'
  import { load, save } from '../util/storage'
  import Modal from './Modal.svelte'

  export type SplitResult =
    | { mode: 'cols'; spec: SplitSpec; keepSource: boolean }
    | { mode: 'rows'; spec: SplitSpec }

  interface Props {
    ds: Dataset
    /** 나눌 source 칼럼 인덱스 */
    col: number
    onApply: (result: SplitResult) => void
    onClose: () => void
  }
  let { ds, col, onApply, onClose }: Props = $props()

  let delimiter = $state<string>(load('splitDelimiter', ','))
  let regex = $state<boolean>(load('splitRegex', false))
  let trim = $state<boolean>(load('splitTrim', true))
  let mode = $state<'cols' | 'rows'>(load('splitMode', 'cols'))
  let maxParts = $state<number>(load('splitMaxParts', 10))
  let keepSource = $state<boolean>(load('splitKeepSource', true))

  let delimEl = $state<HTMLInputElement | null>(null)
  // 초기 포커스는 Modal이 준다 — 여기서는 기존 값을 선택 상태로만 만든다
  $effect(() => {
    delimEl?.select()
  })

  const colName = $derived(ds.header[col] ?? '')

  const spec = $derived<SplitSpec>({ delimiter, regex, trim, maxParts })

  const colPlan = $derived.by(() => {
    void ds.version
    return mode === 'cols' ? planSplitToCols(ds, col, spec) : null
  })
  const rowPlan = $derived.by(() => {
    void ds.version
    return mode === 'rows' ? planSplitToRows(ds, col, spec) : null
  })

  const error = $derived(colPlan?.error ?? rowPlan?.error ?? null)

  /** 열 분리 미리보기: 앞 3행의 조각들 */
  const colPreview = $derived(colPlan ? colPlan.values.slice(0, 3) : [])
  /** 행 분리 미리보기: 첫 확장 행이 어떻게 늘어나는지 */
  const rowPreview = $derived(rowPlan ? rowPlan.after.slice(0, 4) : [])

  const nothingToDo = $derived(
    error === null &&
      ((mode === 'cols' && (colPlan?.count ?? 0) <= 1) ||
        (mode === 'rows' && (rowPlan?.expandedRows ?? 0) === 0)),
  )

  function apply(): void {
    if (error !== null || nothingToDo) return
    save('splitDelimiter', delimiter)
    save('splitRegex', regex)
    save('splitTrim', trim)
    save('splitMode', mode)
    save('splitMaxParts', maxParts)
    save('splitKeepSource', keepSource)
    onApply(mode === 'cols' ? { mode: 'cols', spec, keepSource } : { mode: 'rows', spec })
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault()
      apply()
    }
  }

  /** 자주 쓰는 구분자 빠른 선택 */
  const presets: { label: string; value: string; regex?: boolean }[] = [
    { label: ',', value: ',' },
    { label: ';', value: ';' },
    { label: '|', value: '|' },
    { label: '탭', value: '\\t', regex: true },
    { label: '공백', value: '\\s+', regex: true },
    { label: '줄바꿈', value: '\\n', regex: true },
  ]
</script>

<Modal
  label="열 나누기"
  title="열 나누기"
  subtitle={colName}
  width="520px"
  initialFocus={() => delimEl}
  {onClose}
  onKeydown={onKeydown}
>
    <label class="row">
      <span class="label">구분자</span>
      <input
        bind:this={delimEl}
        bind:value={delimiter}
        class="field"
        class:error={!!error}
        placeholder={regex ? '정규식 패턴 (예: \\s*[,;]\\s*)' : '구분 문자열'}
        spellcheck="false"
        autocomplete="off"
      />
    </label>

    <div class="presets">
      {#each presets as p (p.label)}
        <button
          class="chip"
          class:on={delimiter === p.value && regex === (p.regex ?? false)}
          onclick={() => {
            delimiter = p.value
            regex = p.regex ?? false
          }}
        >
          {p.label}
        </button>
      {/each}
    </div>

    <div class="togs">
      <button class="tog" class:on={regex} onclick={() => (regex = !regex)}>.* 정규식</button>
      <button class="tog" class:on={trim} onclick={() => (trim = !trim)}>앞뒤 공백 제거</button>
    </div>

    <section>
      <span class="label">분리 방향</span>
      <div class="seg">
        <button class:on={mode === 'cols'} onclick={() => (mode = 'cols')}>열로</button>
        <button class:on={mode === 'rows'} onclick={() => (mode = 'rows')}>행으로</button>
      </div>
      <p class="hint">
        {#if mode === 'cols'}
          조각마다 새 열이 생깁니다. 조각 수가 다른 행은 빈 값으로 채워집니다.
        {:else}
          조각마다 행이 생기고 <b>나머지 열은 그대로 복제됩니다</b>.
        {/if}
      </p>
    </section>

    {#if mode === 'cols'}
      <div class="inline">
        <label class="mini">
          <span class="label">최대 열 수</span>
          <input
            type="number"
            class="field small"
            bind:value={maxParts}
            min="2"
            max={SPLIT_MAX_PARTS_CAP}
          />
        </label>
        <label class="check">
          <input type="checkbox" bind:checked={keepSource} />
          원본 열 유지
        </label>
      </div>
      {#if (colPlan?.cappedRows ?? 0) > 0}
        <p class="warn">
          {num(colPlan?.cappedRows ?? 0)}개 행이 최대 열 수를 넘습니다 — 남은 부분은 마지막 열에
          그대로 들어갑니다(데이터는 잃지 않습니다).
        </p>
      {/if}
    {/if}

    {#if error}
      <p class="err" role="alert">{error}</p>
    {:else}
      <div class="preview">
        <span class="label">미리보기</span>
        {#if mode === 'cols'}
          {#if (colPlan?.count ?? 0) <= 1}
            <p class="none">구분자가 나타나지 않아 나눌 것이 없습니다</p>
          {:else}
            <div class="pv-head">
              {#each colPlan?.names ?? [] as n (n)}<span class="pv-col">{n}</span>{/each}
            </div>
            {#each colPreview as parts, i (i)}
              <div class="pv-row">
                {#each parts as p, k (k)}<span class="pv-col" class:empty={p === ''}
                    >{p === '' ? '—' : p}</span
                  >{/each}
              </div>
            {/each}
          {/if}
        {:else if (rowPlan?.expandedRows ?? 0) === 0}
          <p class="none">구분자가 나타나지 않아 나눌 것이 없습니다</p>
        {:else}
          <p class="rows-sum">
            {num(ds.rowCount)}행 → <b>{num(rowPlan?.rowCount ?? 0)}행</b>
            <span class="dim">({num(rowPlan?.expandedRows ?? 0)}개 행이 늘어남)</span>
          </p>
          {#each rowPreview as row, i (i)}
            <div class="pv-row">
              {#each row as v, k (k)}
                <span class="pv-col" class:hl={k === col} class:empty={v === ''}>
                  {v === '' ? '—' : v}
                </span>
              {/each}
            </div>
          {/each}
        {/if}
      </div>
    {/if}

    <p class="scope-note">모든 행에 적용됩니다 (필터·숨김과 무관).</p>

  {#snippet footer()}
    <button class="btn" onclick={onClose}>취소</button>
    <button class="btn primary" disabled={!!error || nothingToDo} onclick={apply}>나누기</button>
  {/snippet}
</Modal>

<style>

  .row {
    display: block;
  }
  .row .label,
  section > .label,
  .mini .label,
  .preview > .label {
    display: block;
    margin-bottom: 4px;
  }
  .row .field {
    width: 100%;
  }
  .field.error {
    border-color: var(--danger);
  }

  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 6px 0 9px;
  }
  .chip {
    height: 21px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 11px;
    color: var(--text-faint);
    font-size: 10.5px;
    transition:
      background var(--dur) var(--ease),
      color var(--dur) var(--ease);
  }
  .chip:hover {
    color: var(--text-dim);
    border-color: var(--border-strong);
  }
  .chip.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }

  .togs {
    display: flex;
    gap: 4px;
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
    padding: 12px 0 0;
  }
  .seg {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .seg button {
    flex: 1;
    height: 25px;
    border-radius: 4px;
    color: var(--text-dim);
    font-size: 11.5px;
    transition:
      background var(--dur) var(--ease),
      color var(--dur) var(--ease);
  }
  .seg button:hover:not(.on) {
    background: var(--bg-hover);
  }
  .seg button.on {
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }
  .hint {
    margin: 6px 0 0;
    color: var(--text-faint);
    font-size: 10.5px;
    line-height: 1.5;
  }
  .hint b {
    color: var(--text-dim);
  }

  .inline {
    display: flex;
    align-items: flex-end;
    gap: 14px;
    margin-top: 10px;
  }
  .mini {
    display: block;
  }
  .field.small {
    width: 72px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-bottom: 6px;
    color: var(--text-dim);
    font-size: 11.5px;
    cursor: pointer;
  }
  .check input {
    accent-color: var(--accent);
    margin: 0;
  }

  .warn {
    margin: 8px 0 0;
    padding: 6px 8px;
    background: var(--accent-soft);
    color: var(--accent);
    border-radius: 5px;
    font-size: 10.5px;
    line-height: 1.5;
  }
  .err {
    margin: 10px 0 0;
    color: var(--danger);
    font-size: 11px;
  }

  .preview {
    margin-top: 12px;
    padding: 8px 9px;
    background: var(--bg);
    border: 1px solid var(--border-soft);
    border-radius: 6px;
    overflow-x: auto;
  }
  .pv-head,
  .pv-row {
    display: flex;
    gap: 5px;
    font-size: 11px;
    line-height: 1.8;
    white-space: nowrap;
  }
  .pv-head .pv-col {
    color: var(--text-faint);
    font-size: 10px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .pv-col {
    flex: none;
    min-width: 58px;
    max-width: 130px;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0 4px;
    border-left: 1px solid var(--border-soft);
  }
  .pv-col.empty {
    color: var(--text-faint);
  }
  .pv-col.hl {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .rows-sum {
    margin: 0 0 4px;
    font-size: 11.5px;
  }
  .rows-sum b {
    color: var(--accent);
  }
  .rows-sum .dim {
    color: var(--text-faint);
    font-size: 10.5px;
  }
  .none {
    margin: 0;
    color: var(--text-faint);
    font-size: 11px;
    text-align: center;
  }

  .scope-note {
    margin: 10px 0 0;
    color: var(--text-faint);
    font-size: 10px;
  }

</style>
