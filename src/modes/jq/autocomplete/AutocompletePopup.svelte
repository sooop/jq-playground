<script lang="ts">
  /**
   * 자동완성 목록. 캐럿 좌표에 뷰포트 고정으로 뜬다(패널이 스크롤돼도 따라가지 않는다 —
   * 어차피 목록이 떠 있는 동안 스크롤하면 닫힌다).
   *
   * 타입 배지는 색을 직접 쓰지 않고 `.ty-*` 클래스로만 구분한다(단일 앰버 체계).
   */
  import { INPUT_TYPE_INFO } from '../core/jq-functions'
  import AutocompleteDoc from './AutocompleteDoc.svelte'
  import { truncatePath, type AcItem } from './word'

  interface Props {
    items: AcItem[]
    selected: number
    top: number
    left: number
    maxHeight: number
    hoverLocked: boolean
    onPick: (item: AcItem) => void
    onHover: (i: number) => void
    onHoverOut: () => void
  }
  let { items, selected, top, left, maxHeight, hoverLocked, onPick, onHover, onHoverOut }: Props =
    $props()

  let listEl = $state<HTMLDivElement | null>(null)

  const current = $derived(selected >= 0 ? (items[selected] ?? null) : null)

  function typeInfo(t: string) {
    return INPUT_TYPE_INFO[t] ?? INPUT_TYPE_INFO['any']!
  }

  // 키보드로 옮긴 선택 항목을 항상 보이게
  $effect(() => {
    void selected
    listEl?.querySelector('[data-sel="1"]')?.scrollIntoView({ block: 'nearest' })
  })
</script>

<div
  bind:this={listEl}
  class="ac-list pop"
  class:hover-locked={hoverLocked}
  style:top="{top}px"
  style:left="{left}px"
  style:max-height="{maxHeight}px"
  role="listbox"
  tabindex="-1"
  aria-label="자동완성 목록"
  onmouseleave={onHoverOut}
>
  {#each items as item, i (item.fullKey ?? item.name)}
    {@const info = typeInfo(item.inputType)}
    <div
      class="ac-item"
      class:sel={i === selected}
      data-sel={i === selected ? '1' : '0'}
      role="option"
      aria-selected={i === selected}
      tabindex="-1"
      onmousedown={(e) => {
        e.preventDefault()
        onPick(item)
      }}
      onmouseenter={() => onHover(i)}
    >
      <span class="ac-name" title={item.name}>{truncatePath(item.name)}</span>
      <span class="ac-type {info.cls}">{info.label}</span>
      <span class="ac-desc">{item.desc}</span>
    </div>
  {/each}
</div>

{#if current && (current.signature || current.example)}
  <AutocompleteDoc item={current} {top} left={left + 326} {maxHeight} />
{/if}

<style>
  .ac-list {
    position: fixed;
    z-index: var(--z-popover);
    width: 320px;
    overflow-y: auto;
    padding: 3px;
    font-size: var(--fs-ui);
  }
  .ac-list.hover-locked .ac-item:hover {
    background: none;
  }

  .ac-item {
    display: grid;
    grid-template-columns: minmax(0, auto) max-content minmax(0, 1fr);
    align-items: baseline;
    gap: 6px;
    padding: 3px 7px;
    border-radius: 4px;
    cursor: pointer;
  }
  .ac-item:hover {
    background: var(--bg-hover);
  }
  .ac-item.sel {
    background: var(--accent-soft);
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .ac-name {
    font-family: var(--font-mono);
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ac-desc {
    color: var(--text-faint);
    font-size: var(--fs-label);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: right;
  }

  .ac-type {
    flex: none;
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: 3px;
    font-size: 9.5px;
    line-height: 14px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-dim);
  }
  /* 타입 구분은 색조 하나(액센트/기능색)만 빌려 쓰고 새 팔레트를 만들지 않는다 */
  .ac-type.ty-field {
    color: var(--accent);
    border-color: var(--accent-line);
  }
  .ac-type.ty-variable {
    color: var(--c-date);
    border-color: var(--border-strong);
  }
  .ac-type.ty-array,
  .ac-type.ty-object {
    color: var(--c-num);
    border-color: var(--border-strong);
  }
  .ac-type.ty-string,
  .ac-type.ty-number,
  .ac-type.ty-item {
    color: var(--text-dim);
  }
</style>
