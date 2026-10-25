<script lang="ts">
  /**
   * 커맨드 팰릿(Ctrl+K) — jq 모드 소유. 셸에는 통합 팰릿이 없다(모드마다 자기 것을 쓴다).
   *
   * 항목은 세 갈래다: 등록된 단축키 액션 / 저장된 쿼리 / 최근 쿼리.
   */
  import Modal from '../../../lib/ui/Modal.svelte'
  import { getQueryHistory, getSavedQueries } from '../data/storage'
  import { fuzzyScore } from '../util/fuzzy'
  import type { KeymapEntry } from '../utils/keymap'

  type Kind = 'action' | 'snippet' | 'history'

  interface CPItem {
    id: string
    kind: Kind
    label: string
    description?: string
    badge?: string
    run: () => void
  }

  interface Props {
    entries: readonly KeymapEntry[]
    onQuery: (q: string) => void
    onClose: () => void
  }
  let { entries, onQuery, onClose }: Props = $props()

  const SECTIONS: { kind: Kind; label: string }[] = [
    { kind: 'action', label: '액션' },
    { kind: 'snippet', label: '저장된 쿼리' },
    { kind: 'history', label: '최근 쿼리' },
  ]

  let all = $state.raw<CPItem[]>([])
  let term = $state('')
  let cursor = $state(0)
  let inputEl = $state<HTMLInputElement | null>(null)

  const filtered = $derived.by(() => {
    if (!term.trim()) return all.slice(0, 30)
    return all
      .map((item) => ({
        item,
        score: fuzzyScore(term, item.label) + fuzzyScore(term, item.description ?? '') * 0.5,
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map(({ item }) => item)
  })

  /** 섹션 순서대로 다시 늘어놓은 목록 — 커서 인덱스는 이 순서를 따른다 */
  const ordered = $derived(SECTIONS.flatMap((s) => filtered.filter((i) => i.kind === s.kind)))

  async function load(): Promise<void> {
    const items: CPItem[] = entries.map((e) => ({
      id: `action:${e.id}`,
      kind: 'action',
      label: e.label,
      description: e.description,
      badge: e.keys,
      run: () => e.handler(new KeyboardEvent('keydown')),
    }))

    try {
      for (const q of await getSavedQueries()) {
        items.push({
          id: `snippet:${q.id}`,
          kind: 'snippet',
          label: q.name,
          description: q.query,
          run: () => onQuery(q.query),
        })
      }
    } catch {
      /* 저장소 실패는 무시 */
    }

    try {
      for (const h of (await getQueryHistory(10))) {
        items.push({
          id: `history:${h.id}`,
          kind: 'history',
          label: h.query,
          description: '최근 쿼리',
          run: () => onQuery(h.query),
        })
      }
    } catch {
      /* 무시 */
    }

    all = items
  }

  function pick(item: CPItem): void {
    onClose()
    item.run()
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      cursor = Math.min(cursor + 1, ordered.length - 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      cursor = Math.max(cursor - 1, 0)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = ordered[cursor]
      if (item) pick(item)
    }
  }

  $effect(() => {
    void load()
  })

  // 목록이 바뀌면 커서를 맨 위로
  $effect(() => {
    void term
    cursor = 0
  })
</script>

<Modal
  label="커맨드 팰릿"
  width="620px"
  maxHeight="66vh"
  plainBody
  initialFocus={() => inputEl}
  {onClose}
>
  <div class="search">
    <input
      bind:this={inputEl}
      class="field"
      type="text"
      placeholder="명령 또는 쿼리 검색..."
      bind:value={term}
      onkeydown={onKeydown}
    />
  </div>

  <div class="results" role="listbox" aria-label="검색 결과">
    {#if ordered.length === 0}
      <p class="empty">결과가 없습니다</p>
    {:else}
      {#each SECTIONS as s (s.kind)}
        {@const list = filtered.filter((i) => i.kind === s.kind)}
        {#if list.length > 0}
          <div class="sec label">{s.label}</div>
          {#each list as item (item.id)}
            {@const idx = ordered.indexOf(item)}
            <div
              class="item"
              class:sel={idx === cursor}
              role="option"
              aria-selected={idx === cursor}
              tabindex="-1"
              onmousedown={(e) => {
                e.preventDefault()
                pick(item)
              }}
              onmouseenter={() => (cursor = idx)}
            >
              <span class="body">
                <span class="lbl">{item.label}</span>
                {#if item.description}
                  <span class="desc">{item.description.slice(0, 80)}</span>
                {/if}
              </span>
              {#if item.badge}<span class="kbd">{item.badge}</span>{/if}
            </div>
          {/each}
        {/if}
      {/each}
    {/if}
  </div>

  <div class="foot">
    <span><span class="kbd">↑↓</span> 이동</span>
    <span><span class="kbd">Enter</span> 실행</span>
    <span><span class="kbd">Esc</span> 닫기</span>
  </div>
</Modal>

<style>
  .search {
    flex: none;
    padding: 8px;
    border-bottom: 1px solid var(--border-soft);
  }
  .search .field {
    width: 100%;
    height: 32px;
  }
  .results {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px;
  }
  .empty {
    margin: 0;
    padding: 18px;
    text-align: center;
    color: var(--text-faint);
  }
  .sec {
    padding: 6px 8px 2px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border-radius: 5px;
    cursor: pointer;
  }
  .item:hover {
    background: var(--bg-hover);
  }
  .item.sel {
    background: var(--accent-soft);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .lbl {
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .desc {
    font-size: var(--fs-label);
    color: var(--text-faint);
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .foot {
    flex: none;
    display: flex;
    gap: 14px;
    padding: 6px 10px;
    border-top: 1px solid var(--border-soft);
    font-size: var(--fs-label);
    color: var(--text-faint);
  }
</style>
