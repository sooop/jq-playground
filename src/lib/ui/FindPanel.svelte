<script lang="ts">
  import type { Dataset } from '../data/dataset.svelte'
  import type { FindHit } from '../data/find'
  import { FIND_LIMIT } from '../data/find'
  import type { FindStore } from '../data/findState.svelte'
  import type { View } from '../data/view.svelte'
  import { debounce } from '../util/debounce'
  import { num } from '../util/format'
  import { dismissable } from './dismiss'

  interface Props {
    ds: Dataset
    view: View
    find: FindStore
    /** 매치로 이동 — 활성 셀을 옮기고 화면에 보이게 한다 */
    onGoto: (hit: FindHit | null) => void
    onClose: () => void
    onOpenReplace: () => void
  }
  let { ds, view, find, onGoto, onClose, onOpenReplace }: Props = $props()

  /** 목록에 실제로 그리는 최대 항목 수. 전체 매치는 FIND_LIMIT까지 들고 있다. */
  const LIST_RENDER = 300

  let inputEl = $state<HTMLInputElement | null>(null)
  let listEl = $state<HTMLDivElement | null>(null)

  const applyDebounced = debounce((v: string) => {
    find.query = v
    find.resetCursorNearActive()
    onGoto(find.current)
  }, 180)

  function onInput(): void {
    if (find.raw === '') {
      applyDebounced.cancel()
      find.query = ''
      find.cursor = -1
      return
    }
    applyDebounced(find.raw)
  }

  function step(dir: 1 | -1): void {
    applyDebounced.flush()
    onGoto(find.step(dir))
    scrollListToCursor()
  }

  function pick(i: number): void {
    onGoto(find.setCursor(i))
    scrollListToCursor()
    inputEl?.focus()
  }

  function scrollListToCursor(): void {
    requestAnimationFrame(() => {
      listEl?.querySelector('.hit.on')?.scrollIntoView({ block: 'nearest' })
    })
  }

  /** 옵션을 바꾸면 결과가 달라지므로 커서를 다시 맞춘다 */
  function afterOptionChange(): void {
    find.resetCursorNearActive()
    onGoto(find.current)
  }

  export function focus(): void {
    inputEl?.focus()
    inputEl?.select()
  }

  function onKeyDown(e: KeyboardEvent): void {
    // 패널 안의 키는 그리드 전역 단축키로 새지 않게 한다. Escape는 dismissable이 처리한다.
    e.stopPropagation()

    if (e.key === 'Enter' || e.key === 'F3') {
      e.preventDefault()
      step(e.shiftKey ? -1 : 1)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      step(1)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      step(-1)
      return
    }
    if (e.altKey) {
      const k = e.key.toLowerCase()
      if (k === 'r') {
        e.preventDefault()
        find.toggleRegex()
        afterOptionChange()
      } else if (k === 'c') {
        e.preventDefault()
        find.toggleCase()
        afterOptionChange()
      } else if (k === 'w') {
        e.preventDefault()
        find.toggleWhole()
        afterOptionChange()
      }
    }
  }

  /** 셀 텍스트에서 매치 부분만 강조한 조각 (목록이 길어지지 않게 앞뒤를 자른다) */
  function pieces(h: FindHit): { text: string; hit: boolean }[] {
    const before = h.text.slice(0, h.at)
    const mid = h.text.slice(h.at, h.at + h.len)
    const after = h.text.slice(h.at + h.len)
    const out: { text: string; hit: boolean }[] = []
    if (before.length > 22) out.push({ text: '…' + before.slice(-22), hit: false })
    else if (before) out.push({ text: before, hit: false })
    out.push({ text: mid, hit: true })
    if (after.length > 30) out.push({ text: after.slice(0, 30) + '…', hit: false })
    else if (after) out.push({ text: after, hit: false })
    return out
  }

  const colName = (c: number) => ds.header[view.srcCol(c)] ?? ''
  const shown = $derived(find.hits.slice(0, LIST_RENDER))
  const active = $derived(find.query !== '')
</script>

