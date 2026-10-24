<script lang="ts">
  /** 저장된 쿼리 드롭다운 — 퍼지 검색 · 삭제 · 내보내기/가져오기. 고르면 최근 사용으로 올린다. */
  import { dialogs } from '../../../lib/ui/dialog/dialog.svelte'
  import { dismissable } from '../../../lib/ui/dismiss'
  import { toasts } from '../../../lib/ui/toasts.svelte'
  import { downloadText } from '../core/file-handler'
  import {
    deleteSavedQuery,
    getSavedQueries,
    importSavedQueries,
    replaceSavedQueries,
    touchSavedQuery,
  } from '../data/storage'
  import type { SavedQuery } from '../types'
  import { fuzzyMatch } from '../util/fuzzy'

  interface Props {
    onPick: (query: string) => void
    onClose: () => void
    /** 바깥 클릭 판정에서 제외할 앵커 버튼 */
    anchor?: HTMLElement | null
  }
  let { onPick, onClose, anchor }: Props = $props()

  let all = $state.raw<SavedQuery[]>([])
  let term = $state('')
  let searchEl = $state<HTMLInputElement | null>(null)
  let fileEl = $state<HTMLInputElement | null>(null)

  const shown = $derived.by(() => {
    if (!term.trim()) return all
    return all
      .map((q) => {
        const a = fuzzyMatch(term, q.name)
        const b = fuzzyMatch(term, q.query)
        const best = a.score > b.score ? a : b
        return { q, match: a.match || b.match, score: best.score }
      })
      .filter((x) => x.match)
      .sort((x, y) => y.score - x.score)
      .map((x) => x.q)
  })

  async function reload(): Promise<void> {
    all = await getSavedQueries()
  }

  async function pick(q: SavedQuery): Promise<void> {
    onPick(q.query)
    await touchSavedQuery(q)
    await reload()
  }

  async function remove(q: SavedQuery): Promise<void> {
    const ok = await dialogs.confirm({
      message: `저장된 쿼리 "${q.name}" 을(를) 지울까요?`,
      okLabel: '삭제',
      danger: true,
    })
    if (!ok) return
    await deleteSavedQuery(q.id)
    await reload()
  }

  function exportAll(): void {
    if (all.length === 0) {
      void dialogs.alert({ message: '내보낼 쿼리가 없습니다.' })
      return
    }
    const data = { version: '1.0', exportDate: new Date().toISOString(), queries: all }
    downloadText(JSON.stringify(data, null, 2), `jq-queries-${new Date().toISOString().split('T')[0]}.json`)
  }

  async function onImport(e: Event): Promise<void> {
    const el = e.target as HTMLInputElement
    const file = el.files?.[0]
    el.value = ''
    if (!file) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      const list = (parsed as { queries?: unknown }).queries
      if (!Array.isArray(list)) {
        await dialogs.alert({ message: '파일 형식이 올바르지 않습니다.', tone: 'warn' })
        return
      }
      const valid = list.filter(
        (q): q is { name: string; query: string; timestamp?: string } =>
          !!q && typeof q.name === 'string' && typeof q.query === 'string',
      )
      if (valid.length === 0) {
        await dialogs.alert({ message: '가져올 수 있는 쿼리가 없습니다.', tone: 'warn' })
        return
      }
      const merge = await dialogs.confirm({
        title: '저장된 쿼리 가져오기',
        message: `${valid.length}건을 찾았습니다.`,
        detail: '확인하면 기존 목록에 합치고, 취소하면 기존 목록을 모두 대체합니다.',
        okLabel: '합치기',
        cancelLabel: '대체하기',
      })
      if (merge) await importSavedQueries(valid)
      else await replaceSavedQueries(valid)
      await reload()
      toasts.push(`쿼리 ${valid.length}건을 가져왔습니다.`, 'ok')
    } catch (error) {
      await dialogs.alert({
        title: '가져오기 실패',
        message: error instanceof Error ? error.message : String(error),
        tone: 'warn',
      })
    }
  }

  function stamp(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString()
  }

  $effect(() => {
    void reload()
    searchEl?.focus()
  })
</script>

<div class="menu pop" {@attach dismissable(onClose, { ignore: () => [anchor] })}>
  <div class="menu-head">
    <input bind:this={searchEl} class="field" type="text" placeholder="저장된 쿼리 검색..." bind:value={term} />
    <button class="btn outline" onclick={() => fileEl?.click()}>가져오기</button>
    <button class="btn outline" onclick={exportAll}>내보내기</button>
    <button class="btn icon" onclick={onClose} title="닫기">×</button>
    <input bind:this={fileEl} type="file" accept=".json" hidden onchange={(e) => void onImport(e)} />
  </div>
  <div class="menu-list">
    {#if shown.length === 0}
      <p class="empty">{term.trim() ? '검색 결과가 없습니다' : '저장된 쿼리가 없습니다'}</p>
    {:else}
      {#each shown as q (q.id)}
        <div class="row">
          <button class="row-main" onclick={() => void pick(q)}>
            <span class="name">{q.name}</span>
            <span class="meta">{stamp(q.timestamp)}</span>
            <span class="preview">{q.query.length > 70 ? q.query.slice(0, 70) + '…' : q.query}</span>
          </button>
          <button class="btn icon" title="삭제" onclick={() => void remove(q)}>×</button>
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
    width: min(520px, 90vw);
    display: flex;
    flex-direction: column;
    max-height: min(60vh, calc(100% - var(--header-h) - 12px));
  }
  .menu-head {
    display: flex;
    gap: 4px;
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
  .name {
    color: var(--text);
  }
  .meta {
    font-size: var(--fs-label);
    color: var(--text-faint);
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
