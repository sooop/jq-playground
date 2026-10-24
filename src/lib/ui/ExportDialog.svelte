<script lang="ts">
  import type { Dataset } from '../data/dataset.svelte'
  import { buildMatrix } from '../data/export'
  import type { SelectionStore } from '../data/selection.svelte'
  import type { ExportFormat, ExportOptions, ExportScope, ExportTarget } from '../data/types'
  import type { View } from '../data/view.svelte'
  import { num } from '../util/format'
  import { load, save } from '../util/storage'
  import Modal from './Modal.svelte'

  interface Props {
    ds: Dataset
    view: View
    sel: SelectionStore
    onRun: (opts: ExportOptions) => void
    onClose: () => void
  }
  let { ds, view, sel, onRun, onClose }: Props = $props()

  const DEFAULTS: ExportOptions = {
    scope: 'view',
    format: 'csv',
    target: 'file',
    includeHeader: true,
    applyColOrder: true,
    quoting: 'minimal',
    newline: '\n',
    bom: true,
  }

  /** 마지막 선택을 기억한다 — 같은 작업을 반복하는 게 대부분이다 */
  let o = $state<ExportOptions>({ ...DEFAULTS, ...load('exportOpts', {}) })

  // 선택이 없으면 '선택 영역'을 고를 수 없다
  const hasSelection = $derived(sel.ranges.length > 0)
  $effect(() => {
    if (o.scope === 'selection' && !hasSelection) o.scope = 'view'
  })

  /** 선택한 범위의 실제 크기 미리보기 */
  const preview = $derived.by(() => {
    void ds.version
    const { matrix, headerRow } = buildMatrix(ds, view, sel, o)
    return {
      rows: Math.max(0, matrix.length - (headerRow ? 1 : 0)),
      cols: matrix[0]?.length ?? 0,
    }
  })

  function run(): void {
    save('exportOpts', o)
    onRun({ ...o })
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault()
      run()
    }
  }

  const scopes: { v: ExportScope; label: string; desc: string; disabled?: boolean }[] = $derived([
    { v: 'all', label: '전체', desc: `필터 무시 · ${num(ds.rowCount)}행` },
    { v: 'view', label: '보이는 부분', desc: `필터·정렬 적용 · ${num(view.visibleCount)}행` },
    {
      v: 'selection',
      label: '선택 영역',
      desc: hasSelection ? `${num(sel.cellCount)}셀` : '선택 없음',
      disabled: !hasSelection,
    },
  ])

  const formats: { v: ExportFormat; label: string }[] = [
    { v: 'csv', label: 'CSV' },
    { v: 'tsv', label: 'TSV' },
  ]
  const targets: { v: ExportTarget; label: string }[] = [
    { v: 'file', label: '파일' },
    { v: 'clipboard', label: '클립보드' },
  ]
</script>

<Modal label="내보내기" title="내보내기" width="420px" {onClose} onKeydown={onKeydown}>
    <section>
      <span class="label">범위</span>
      <div class="stack">
        {#each scopes as s (s.v)}
          <button
            class="opt"
            class:on={o.scope === s.v}
            disabled={s.disabled}
            onclick={() => (o.scope = s.v)}
          >
            <span class="radio"></span>
            <span class="opt-main">{s.label}</span>
            <span class="opt-sub">{s.desc}</span>
          </button>
        {/each}
      </div>
    </section>

    <section>
      <span class="label">형식</span>
      <div class="seg">
        {#each formats as f (f.v)}
          <button class:on={o.format === f.v} onclick={() => (o.format = f.v)}>{f.label}</button>
        {/each}
      </div>
    </section>

    <section>
      <span class="label">대상</span>
      <div class="seg">
        {#each targets as t (t.v)}
          <button
            class:on={o.target === t.v}
            onclick={() => (o.target = t.v)}
          >
            {t.label}
          </button>
        {/each}
      </div>
    </section>

    <section>
      <span class="label">옵션</span>
      <div class="checks">
        <label><input type="checkbox" bind:checked={o.includeHeader} /> 헤더 행 포함</label>
        <label><input type="checkbox" bind:checked={o.applyColOrder} /> 현재 칼럼 순서 적용</label>
        {#if true}
          <label>
            <input type="checkbox" checked={o.quoting === 'always'}
              onchange={(e) => (o.quoting = e.currentTarget.checked ? 'always' : 'minimal')} />
            모든 값을 인용
          </label>
          <label>
            <input type="checkbox" checked={o.newline === '\r\n'}
              onchange={(e) => (o.newline = e.currentTarget.checked ? '\r\n' : '\n')} />
            CRLF 개행 (Windows)
          </label>
          {#if o.format === 'csv' && o.target === 'file'}
            <label>
              <input type="checkbox" bind:checked={o.bom} />
              BOM 추가 <span class="why">Excel 한글 호환</span>
            </label>
          {/if}
        {/if}
      </div>
    </section>

  {#snippet footer()}
    <span class="sum">{num(preview.rows)}행 × {num(preview.cols)}열</span>
    <button class="btn" onclick={onClose}>취소</button>
    <button class="btn primary" onclick={run}>
      {o.target === 'clipboard' ? '복사' : '저장'}
    </button>
  {/snippet}
</Modal>

<style>
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
    padding: 7px 9px;
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

  /* 세그먼트 컨트롤 */
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
  .seg button:hover:not(:disabled):not(.on) {
    background: var(--bg-hover);
  }
  .seg button.on {
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }
  .seg button:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .checks {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .checks label {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--text-dim);
    font-size: 11.5px;
    cursor: pointer;
  }
  .checks input {
    accent-color: var(--accent);
    margin: 0;
  }
  .why {
    color: var(--text-faint);
    font-size: 10px;
  }


  .sum {
    flex: 1;
    color: var(--text-faint);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }
</style>
