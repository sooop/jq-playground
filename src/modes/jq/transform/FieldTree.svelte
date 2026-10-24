<script lang="ts">
  /**
   * 문자열로 감싸인 값(stringified field) 트리. 항목이 수천 개가 되는 문서가 있어
   * 24px 고정 행 높이의 가상 스크롤로 그린다(원본과 같은 방식).
   *
   * 체크 규칙: 켜면 조상까지 함께 켜고(`withAncestors`), 끄면 부모가 사라진 자식을
   * 정리한다(`pruneOrphans`) — 부모를 풀지 않으면 자식 구간을 바꿔 넣을 수 없기 때문이다.
   */
  import { allKeys, pruneOrphans, withAncestors, type StringifiedNode } from '../utils/stringified-fields'

  interface Props {
    nodes: StringifiedNode[]
    selected: Set<string>
    onChange: (next: Set<string>) => void
  }
  let { nodes, selected, onChange }: Props = $props()

  const ROW_H = 24
  const OVERSCAN = 8
  const INDENT = 14

  let listEl = $state<HTMLDivElement | null>(null)
  let scrollTop = $state(0)
  let viewportH = $state(ROW_H * 8)

  const first = $derived(Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN))
  const last = $derived(Math.min(nodes.length, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN))
  const slice = $derived(nodes.slice(first, last))

  function badge(node: StringifiedNode): string {
    if (node.decode === 'ndjson') return `ndjson ×${node.lineCount ?? 0}`
    if (node.decode === 'url') return `url ${node.kind}`
    return node.kind
  }

  function bytes(n: number): string {
    if (n < 1024) return `${n}B`
    if (n < 1024 * 1024) return `${Math.round(n / 1024)}K`
    return `${(n / (1024 * 1024)).toFixed(1)}M`
  }

  function toggle(node: StringifiedNode, on: boolean): void {
    const next = new Set(selected)
    if (on) {
      next.add(node.key)
      onChange(withAncestors(nodes, next))
    } else {
      next.delete(node.key)
      onChange(pruneOrphans(nodes, next))
    }
  }

  export function selectAll(): void {
    onChange(allKeys(nodes))
  }
  export function clearAll(): void {
    onChange(new Set())
  }

  $effect(() => {
    if (listEl) viewportH = listEl.clientHeight || ROW_H * 8
  })
</script>

<div
  bind:this={listEl}
  class="list"
  onscroll={(e) => (scrollTop = (e.currentTarget as HTMLElement).scrollTop)}
>
  {#if nodes.length === 0}
    <p class="empty">풀 수 있는 문자열 값이 없습니다</p>
  {:else}
    <div class="spacer" style:height="{nodes.length * ROW_H}px">
      <div class="rows" style:transform="translateY({first * ROW_H}px)">
        {#each slice as node (node.key)}
          <label
            class="row"
            style:height="{ROW_H}px"
            style:padding-left="{6 + node.depth * INDENT}px"
            title={node.preview}
          >
            <input
              type="checkbox"
              checked={selected.has(node.key)}
              onchange={(e) => toggle(node, (e.currentTarget as HTMLInputElement).checked)}
            />
            <span class="path">{node.fallbackRoot ? '. (문서 전체)' : node.path}</span>
            <span class="badge">{badge(node)}</span>
            <span class="size">{bytes(node.rawSize)}</span>
          </label>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .list {
    position: relative;
    height: 180px;
    overflow-y: auto;
    border: 1px solid var(--border-soft);
    border-radius: 6px;
    background: var(--bg);
  }
  .empty {
    margin: 0;
    padding: 18px;
    text-align: center;
    color: var(--text-faint);
    font-size: var(--fs-label);
  }
  .spacer {
    position: relative;
  }
  .rows {
    position: absolute;
    inset: 0 0 auto 0;
    will-change: transform;
  }
  .row {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr) max-content max-content;
    align-items: center;
    gap: 7px;
    padding-right: 8px;
    cursor: pointer;
  }
  .row:hover {
    background: var(--bg-hover);
  }
  .path {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .badge {
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: 3px;
    font-size: 9.5px;
    line-height: 14px;
    color: var(--text-dim);
  }
  .size {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-faint);
  }
</style>
