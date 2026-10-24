<script lang="ts">
  import type { View } from '../data/view.svelte'
  import { debounce } from '../util/debounce'
  import { num } from '../util/format'
  import { save } from '../util/storage'

  interface Props {
    view: View
    totalRows: number
    /** 정규식 모드를 기억할 localStorage 키. 모드마다 달라야 Alt+R 상태가 전이되지 않는다 */
    storageKey?: string
  }
  let { view, totalRows, storageKey = 'regexMode' }: Props = $props()

  /** 디바운스를 걸기 전 즉시 반영되는 입력값 (view.query와 분리) */
  let raw = $state('')
  let inputEl = $state<HTMLInputElement | null>(null)

  /**
   * 2자 이상일 때만 250ms 디바운스로 적용한다.
   *
   * 1자는 대개 오타 중간 상태이고 매치 결과가 너무 넓어 의미가 없다. 다만 **지우는 방향**은
   * 즉시 반영해야 한다 — 빈 문자열이면 필터를 바로 풀어 준다.
   */
  const applyDebounced = debounce((v: string) => {
    view.query = v
  }, 250)

  function onInput(): void {
    if (raw === '') {
      applyDebounced.cancel()
      view.query = ''
      return
    }
    if (raw.length < 2) {
      // 1자 상태에서는 아직 적용하지 않되, 이전 필터가 남아 있으면 풀어 준다
      applyDebounced.cancel()
      if (view.query !== '') view.query = ''
      return
    }
    applyDebounced(raw)
  }

  function onKeyDown(e: KeyboardEvent): void {
    // Alt+R — 정규식 토글 (입력에 포커스가 있을 때)
    if (e.altKey && (e.key === 'r' || e.key === 'R')) {
      e.preventDefault()
      toggleRegex()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      if (raw !== '') {
        clear()
      } else {
        inputEl?.blur()
      }
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      applyDebounced.flush()
      return
    }
    e.stopPropagation() // 그리드 전역 단축키로 새지 않게
  }

  function toggleRegex(): void {
    view.regexMode = !view.regexMode
    save(storageKey, view.regexMode)
  }

  export function focus(): void {
    inputEl?.focus()
    inputEl?.select()
  }

  export function clear(): void {
    applyDebounced.cancel()
    raw = ''
    view.query = ''
  }

  const active = $derived(view.query !== '')
  const error = $derived(view.matcher.error)
  const shown = $derived(view.visibleCount)
  const hiddenCount = $derived(totalRows - shown)
</script>

<div class="wrap" class:active class:error={!!error}>
  {#if active}
    <!-- 건수 배지 — 클릭하면 필터 초기화 -->
    <button
      class="pill"
      onclick={clear}
      title="필터 초기화 ({num(hiddenCount)}개 숨겨짐)"
      aria-label="필터 초기화"
    >
      <span class="pill-n">{num(shown)}</span>
      <span class="pill-x" aria-hidden="true">✕</span>
    </button>
  {:else}
    <span class="lens" aria-hidden="true">
      <svg viewBox="0 0 12 12" width="12" height="12">
        <circle cx="5" cy="5" r="3.4" fill="none" stroke="currentColor" stroke-width="1.3" />
        <path d="M7.6 7.6L10.6 10.6" stroke="currentColor" stroke-width="1.3" fill="none" />
      </svg>
    </span>
  {/if}

  <input
    bind:this={inputEl}
    bind:value={raw}
    oninput={onInput}
    onkeydown={onKeyDown}
    placeholder={view.regexMode ? '정규식으로 행 검색…' : '검색 —  공백=OR,  콤마=AND'}
    spellcheck="false"
    autocomplete="off"
    aria-label="스마트 필터"
  />

  {#if !active && !raw}
    <span class="hint"><span class="kbd">/</span></span>
  {/if}

  <button
    class="re"
    class:on={view.regexMode}
    onclick={toggleRegex}
    title="정규식 {view.regexMode ? '켜짐' : '꺼짐'} — Alt+R"
    aria-pressed={view.regexMode}
  >
    .*
  </button>
</div>

{#if error}
  <div class="err" role="alert">{error}</div>
{/if}

<style>
  .wrap {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 180px;
    max-width: 620px;
    height: 30px;
    padding: 0 5px 0 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    transition:
      border-color var(--dur) var(--ease),
      box-shadow var(--dur) var(--ease);
  }
  .wrap:focus-within {
    border-color: var(--accent-line);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .wrap.active {
    border-color: var(--accent-line);
  }
  .wrap.error {
    border-color: var(--danger);
  }

  .lens {
    flex: none;
    display: grid;
    place-items: center;
    color: var(--text-faint);
  }

  input {
    flex: 1;
    min-width: 0;
    height: 100%;
    background: none;
    border: none;
    outline: none;
    font-size: var(--fs-ui);
  }
  input::placeholder {
    color: var(--text-faint);
  }

  .hint {
    flex: none;
    pointer-events: none;
    opacity: 0.75;
  }

  /* --- 건수 배지 --- */
  .pill {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 20px;
    padding: 0 5px 0 7px;
    background: var(--accent-soft);
    border: 1px solid var(--accent-line);
    border-radius: 10px;
    color: var(--accent);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    animation: pop 180ms var(--ease);
    transition: background var(--dur) var(--ease);
  }
  .pill:hover {
    background: var(--accent);
    color: var(--accent-text);
  }
  .pill-n {
    font-weight: 600;
  }
  .pill-x {
    font-size: 8px;
    opacity: 0.7;
  }
  @keyframes pop {
    from {
      transform: scale(0.82);
      opacity: 0;
    }
  }

  /* --- 정규식 토글 --- */
  .re {
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    height: 20px;
    border-radius: 4px;
    color: var(--text-faint);
    font-size: 11px;
    letter-spacing: -0.04em;
    transition:
      background var(--dur) var(--ease),
      color var(--dur) var(--ease);
  }
  .re:hover {
    background: var(--bg-hover);
    color: var(--text-dim);
  }
  .re.on {
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 700;
  }

  .err {
    position: absolute;
    top: calc(var(--toolbar-h) - 4px);
    left: 50%;
    transform: translateX(-50%);
    padding: 4px 9px;
    background: var(--bg-raised);
    border: 1px solid var(--danger);
    border-radius: 5px;
    box-shadow: var(--shadow-pop);
    color: var(--danger);
    font-size: 11px;
    white-space: nowrap;
    z-index: 40;
  }
</style>
