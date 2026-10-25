<script lang="ts">
  /**
   * 입력 히스토리 드롭다운 — 검색 · 정렬(등록순/사용순) · 개별 삭제 · 전체 삭제.
   * 정렬 선택은 `xsv.jq.inputSort` 에 남는다.
   */
  import { dialogs } from '../../../lib/ui/dialog/dialog.svelte'
  import { dismissable } from '../../../lib/ui/dismiss'
  import { load, save } from '../../../lib/util/storage'
  import {
    clearAllInputHistory,
    deleteInputHistory,
    getInputHistory,
    searchInputHistory,
    type InputSortKey,
  } from '../data/storage'
  import type { InputHistoryEntry } from '../types'

  interface Props {
    onPick: (entry: InputHistoryEntry) => void
    onClose: () => void
    /** 바깥 클릭 판정에서 제외할 앵커 버튼(다시 눌러 토글할 때 닫기·열기가 겹치지 않도록) */
    anchor?: HTMLElement | null
  }
  let { onPick, onClose, anchor }: Props = $props()

  let items = $state.raw<InputHistoryEntry[]>([])
  let term = $state('')
  let sortBy = $state<InputSortKey>(load('jq.inputSort', 'timestamp'))
  let searchEl = $state<HTMLInputElement | null>(null)
  let debounce: ReturnType<typeof setTimeout> | null = null

  async function reload(): Promise<void> {
    items = term.trim() ? await searchInputHistory(term, sortBy) : await getInputHistory(50, sortBy)
  }

  function onInput(): void {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => void reload(), 300)
  }

  function toggleSort(): void {
    sortBy = sortBy === 'timestamp' ? 'lastUsed' : 'timestamp'
    save('jq.inputSort', sortBy)
    void reload()
  }

  async function remove(id: number): Promise<void> {
    await deleteInputHistory(id)
    await reload()
  }

  async function clearAll(): Promise<void> {
    const ok = await dialogs.confirm({
      title: '입력 히스토리 삭제',
      message: '저장된 입력 히스토리를 모두 지울까요?',
      okLabel: '모두 삭제',
      danger: true,
    })
    if (!ok) return
    await clearAllInputHistory()
    onClose()
  }

  /** 'YYYY-MM-DD HH:MM:SS' */
  function stamp(iso: string): string {
    const d = new Date(iso)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }

  function size(bytes: number): string {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  $effect(() => {
    void reload()
    searchEl?.focus()
  })
</script>

<div class="menu pop" {@attach dismissable(onClose, { ignore: () => [anchor] })}>
  <div class="menu-head">
    <input
      bind:this={searchEl}
      class="field"
      type="text"
      placeholder="히스토리 검색..."
      bind:value={term}
      oninput={onInput}
    />
    <button class="btn outline" onclick={toggleSort} title="등록순 ↔ 사용순">
      {sortBy === 'timestamp' ? '등록순' : '사용순'}
    </button>
    <button class="btn outline" onclick={clearAll}>모두 삭제</button>
    <button class="btn icon" onclick={onClose} title="닫기">×</button>
  </div>

  <div class="menu-list">
    {#if items.length === 0}
      <p class="empty">{term.trim() ? '검색 결과가 없습니다' : '히스토리가 없습니다'}</p>
    {:else}
      {#each items as it (it.id)}
        <div class="row">
          <button class="row-main" onclick={() => onPick(it)}>
            <span class="preview">{it.content.substring(0, 90).replace(/\n/g, ' ')}</span>
            <span class="meta">
              {it.fileName || '이름 없음'} · {size(it.size)} · 등록 {stamp(it.timestamp)}
              {#if it.lastUsed !== it.timestamp}· 사용 {stamp(it.lastUsed)}{/if}
            </span>
          </button>
          <button class="btn icon" title="삭제" onclick={() => void remove(it.id)}>×</button>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .menu {
    position: absolute;
    top: calc(var(--header-h) + 4px);
    right: 0;
    z-index: var(--z-popover);
    width: min(560px, 90vw);
    display: flex;
    flex-direction: column;
    max-height: min(60vh, calc(100% - var(--header-h) - 12px));
  }
  .menu-head {
    display: flex;
    gap: 5px;
    padding: 7px;
    border-bottom: 1px solid var(--border-soft);
  }
  .menu-head .field {
    flex: 1;
    min-width: 0;
  }
  .menu-list {
    overflow-y: auto;
    padding: 4px;
  }
  .empty {
    margin: 0;
    padding: 18px;
    text-align: center;
    color: var(--text-faint);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 2px;
    border-radius: 5px;
  }
  .row:hover {
    background: var(--bg-hover);
  }
  .row-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 5px 7px;
    text-align: left;
  }
  .preview {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meta {
    font-size: var(--fs-label);
    color: var(--text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
