<script lang="ts">
  /**
   * 쿼리 패널 — jq 필터 입력, 자동완성, 히스토리·저장 쿼리.
   *
   * 자동완성의 판단은 전부 `autocomplete/engine.svelte.ts` 에 있고, 여기서는 textarea 이벤트를
   * 엔진에 넘기고 팝업을 그린다. 팝업은 캐럿 좌표에 뷰포트 고정으로 뜬다.
   */
  import { dialogs } from '../../../lib/ui/dialog/dialog.svelte'
  import { toasts } from '../../../lib/ui/toasts.svelte'
  import AutocompletePopup from '../autocomplete/AutocompletePopup.svelte'
  import { AutocompleteEngine } from '../autocomplete/engine.svelte'
  import { saveSavedQuery } from '../data/storage'
  import { jq } from '../jqState.svelte'
  import { handleTabKey } from '../utils/keyboard'
  import QueryHistoryMenu from './QueryHistoryMenu.svelte'
  import SavedQueriesMenu from './SavedQueriesMenu.svelte'

  let ta = $state<HTMLTextAreaElement | null>(null)
  let historyOpen = $state(false)
  let savedOpen = $state(false)
  let historyBtn = $state<HTMLButtonElement | null>(null)
  let savedBtn = $state<HTMLButtonElement | null>(null)

  const ac = new AutocompleteEngine({
    el: () => ta,
    inputText: () => jq.input,
    setQuery: (text, cursor) => {
      jq.query = text
      // DOM 반영 뒤에 커서를 놓아야 한다(값 갱신이 커서를 끝으로 밀어 버린다)
      queueMicrotask(() => {
        if (!ta) return
        ta.value = text
        ta.selectionStart = ta.selectionEnd = cursor
      })
    },
  })

  export function focus(): void {
    ta?.focus()
  }

  export function closePopups(): void {
    historyOpen = false
    savedOpen = false
    ac.hide()
  }

  /** 열려 있는 것 하나를 닫고 true */
  export function closeTop(): boolean {
    if (ac.open) {
      ac.hide()
      return true
    }
    if (historyOpen) {
      historyOpen = false
      return true
    }
    if (savedOpen) {
      savedOpen = false
      return true
    }
    return false
  }

  /** 외부(치트시트·스니펫·팰릿)에서 쿼리를 넣을 때 */
  export function setQuery(q: string, selectPlaceholder = false): void {
    jq.query = q
    queueMicrotask(() => {
      if (!ta) return
      ta.value = q
      ta.focus()
      if (selectPlaceholder) {
        const i = q.indexOf('"qsp"')
        if (i !== -1) ta.setSelectionRange(i + 1, i + 4)
      }
    })
  }

  /** 치트시트처럼 현재 쿼리 뒤에 파이프로 잇는 경우 */
  export function appendQuery(q: string): void {
    const cur = jq.query
    setQuery(cur.trim() === '' ? q : cur + ' | ' + q)
  }

  function onInput(): void {
    if (!ta) return
    ac.trimContextCache(ta.value, ta.selectionStart)
    void ac.update()
  }

  function onKeydown(e: KeyboardEvent): void {
    // Ctrl+Enter 는 언제나 최우선
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault()
      ac.hide()
      jq.runNow()
      return
    }

    if (ac.handleKeydown(e)) {
      e.preventDefault()
      return
    }

    // Ctrl+Shift+F: 쿼리 정돈(파이프 주위 공백 정리)
    if (e.ctrlKey && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
      e.preventDefault()
      formatQuery()
      return
    }

    handleTabKey(e)
    if (e.key === 'Tab' && ta) jq.query = ta.value
  }

  function formatQuery(): void {
    const v = jq.query.trim()
    if (!v) return
    setQuery(
      v
        .replace(/\|/g, ' | ')
        .replace(/\s+\|\s+/g, ' | ')
        .replace(/\s+/g, ' '),
    )
  }

  async function saveCurrent(): Promise<void> {
    const q = jq.query.trim()
    if (!q) {
      await dialogs.alert({ message: '저장할 쿼리를 입력하세요.' })
      return
    }
    const name = await dialogs.prompt({
      title: '쿼리 저장',
      message: '이 쿼리를 어떤 이름으로 저장할까요?',
      placeholder: '예: 서울 사용자만',
      validate: (v) => (v.trim() ? null : '이름을 입력하세요'),
    })
    if (name === null) return
    await saveSavedQuery(name.trim(), q)
    toasts.push('쿼리를 저장했습니다.', 'ok')
  }

  function onBlur(): void {
    // 후보 클릭 시 blur 가 먼저 오므로 한 박자 늦춰 닫는다
    setTimeout(() => {
      if (document.activeElement !== ta) ac.hide()
    }, 150)
  }

  $effect(() => {
    const onResize = (): void => {
      if (ac.open) ac.reposition()
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      ac.dispose()
    }
  })
