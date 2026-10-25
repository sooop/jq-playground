<script lang="ts">
  /**
   * 행/셀 상세 — 선택한 셀이 속한 행을 열 이름: 값 목록으로 펼쳐 보여준다.
   *
   * 표 칸에서는 잘리는 긴 문장과 JSON 문자열(`{"a":1}`)을 여기서 끝까지 읽는다. 선택한 열은
   * 목록에서 강조하고, 값이 JSON 객체/배열이면 들여쓰기를 넣어 보여 준다. 읽기 전용이다.
   */
  import type { Dataset } from '../lib/data/dataset.svelte'
  import type { SelectionStore } from '../lib/data/selection.svelte'
  import type { View } from '../lib/data/view.svelte'
  import { anchor } from '../lib/ui/feedback/anchors'
  import { feedback } from '../lib/ui/feedback/feedback.svelte'
  import { num } from '../lib/util/format'

  interface Props {
    ds: Dataset
    view: View
    sel: SelectionStore
    onClose: () => void
  }
  let { ds, view, sel, onClose }: Props = $props()

  const viewRow = $derived(sel.active.r)
  const srcRow = $derived(view.viewRows[viewRow])
  const activeSrcCol = $derived(view.viewCols[sel.active.c])

  /** 목록은 현재 보이는 열만, 화면 순서대로 */
  const fields = $derived.by(() => {
    void ds.version
    if (srcRow === undefined) return []
    return view.viewCols.map((c) => ({ col: c, name: ds.header[c], value: ds.cell(srcRow, c) }))
  })

  function pretty(v: string): string | null {
    const t = v.trim()
    if (t.length < 2 || (t[0] !== '{' && t[0] !== '[')) return null
    try {
      return JSON.stringify(JSON.parse(t), null, 2)
    } catch {
      return null
    }
  }

  let rawJson = $state(false)

  /** 값마다 버튼이 따로 있으므로 앵커도 열(원본 열 번호)별로 둔다 */
  async function copy(text: string, id: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      feedback.clear(id)
      feedback.ok(id, '복사됨')
    } catch (e) {
      feedback.report({
        key: id,
        kind: 'error',
        title: '복사하지 못했습니다',
        detail: e instanceof Error ? e.message : undefined,
        anchors: [id],
      })
    }
  }

  function step(d: number): void {
    const r = Math.max(0, Math.min(view.viewRows.length - 1, viewRow + d))
    sel.selectCell(r, sel.active.c)
  }
</script>

<aside class="detail" aria-label="행 상세">
  <header>
    <b>행 상세</b>
    {#if srcRow !== undefined}
      <span class="pos">{num(viewRow + 1)} / {num(view.viewRows.length)}</span>
    {/if}
    <span class="sp"></span>
    <button class="btn" title="이전 행" disabled={viewRow <= 0} onclick={() => step(-1)}>↑</button>
    <button
      class="btn"
      title="다음 행"
      disabled={viewRow >= view.viewRows.length - 1}
      onclick={() => step(1)}>↓</button
    >
    <label class="raw" title="JSON 문자열을 들여쓰기 없이 원문 그대로 보기">
      <input type="checkbox" bind:checked={rawJson} /> 원문
    </label>
    <button class="btn" title="닫기" onclick={onClose}>×</button>
  </header>

  {#if srcRow === undefined}
    <p class="empty">셀을 선택하면 그 행이 여기에 펼쳐집니다.</p>
  {:else}
    <div class="list">
      {#each fields as f (f.col)}
        {@const pj = rawJson ? null : pretty(f.value)}
        <div class="item" class:active={f.col === activeSrcCol}>
          <div class="k">
            <span class="name" title={f.name}>{f.name}</span>
            <button
              class="cp"
              title="값 복사"
              {@attach anchor(`detail.copy.${f.col}`)}
              onclick={() => void copy(f.value, `detail.copy.${f.col}`)}>복사</button
            >
          </div>
          {#if f.value === ''}
            <div class="v none">(빈 값)</div>
          {:else}
            <pre class="v" class:json={pj !== null}>{pj ?? f.value}</pre>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</aside>

<style>
  .detail {
    display: flex;
    flex-direction: column;
    width: 320px;
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
  .pos {
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .sp {
    flex: 1;
  }
  .raw {
    display: flex;
    align-items: center;
    gap: 3px;
    color: var(--text-dim);
    font-size: 11px;
  }
  .empty {
    padding: 16px;
    color: var(--text-dim);
    font-size: 12px;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 4px 0 12px;
  }
  .item {
    padding: 6px 12px;
    border-bottom: 1px solid var(--border-soft);
  }
  .item.active {
    background: var(--sel-bg);
    box-shadow: inset 2px 0 0 var(--sel-line);
  }
  .k {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-dim);
    font-size: 10.5px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .cp {
    opacity: 0;
    padding: 0 4px;
    font-size: 10px;
    color: var(--text-dim);
  }
  .item:hover .cp,
  .item.active .cp {
    opacity: 1;
  }
  .v {
    margin: 2px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-cell);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: text;
  }
  .v.none {
    color: var(--text-faint);
    font-style: italic;
  }
  .v.json {
    padding: 4px 6px;
    border-radius: 4px;
    background: var(--bg);
    border: 1px solid var(--border-soft);
  }
</style>
