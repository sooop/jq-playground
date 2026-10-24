<script lang="ts">
  /** 선택한 후보의 시그니처·설명·예제. 목록 오른쪽에 붙되 화면 밖이면 왼쪽으로 넘긴다. */
  import type { AcItem } from './word'

  interface Props {
    item: AcItem
    top: number
    left: number
    maxHeight: number
  }
  let { item, top, left, maxHeight }: Props = $props()

  const DOC_W = 280
  const x = $derived(
    left + DOC_W > window.innerWidth - 8 ? Math.max(4, left - 326 - DOC_W - 2) : left,
  )
</script>

<div class="ac-doc pop" style:top="{top}px" style:left="{x}px" style:max-height="{maxHeight}px">
  {#if item.signature}
    <div class="sig">{item.signature}</div>
  {/if}
  {#if item.desc}
    <div class="desc">{item.desc}</div>
  {/if}
  {#if item.example}
    <pre class="example">{item.example}</pre>
  {/if}
</div>

<style>
  .ac-doc {
    position: fixed;
    z-index: var(--z-popover);
    width: 280px;
    overflow-y: auto;
    padding: 8px 10px;
    font-size: var(--fs-ui);
  }
  .sig {
    font-family: var(--font-mono);
    color: var(--accent);
    margin-bottom: 4px;
  }
  .desc {
    color: var(--text-dim);
    line-height: 1.5;
  }
  .example {
    margin: 6px 0 0;
    padding: 6px 7px;
    background: var(--bg);
    border: 1px solid var(--border-soft);
    border-radius: 5px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-dim);
    white-space: pre-wrap;
    overflow-x: auto;
  }
</style>