</script>

<section class="panel" aria-label="jq 쿼리">
  <header class="panel-head">
    <span class="panel-title">Query</span>
    <div class="panel-actions">
      <button class="btn primary" title="실행 (Ctrl+Enter)" onclick={() => jq.runNow()}>실행</button>
      <button class="btn" onclick={() => void saveCurrent()}>저장</button>
      <button bind:this={savedBtn} class="btn" class:on={savedOpen} onclick={() => (savedOpen = !savedOpen)}>
        저장됨
      </button>
      <button bind:this={historyBtn} class="btn" class:on={historyOpen} onclick={() => (historyOpen = !historyOpen)}>
        히스토리
      </button>
      <button class="btn" onclick={() => setQuery('')}>비우기</button>
    </div>

    {#if historyOpen}
      <QueryHistoryMenu
        onPick={(q) => {
          setQuery(q)
          historyOpen = false
        }}
        onClose={() => (historyOpen = false)}
        anchor={historyBtn}
      />
    {/if}
    {#if savedOpen}
      <SavedQueriesMenu
        onPick={(q) => {
          setQuery(q)
          savedOpen = false
        }}
        onClose={() => (savedOpen = false)}
        anchor={savedBtn}
      />
    {/if}
  </header>

  <div class="panel-body">
    <textarea
      bind:this={ta}
      bind:value={jq.query}
      spellcheck="false"
      placeholder="jq 필터를 입력하세요..."
      aria-label="jq 쿼리 입력"
      aria-autocomplete="list"
      oninput={onInput}
      onkeydown={onKeydown}
      onblur={onBlur}
      onscroll={() => ac.open && ac.reposition()}
      onclick={() => void ac.update()}
    ></textarea>
  </div>
</section>

{#if ac.open && ac.items.length > 0}
  <AutocompletePopup
    items={ac.items}
    selected={ac.selected}
    top={ac.pos.top}
    left={ac.pos.left}
    maxHeight={ac.pos.maxHeight}
    hoverLocked={ac.hoverLocked}
    onPick={(item) => ac.apply(item)}
    onHover={(i) => ac.hoverItem(i)}
    onHoverOut={() => ac.hoverOut()}
  />
{/if}

<style>
  .panel {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 7px;
    overflow: hidden;
    /* 헤더에 붙는 팝오버는 헤더가 아니라 패널을 기준으로 배치한다 — 패널이 overflow:hidden 이라
       헤더 기준 max-height 는 패널 밖으로 삐져나가 잘린다 */
    position: relative;
  }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex: none;
    height: var(--header-h);
    padding: 0 6px;
    background: var(--bg-header);
    border-bottom: 1px solid var(--border);
  }

  .panel-title {
    padding-left: 4px;
    font-size: var(--fs-label);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .panel-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .panel-actions :global(.btn) {
    height: 22px;
    padding: 0 7px;
    font-size: var(--fs-label);
  }

  .panel-body {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
  }

  textarea {
    flex: 1;
    min-width: 0;
    padding: 8px 10px;
    background: var(--bg-raised);
    border: none;
    outline: none;
    resize: none;
    font-family: var(--font-mono);
    font-size: var(--fs-cell);
    line-height: 1.55;
    color: var(--text);
    tab-size: 4;
  }
  textarea::placeholder {
    color: var(--text-faint);
  }
</style>