<div
  class="panel pop"
  role="dialog"
  aria-label="찾기"
  tabindex="-1"
  onkeydown={onKeyDown}
  {@attach dismissable(onClose, { outside: false })}
>
  <div class="bar">
    <div class="field-wrap" class:error={!!find.error}>
      <span class="lens" aria-hidden="true">
        <svg viewBox="0 0 12 12" width="12" height="12">
          <circle cx="5" cy="5" r="3.4" fill="none" stroke="currentColor" stroke-width="1.3" />
          <path d="M7.6 7.6L10.6 10.6" stroke="currentColor" stroke-width="1.3" fill="none" />
        </svg>
      </span>
      <input
        bind:this={inputEl}
        bind:value={find.raw}
        oninput={onInput}
        placeholder={find.regex ? '정규식으로 셀 찾기…' : '셀 찾기…'}
        spellcheck="false"
        autocomplete="off"
        aria-label="찾을 내용"
      />
      <span class="count" aria-live="polite">
        {#if !active}
          <span class="dim">—</span>
        {:else if find.hits.length === 0}
          <span class="dim">없음</span>
        {:else}
          {num(find.cursor + 1)}<span class="dim"
            >/{num(find.hits.length)}{find.truncated ? '+' : ''}</span
          >
        {/if}
      </span>
    </div>

    <div class="nav">
      <button
        class="ico"
        disabled={find.hits.length === 0}
        onclick={() => step(-1)}
        title="이전 (Shift+Enter)"
        aria-label="이전 매치"
      >
        <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
          <path d="M5 2.2L8.4 6.6H1.6z" fill="currentColor" />
        </svg>
      </button>
      <button
        class="ico"
        disabled={find.hits.length === 0}
        onclick={() => step(1)}
        title="다음 (Enter)"
        aria-label="다음 매치"
      >
        <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
          <path d="M5 7.8L1.6 3.4h6.8z" fill="currentColor" />
        </svg>
      </button>
    </div>

    <span class="divider"></span>

    <button
      class="tog"
      class:on={find.regex}
      onclick={() => {
        find.toggleRegex()
        afterOptionChange()
      }}
      title="정규식 — Alt+R">.*</button
    >
    <button
      class="tog"
      class:on={find.caseSensitive}
      onclick={() => {
        find.toggleCase()
        afterOptionChange()
      }}
      title="대소문자 구분 — Alt+C">Aa</button
    >
    <button
      class="tog"
      class:on={find.wholeCell}
      onclick={() => {
        find.toggleWhole()
        afterOptionChange()
      }}
      title="셀 전체 일치 — Alt+W">[·]</button
    >

    <span class="divider"></span>

    <button class="txt" onclick={onOpenReplace} title="바꾸기 (Ctrl+H)">바꾸기…</button>
    <button class="ico" onclick={onClose} title="닫기 (Esc)" aria-label="닫기">✕</button>
  </div>

  {#if find.selectionUsable}
    <label class="scope">
      <input
        type="checkbox"
        bind:checked={find.inSelection}
        onchange={afterOptionChange}
      />
      선택 영역에서만
    </label>
  {/if}

  {#if find.error}
    <p class="err" role="alert">{find.error}</p>
  {:else if active && find.hits.length > 0}
    <div class="list" bind:this={listEl} role="listbox" aria-label="매치 목록" tabindex="-1">
      {#each shown as h, i (h.r * 4096 + h.c)}
        <button
          class="hit"
          class:on={i === find.cursor}
          role="option"
          aria-selected={i === find.cursor}
          onclick={() => pick(i)}
        >
          <span class="loc">
            <b>{num(h.r + 1)}</b><span class="sep">·</span><span class="cn" title={colName(h.c)}
              >{colName(h.c)}</span
            >
          </span>
          <span class="val">
            {#each pieces(h) as p, pi (pi)}{#if p.hit}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}
          </span>
        </button>
      {/each}
      {#if find.hits.length > LIST_RENDER}
        <p class="more">
          상위 {num(LIST_RENDER)}건만 표시 · 전체 {num(find.hits.length)}{find.truncated
            ? '+'
            : ''}건은 Enter로 순회
          {#if find.truncated}<br />({num(FIND_LIMIT)}건에서 집계를 멈췄습니다 — 검색어를 좁혀
            주세요){/if}
        </p>
      {/if}
    </div>
  {:else if active}
    <p class="empty">일치하는 셀이 없습니다</p>
  {/if}
</div>

<style>
  .panel {
    position: absolute;
    top: 8px;
    right: 14px;
    z-index: var(--z-popover);
    width: min(460px, calc(100vw - 28px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: drop 150ms var(--ease);
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px;
  }

  .field-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    height: 26px;
    padding: 0 6px 0 7px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 5px;
    transition: border-color var(--dur) var(--ease);
  }
  .field-wrap:focus-within {
    border-color: var(--find-line);
  }
  .field-wrap.error {
    border-color: var(--danger);
  }
  .lens {
    flex: none;
    display: grid;
    place-items: center;
    color: var(--text-faint);
  }
  .field-wrap input {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    outline: none;
    font-size: 12px;
    color: inherit;
  }
  .count {
    flex: none;
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }
  .count .dim {
    color: var(--text-faint);
  }

  .nav {
    display: flex;
    gap: 1px;
    flex: none;
  }

  .ico {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    color: var(--text-faint);
    font-size: 10px;
    flex: none;
    transition:
      background var(--dur) var(--ease),
      color var(--dur) var(--ease);
  }
  .ico:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text);
  }
  .ico:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .tog {
    flex: none;
    display: grid;
    place-items: center;
    min-width: 24px;
    height: 20px;
    padding: 0 4px;
    border-radius: 4px;
    color: var(--text-faint);
    font-size: 10.5px;
    letter-spacing: -0.02em;
    transition:
      background var(--dur) var(--ease),
      color var(--dur) var(--ease);
  }
  .tog:hover {
    background: var(--bg-hover);
    color: var(--text-dim);
  }
  .tog.on {
    background: var(--find-line);
    color: var(--find-on-text);
    font-weight: 700;
  }

  .txt {
    flex: none;
    height: 22px;
    padding: 0 7px;
    border-radius: 4px;
    color: var(--text-dim);
    font-size: 11px;
    white-space: nowrap;
  }
  .txt:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .scope {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px 7px;
    color: var(--text-dim);
    font-size: 11px;
    cursor: pointer;
  }
  .scope input {
    accent-color: var(--find-line);
    margin: 0;
  }

  .err {
    margin: 0;
    padding: 5px 10px 8px;
    color: var(--danger);
    font-size: 11px;
  }
  .empty {
    margin: 0;
    padding: 10px;
    text-align: center;
    color: var(--text-faint);
    font-size: 11px;
    border-top: 1px solid var(--border-soft);
  }

  .list {
    max-height: 260px;
    overflow-y: auto;
    border-top: 1px solid var(--border);
    padding: 3px;
  }

  .hit {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 3px 6px;
    border-radius: 4px;
    text-align: left;
    font-size: 11.5px;
    transition: background var(--dur) var(--ease);
  }
  .hit:hover {
    background: var(--bg-hover);
  }
  .hit.on {
    background: color-mix(in srgb, var(--find-line) 16%, transparent);
    box-shadow: inset 0 0 0 1px var(--find-line);
  }

  .loc {
    flex: none;
    display: flex;
    align-items: baseline;
    gap: 3px;
    width: 118px;
    overflow: hidden;
    color: var(--text-faint);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }
  .loc b {
    color: var(--text-dim);
    font-weight: 600;
  }
  .loc .sep {
    opacity: 0.5;
  }
  .loc .cn {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .val {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre;
    color: var(--text);
  }
  .val :global(mark) {
    background: var(--find-bg);
    color: var(--find-text);
    border-radius: 2px;
    padding: 0 1px;
    margin: 0 -1px;
  }

  .more {
    margin: 4px 0 2px;
    text-align: center;
    color: var(--text-faint);
    font-size: 10px;
    line-height: 1.5;
  }
</style>
