<script lang="ts">
  /**
   * 열 통계 — 선택한 열의 보이는 행(필터 적용 후)을 훑어 요약한다.
   *
   * 집계는 열이 바뀌거나 데이터·필터가 바뀔 때만 다시 돈다. 같은 열 안에서 셀만 옮겨 다닐 때는
   * `col` 파생값이 그대로라 재계산하지 않는다.
   */
  import type { Dataset } from '../lib/data/dataset.svelte'
  import type { SelectionStore } from '../lib/data/selection.svelte'
  import type { View } from '../lib/data/view.svelte'
  import { num } from '../lib/util/format'
  import { computeColumnStats } from './columnStats'

  interface Props {
    ds: Dataset
    view: View
    sel: SelectionStore
    onClose: () => void
  }
  let { ds, view, sel, onClose }: Props = $props()

  const col = $derived(view.viewCols[sel.active.c])

  const stats = $derived.by(() => {
    void ds.version
    const c = col
    const rows = view.viewRows
    if (c === undefined) return null
    return computeColumnStats(
      (function* () {
        for (let i = 0; i < rows.length; i++) yield ds.cell(rows[i], c)
      })(),
    )
  })

  const typeLabel = { number: '숫자', date: '날짜', string: '문자열' } as const

  function fmt(x: number): string {
    return Number.isInteger(x) ? num(x) : x.toLocaleString('ko-KR', { maximumFractionDigits: 4 })
  }
  const pct = (n: number, total: number): string =>
    total === 0 ? '0%' : `${((n / total) * 100).toFixed(n === total || n === 0 ? 0 : 1)}%`
</script>

<aside class="stats" aria-label="열 통계">
  <header>
    <b>열 통계</b>
    <span class="sp"></span>
    <button class="btn" title="닫기" onclick={onClose}>×</button>
  </header>

  {#if !stats || col === undefined}
    <p class="empty">열을 선택하면 통계가 여기에 나옵니다.</p>
  {:else}
    <div class="body">
      <h3 title={ds.header[col]}>{ds.header[col]}</h3>
      <p class="sub">{typeLabel[ds.colTypes[col] ?? 'string']} · 보이는 {num(stats.total)}행 기준</p>

      <dl>
        <dt>값 있음</dt>
        <dd>{num(stats.total - stats.empty)} <i>{pct(stats.total - stats.empty, stats.total)}</i></dd>
        <dt>빈 값</dt>
        <dd>{num(stats.empty)} <i>{pct(stats.empty, stats.total)}</i></dd>
        <dt>고유값</dt>
        <dd>{num(stats.distinct)}{stats.distinctCapped ? '+' : ''}</dd>
        {#if stats.min !== null}
          <dt>최소</dt>
          <dd class="mono" title={stats.min}>{stats.min}</dd>
          <dt>최대</dt>
          <dd class="mono" title={stats.max ?? ''}>{stats.max}</dd>
          <dt>글자 수</dt>
          <dd>{num(stats.minLen)} ~ {num(stats.maxLen)}</dd>
        {/if}
        {#if stats.numeric}
          <dt>합계</dt>
          <dd>{fmt(stats.numeric.sum)}</dd>
          <dt>평균</dt>
          <dd>{fmt(stats.numeric.mean)}</dd>
          <dt>중앙값</dt>
          <dd>{fmt(stats.numeric.median)}</dd>
        {/if}
      </dl>

      {#if stats.top.length > 0}
        <h4>많이 나오는 값</h4>
        <ul class="top">
          {#each stats.top as t (t.value)}
            <li title={t.value}>
              <span class="bar" style="width:{(t.count / stats.top[0].count) * 100}%"></span>
              <span class="val">{t.value}</span>
              <span class="cnt">{num(t.count)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</aside>

<style>
  .stats {
    display: flex;
    flex-direction: column;
    width: 280px;
    min-width: 0;
    flex: none;
    border-left: 1px solid var(--border);
    background: var(--bg-raised);
  }
  header {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    height: var(--header-h);
    padding: 0 8px;
    background: var(--bg-header);
    border-bottom: 1px solid var(--border);
    font-size: 12px;
  }
  .sp {
    flex: 1;
  }
  .empty {
    padding: 16px;
    color: var(--text-dim);
    font-size: 12px;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 10px 12px 16px;
  }
  h3 {
    margin: 0;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    margin: 2px 0 10px;
    color: var(--text-dim);
    font-size: 11px;
  }
  dl {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 4px 12px;
    margin: 0;
    font-size: 12px;
  }
  dt {
    color: var(--text-dim);
  }
  dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  dd i {
    color: var(--text-faint);
    font-style: normal;
    font-size: 10.5px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  h4 {
    margin: 14px 0 6px;
    font-size: 11px;
    color: var(--text-dim);
    letter-spacing: 0.04em;
  }
  .top {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 12px;
  }
  .top li {
    position: relative;
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 2px 6px;
    margin-bottom: 2px;
    border-radius: 3px;
  }
  .bar {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--accent-soft);
    border-radius: 3px;
  }
  .val,
  .cnt {
    position: relative;
  }
  .val {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
  }
  .cnt {
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
</style>
