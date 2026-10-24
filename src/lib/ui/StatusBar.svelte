<script lang="ts">
  import type { Dataset } from '../data/dataset.svelte'
  import { parseNumeric } from '../parse/detect'
  import type { SelectionStore } from '../data/selection.svelte'
  import type { View } from '../data/view.svelte'
  import { delimiterName, ms, num, stat } from '../util/format'

  interface Props {
    ds: Dataset
    view: View
    sel: SelectionStore
    /** 감지된 인코딩, 또는 통합 문서면 파일 형식 (표시용) */
    encoding: string
    /** 엑셀 통합 문서에서 온 데이터면 시트 이름 — 아니면 null */
    /** 브라우저에 저장된 문서 이름 — 저장된 적 없으면 null */
    docName: string | null
    /** 숨김 배지 클릭 시 전체 해제 */
    onShowAllHidden: () => void
  }
  let { ds, view, sel, encoding, docName, onShowAllHidden }: Props = $props()

  /** 선택 영역의 숫자 통계 — 저비용 고효용. 셀이 너무 많으면 건너뛴다. */
  const MAX_STAT_CELLS = 500_000

  const summary = $derived.by(() => {
    void ds.version
    if (sel.ranges.length === 0) return null
    const cells = sel.cellCount
    if (cells > MAX_STAT_CELLS) return { cells, n: 0, sum: 0, min: 0, max: 0, tooBig: true }

    let n = 0
    let sum = 0
    let min = Infinity
    let max = -Infinity
    // 겹치는 범위의 셀이 두 번 세어질 수 있지만, 합계의 실용성이 정확한 중복 제거 비용보다 크다
    for (const rg of sel.ranges) {
      for (let r = rg.r0; r <= rg.r1; r++) {
        const src = view.viewRows[r]
        if (src === undefined) continue
        const row = ds.rows[src]
        if (!row) continue
        for (let c = rg.c0; c <= rg.c1; c++) {
          const v = row[view.srcCol(c)]
          if (v === undefined || v === '') continue
          const x = parseNumeric(v)
          if (Number.isNaN(x)) continue
          n++
          sum += x
          if (x < min) min = x
          if (x > max) max = x
        }
      }
    }
    return { cells, n, sum, min, max, tooBig: false }
  })

  const filtered = $derived(view.visibleCount !== ds.rowCount)
</script>

<div class="bar">
  <span class="seg">
    <b>{num(view.visibleCount)}</b><span class="unit">행</span>
    {#if filtered}<span class="of">/ {num(ds.rowCount)}</span>{/if}
  </span>

  <span class="seg">
    <b>{num(view.viewCols.length)}</b><span class="unit">열</span>
    {#if view.hiddenColCount > 0}<span class="of">/ {num(ds.colCount)}</span>{/if}
  </span>

  {#if view.hasHidden}
    <button class="hidden-pill" onclick={onShowAllHidden} title="클릭하면 숨김을 모두 해제합니다">
      <svg viewBox="0 0 12 10" width="11" height="10" aria-hidden="true">
        <path
          d="M1 5s2-3.2 5-3.2S11 5 11 5s-2 3.2-5 3.2S1 5 1 5z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.1"
        />
        <path d="M1.6 9.2L10.4 0.8" stroke="currentColor" stroke-width="1.1" />
      </svg>
      숨김
      {#if view.hiddenColCount > 0}<b>{num(view.hiddenColCount)}</b>열{/if}
      {#if view.hiddenRowCount > 0}<b>{num(view.hiddenRowCount)}</b>행{/if}
    </button>
  {/if}

  {#if summary}
    <span class="divider"></span>
    <span class="seg dim">
      선택 <b>{sel.countIsApprox ? '≈' : ''}{num(summary.cells)}</b><span class="unit">셀</span>
    </span>
    {#if summary.tooBig}
      <span class="seg faint">통계 생략 (너무 큼)</span>
    {:else if summary.n > 0}
      <span class="seg dim">합 <b>{stat(summary.sum)}</b></span>
      <span class="seg dim">평균 <b>{stat(summary.sum / summary.n)}</b></span>
      <span class="seg dim">최소 <b>{stat(summary.min)}</b></span>
      <span class="seg dim">최대 <b>{stat(summary.max)}</b></span>
    {/if}
  {/if}

  <span class="grow"></span>

  {#if view.timings.filterMs > 0.5 || view.timings.sortMs > 0.5}
    <span class="seg faint" title="마지막 파이프라인 계산 시간">
      {#if view.timings.filterMs > 0.5}필터 {ms(view.timings.filterMs)}{/if}
      {#if view.timings.sortMs > 0.5}· 정렬 {ms(view.timings.sortMs)}{/if}
    </span>
    <span class="divider"></span>
  {/if}

  {#if view.activeColumnFilterCount > 0}
    <span class="seg accent">칼럼 필터 {view.activeColumnFilterCount}</span>
    <span class="divider"></span>
  {/if}

  {#if view.sorts.length > 0}
    <span class="seg accent">
      정렬 {view.sorts.map((s) => ds.header[s.col] + (s.dir === 'asc' ? '↑' : '↓')).join(' · ')}
    </span>
    <span class="divider"></span>
  {/if}

  <span class="seg faint">{delimiterName(ds.delimiter)}</span>
  <span class="seg faint">{encoding}</span>
  {#if docName}
    <span class="divider"></span>
    <span
      class="seg faint file"
      title={docName}
    >{docName}</span>
  {/if}
  {#if ds.fileName}
    <span class="divider"></span>
    <span class="seg faint file" title={ds.fileName}>{ds.fileName}</span>
  {/if}
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    /* flex 컨테이너의 마지막 항목이라 flex:none 없이는 압축되어 글자가 잘린다 */
    flex: none;
    height: var(--status-h);
    padding: 0 10px;
    background: var(--bg-header);
    border-top: 1px solid var(--border);
    /*
     * 10.5px에서는 한글의 받침이 뭉개져 읽히지 않는다. 상태바는 계속 눈이 가는 곳이라
     * 라벨 크기보다 한 단계 키우고, 자간(라틴 조판 장치)은 한글 판독을 해치므로 두지 않는다.
     */
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
  }

  .seg {
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
    flex: none;
  }
  .seg b {
    color: var(--text);
    font-weight: 600;
  }
  .unit {
    color: var(--text-faint);
  }
  .of {
    color: var(--text-faint);
  }
  .dim {
    color: var(--text-faint);
  }
  .dim b {
    color: var(--text-dim);
  }
  .faint {
    color: var(--text-faint);
  }
  .accent {
    color: var(--accent);
  }

  /* 숨김은 "데이터가 안 보이는 상태"라 눈에 띄어야 하고, 클릭 한 번으로 되돌릴 수 있어야 한다 */
  .hidden-pill {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 19px;
    padding: 0 7px;
    border: 1px solid var(--c-hide);
    border-radius: 10px;
    background: color-mix(in srgb, var(--c-hide) 14%, transparent);
    color: var(--c-hide);
    font-size: 10.5px;
    transition: background var(--dur) var(--ease);
  }
  .hidden-pill:hover {
    background: var(--c-hide);
    color: var(--bg);
  }
  .hidden-pill b {
    color: inherit;
    font-weight: 700;
  }
  .file {
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .grow {
    flex: 1;
  }
</style>
