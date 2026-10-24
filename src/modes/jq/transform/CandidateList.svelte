<script lang="ts">
  /** 소스에서 찾아낸 JSON 후보 목록. 하나를 고르면 그 구간만 필드 스캔 대상이 된다. */
  import type { JsonCandidateMeta } from '../utils/json-preprocessor'

  interface Props {
    candidates: JsonCandidateMeta[]
    selected: number | null
    onSelect: (index: number) => void
  }
  let { candidates, selected, onSelect }: Props = $props()
</script>

<div class="list">
  {#if candidates.length === 0}
    <p class="empty">후보 없음</p>
  {:else}
    {#each candidates as c (c.index)}
      <label class="row" class:sel={selected === c.index}>
        <input
          type="radio"
          name="jqTransformCandidate"
          value={c.index}
          checked={selected === c.index}
          onchange={() => onSelect(c.index)}
        />
        <span class="meta">#{c.index + 1} · L{c.line} · {c.kind}</span>
        <span class="preview">{c.preview}</span>
      </label>
    {/each}
  {/if}
</div>

<style>
  .list {
    max-height: 120px;
    overflow-y: auto;
    border: 1px solid var(--border-soft);
    border-radius: 6px;
    background: var(--bg);
  }
  .empty {
    margin: 0;
    padding: 12px;
    text-align: center;
    color: var(--text-faint);
    font-size: var(--fs-label);
  }
  .row {
    display: grid;
    grid-template-columns: max-content max-content minmax(0, 1fr);
    align-items: center;
    gap: 7px;
    padding: 3px 7px;
    cursor: pointer;
  }
  .row:hover {
    background: var(--bg-hover);
  }
  .row.sel {
    background: var(--accent-soft);
  }
  .meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--accent);
    white-space: nowrap;
  }
  .preview {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
