<script lang="ts">
  /** jq 문법 치트시트. 항목을 고르면 현재 쿼리 뒤에 파이프로 잇는다. */
  import Modal from '../../../lib/ui/Modal.svelte'
  import { CHEATSHEET_CATEGORIES } from '../data/cheatsheet'
  import { INPUT_TYPE_INFO } from '../core/jq-functions'

  interface Props {
    onPick: (query: string) => void
    onClose: () => void
  }
  let { onPick, onClose }: Props = $props()

  const keys = Object.keys(CHEATSHEET_CATEGORIES)
  let active = $state(keys[0]!)

  const items = $derived(CHEATSHEET_CATEGORIES[active]?.items ?? [])
</script>

<Modal label="jq 문법 참조" title="jq 문법 참조" width="900px" maxHeight="88vh" plainBody {onClose}>
  <nav class="tabs">
    {#each keys as k (k)}
      <button class="btn" class:on={active === k} onclick={() => (active = k)}>
        {CHEATSHEET_CATEGORIES[k]!.title}
      </button>
    {/each}
  </nav>

  <div class="list">
    {#each items as item (item.query)}
      {@const info = item.inputType ? INPUT_TYPE_INFO[item.inputType] : null}
      <button class="item" onclick={() => onPick(item.query)}>
        <span class="q">
          <code>{item.query}</code>
          {#if info}<span class="ty {info.cls}">{info.label}</span>{/if}
        </span>
        <span class="d">{item.desc}</span>
      </button>
    {/each}
  </div>
</Modal>

<style>
  .tabs {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-soft);
  }
  .tabs :global(.btn) {
    height: 24px;
    padding: 0 8px;
    font-size: var(--fs-label);
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 6px;
  }
  .item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: baseline;
    gap: 12px;
    width: 100%;
    padding: 5px 8px;
    border-radius: 5px;
    text-align: left;
  }
  .item:hover {
    background: var(--bg-hover);
  }
  .q {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
  }
  code {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--accent);
    white-space: pre-wrap;
    word-break: break-all;
  }
  .ty {
    flex: none;
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: 3px;
    font-size: 9.5px;
    line-height: 14px;
    color: var(--text-dim);
  }
  .ty.ty-field {
    color: var(--accent);
    border-color: var(--accent-line);
  }
  .ty.ty-array,
  .ty.ty-object {
    color: var(--c-num);
  }
  .d {
    color: var(--text-dim);
    font-size: var(--fs-label);
  }
</style>
