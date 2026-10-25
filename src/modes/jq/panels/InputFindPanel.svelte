<script lang="ts">
  /**
   * 입력 JSON 안에서 키·값 찾기. 결과를 고르면 textarea 의 해당 구간을 선택하고 스크롤한다.
   *
   * 2MB 를 넘으면 스캐너가 포기하므로(포지션 스캔이 O(n) 메모리다) 대신 같은 일을 하는
   * jq 쿼리를 쿼리 패널에 넣어 준다 — 원본 `InputPanel.ts:performFindSearch` 의 동작.
   *
   * 결과 목록은 행 높이가 고정인 가상 스크롤이다 — 스캐너가 최대 5000개까지 내므로 전부 DOM 에
   * 올리지 않고 보이는 구간(+여유)만 그린다. 표시 개수 상한(예전 200)은 없다.
   */
  import { dismissable } from '../../../lib/ui/dismiss'
  import { filterEntries, MAX_ENTRIES, scanJson, type JsonEntry } from '../utils/json-position-scanner'
  import { decodeStringified } from '../utils/stringified-fields'
  import { getTextOffsetTop } from '../autocomplete/caret'
  import { load, save } from '../../../lib/util/storage'

  interface Props {
    /** 검색 대상 textarea — 선택·스크롤을 직접 조작한다 */
    textarea: HTMLTextAreaElement | null
    text: string
    onClose: () => void
    /** 2MB 초과 시 쿼리 패널에 주입할 쿼리 */
    onInjectQuery: (query: string) => void
    /** ↧ 버튼 — 이 경로만 unstringify 하도록 Transform 을 연다 */
    onUnstringify: (path: string) => void
    /** 바깥 클릭 판정에서 제외할 앵커 버튼 */
    anchor?: HTMLElement | null
  }
  let { textarea, text, onClose, onInjectQuery, onUnstringify, anchor }: Props = $props()

  const SCAN_LIMIT = 2 * 1024 * 1024
  /** 입력이 바뀐 뒤 다시 스캔하기까지의 대기 — 포커스가 textarea 로 넘어간 채 타이핑해도 매 키마다 스캔하지 않게 */
  const RESCAN_MS = 250
  /** 행 높이(px). CSS `.row` 와 같아야 한다 */
  const ROW_H = 26
  const OVERSCAN = 6

  let term = $state('')
  let keys = $state(true)
  let values = $state(true)
  let regex = $state<boolean>(load('jq.inputFindRegex', true))
  let inputEl = $state<HTMLInputElement | null>(null)
  let activeIdx = $state(-1)
  let debounce: ReturnType<typeof setTimeout> | null = null
  let applied = $state('')
  let injected = $state(false)
  let listEl = $state<HTMLDivElement | null>(null)
  let scrollTop = $state(0)
  let viewH = $state(0)

  let entries = $state.raw<JsonEntry[]>([])
  /** `entries` 를 만든 텍스트 — 재스캔 대기 중에 오래된 위치로 이동하지 않도록 비교한다 */
  let scannedFor: string | null = null
  let scanTimer: ReturnType<typeof setTimeout> | null = null

  const tooLarge = $derived(text.length > SCAN_LIMIT)

  const regexError = $derived.by(() => {
    if (!regex || !applied.trim()) return false
    try {
      new RegExp(applied)
      return false
    } catch {
      return true
    }
  })

  const results = $derived.by(() => {
    if (tooLarge || regexError) return []
    return filterEntries(entries, applied, keys, values, regex)
  })

  /** 스캐너가 항목 수 상한에서 멈췄는지 — 뒤쪽 항목은 검색되지 않는다 */
  const scanCapped = $derived(entries.length >= MAX_ENTRIES)

  const winStart = $derived(Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN))
  const winEnd = $derived(Math.min(results.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN))
  const windowed = $derived(results.slice(winStart, winEnd))

  function onInput(): void {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      applied = term
    }, 200)
  }

  function toggleRegex(): void {
    regex = !regex
    save('jq.inputFindRegex', regex)
  }

  /** 2MB 초과 시 — 범용 패턴 검색 쿼리를 만들어 쿼리 패널로 보낸다 */
  function injectBigQuery(): void {
    const t = term.trim()
    if (!t) return
    const escaped = t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    onInjectQuery(
      `"${escaped}" as $pattern |\n` +
        `[ paths(scalars) as $p |\n` +
        `  select(\n` +
        `    (getpath($p) | tostring | (. != "") and test($pattern; "i")) or\n` +
        `    ($p | last | tostring | test($pattern; "i")) // false\n` +
        `  ) |\n` +
        `  { ($p | map(tostring) | join(".")): getpath($p) }\n` +
        `] | add`,
    )
    injected = true
  }

  function flushScan(): void {
    if (scanTimer) clearTimeout(scanTimer)
    scanTimer = null
    entries = tooLarge ? [] : scanJson(text)
    scannedFor = text
  }

  function goto(e: JsonEntry, i: number): void {
    if (!textarea) return
    // 입력이 바뀐 직후라면 위치가 어긋나 있다 — 새로 스캔해 목록만 갱신하고 이동은 다음 클릭에 맡긴다
    if (scannedFor !== text) {
      flushScan()
      return
    }
    const hasKey = e.key !== null && e.keyStart < e.keyEnd
    const start = hasKey ? e.keyStart : e.valueStart
    const end = hasKey ? e.keyEnd : e.valueEnd
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 18
    const top = getTextOffsetTop(textarea, start)
    textarea.focus()
    textarea.setSelectionRange(start, end)
    textarea.scrollTop = Math.max(0, top + lineHeight / 2 - textarea.clientHeight / 2)
    activeIdx = i
  }

  /** 행마다 JSON.parse 를 반복하지 않도록 항목 단위로 판정을 기억한다(항목이 새로 스캔되면 자연히 버려진다) */
  const unstringCache = new WeakMap<JsonEntry, boolean>()

  /** 이 값이 문자열로 감싸인 JSON인지 — 맞으면 ↧ 버튼을 보여 준다 */
  function unstringifiable(e: JsonEntry): boolean {
    const hit = unstringCache.get(e)
    if (hit !== undefined) return hit
    const ok = checkUnstringifiable(e)
    unstringCache.set(e, ok)
    return ok
  }

  function checkUnstringifiable(e: JsonEntry): boolean {
    const literal = text.slice(e.valueStart, e.valueEnd)
    if (!literal.startsWith('"')) return false
    // 풀릴 문자열에는 `{` `[` `%` 중 하나가 반드시 있다 — 없으면 큰 문자열을 파싱하지 않는다
    if (!/[{[%]/.test(literal)) return false
    try {
      const s: unknown = JSON.parse(literal)
      return typeof s === 'string' && decodeStringified(s) !== null
    } catch {
      return false
    }
  }

  /** 검색어 매치 부분을 <mark> 로 쪼갠다 */
  function segments(value: string): { t: string; hit: boolean }[] {
    if (!applied) return [{ t: value, hit: false }]
    let re: RegExp
    try {
      re = regex
        ? new RegExp(applied, 'gi')
        : new RegExp(applied.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    } catch {
      return [{ t: value, hit: false }]
    }
    const out: { t: string; hit: boolean }[] = []
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(value)) !== null) {
      if (m.index > last) out.push({ t: value.slice(last, m.index), hit: false })
      out.push({ t: m[0], hit: true })
      last = m.index + m[0].length
      if (m[0].length === 0) re.lastIndex++
    }
    if (last < value.length) out.push({ t: value.slice(last), hit: false })
    return out
  }

  /** Escape로 닫힐 때 입력으로 포커스를 되돌린다 */
  function closeAndRefocus(): void {
    onClose()
    textarea?.focus()
  }

  /** 키보드로 옮긴 행이 보이도록 목록을 스크롤한다 */
  function reveal(i: number): void {
    if (!listEl) return
    const top = i * ROW_H
    const bottom = top + ROW_H + 8 // 위아래 padding 4px 씩
    if (top < listEl.scrollTop) listEl.scrollTop = top
    else if (bottom > listEl.scrollTop + listEl.clientHeight) listEl.scrollTop = bottom - listEl.clientHeight
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (tooLarge) injectBigQuery()
      else {
        const i = activeIdx >= 0 ? activeIdx : 0
        const target = results[i]
        if (target) goto(target, i)
      }
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && results.length > 0) {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      activeIdx = activeIdx < 0 ? (step === 1 ? 0 : results.length - 1) : (activeIdx + step + results.length) % results.length
      reveal(activeIdx)
    }
  }

  // 텍스트가 바뀌면 스캔 캐시를 버린다. 첫 스캔은 즉시, 그 뒤로는 타이핑이 멎은 다음에 한다.
  $effect(() => {
    const t = text
    if (tooLarge) {
      entries = []
      scannedFor = t
      return
    }
    if (scannedFor === null) {
      flushScan()
      return
    }
    if (scanTimer) clearTimeout(scanTimer)
    scanTimer = setTimeout(flushScan, RESCAN_MS)
    return () => {
      if (scanTimer) clearTimeout(scanTimer)
      scanTimer = null
    }
  })

  // 결과 집합이 바뀌면 맨 위부터 다시 본다
  $effect(() => {
    void results
    activeIdx = -1
    scrollTop = 0
    if (listEl) listEl.scrollTop = 0
  })

  $effect(() => {
    inputEl?.focus()
    inputEl?.select()
  })
</script>

<div class="find pop" {@attach dismissable(closeAndRefocus, { ignore: () => [anchor] })}>
  <div class="find-head">
    <input
      bind:this={inputEl}
      class="field"
      type="text"
      placeholder={regex ? '정규식 패턴...' : '키·값 검색...'}
      bind:value={term}
      oninput={onInput}
      onkeydown={onKeydown}
    />
    <label class="chk"><input type="checkbox" bind:checked={keys} /> 키</label>
    <label class="chk"><input type="checkbox" bind:checked={values} /> 값</label>
    <button class="btn outline" class:on={regex} onclick={toggleRegex} title="정규식 사용">.*</button>
    <span class="count">
      {#if tooLarge}2MB+{:else if regexError}정규식 오류{:else if applied.trim()}{results.length.toLocaleString()}개{/if}
    </span>
    <button class="btn icon" onclick={onClose} title="닫기 (Esc)">×</button>
  </div>

  {#if tooLarge}
    <div class="find-list">
      <p class="empty">
        입력이 2MB를 넘어 위치 스캔을 쓸 수 없습니다.
        {#if injected}
          쿼리 패널에 범용 검색 쿼리를 넣었습니다.
        {:else}
          검색어를 입력하고 Enter를 누르면 같은 일을 하는 jq 쿼리를 넣어 드립니다.
        {/if}
      </p>
    </div>
  {:else if regexError}
    <div class="find-list"><p class="empty">정규식 오류: 올바른 패턴을 입력하세요</p></div>
  {:else if !applied.trim()}
    <div class="find-list">
      <p class="empty">
        {entries.length > 0 ? `${entries.length}개 항목. 검색어를 입력하세요.` : 'JSON 항목이 없습니다'}
      </p>
    </div>
  {:else if results.length === 0}
    <div class="find-list"><p class="empty">일치하는 항목 없음</p></div>
  {:else}
    <div
      bind:this={listEl}
      bind:clientHeight={viewH}
      class="find-list"
      onscroll={(ev) => (scrollTop = ev.currentTarget.scrollTop)}
    >
      <div class="spacer" style:height="{results.length * ROW_H}px">
        <div class="rows" style:top="{winStart * ROW_H}px">
          {#each windowed as e, k (e.path + ':' + e.valueStart)}
            {@const i = winStart + k}
            <div class="row" class:active={i === activeIdx}>
              <button class="row-main" onclick={() => goto(e, i)}>
                <span class="path">
                  {#each segments(e.path) as s}{#if s.hit}<mark>{s.t}</mark>{:else}{s.t}{/if}{/each}
                </span>
                <span class="value">
                  {#each segments(e.value) as s}{#if s.hit}<mark>{s.t}</mark>{:else}{s.t}{/if}{/each}
                </span>
              </button>
              {#if unstringifiable(e)}
                <button class="btn icon" title="이 필드만 unstringify" onclick={() => onUnstringify(e.path)}>
                  ↧
                </button>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    </div>
    {#if scanCapped}
      <p class="note">항목이 {MAX_ENTRIES.toLocaleString()}개를 넘어 앞쪽 {MAX_ENTRIES.toLocaleString()}개만 검색합니다.</p>
    {/if}
  {/if}
</div>

<style>
  .find {
    position: absolute;
    top: calc(var(--header-h) + 4px);
    right: 0;
    z-index: var(--z-popover);
    width: min(620px, 92vw);
    display: flex;
    flex-direction: column;
    max-height: min(60vh, calc(100% - var(--header-h) - 12px));
  }
  .find-head {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 7px;
    border-bottom: 1px solid var(--border-soft);
  }
  .find-head .field {
    flex: 1;
    min-width: 0;
  }
  .chk {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: var(--fs-label);
    color: var(--text-dim);
    white-space: nowrap;
  }
  .count {
    min-width: 46px;
    text-align: right;
    font-size: var(--fs-label);
    color: var(--text-faint);
  }
  .find-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px;
  }
  .spacer {
    position: relative;
  }
  .rows {
    position: absolute;
    left: 0;
    right: 0;
  }
  .note {
    flex: none;
    margin: 0;
    padding: 5px 10px;
    border-top: 1px solid var(--border-soft);
    font-size: var(--fs-label);
    color: var(--text-faint);
  }
  .empty {
    margin: 0;
    padding: 16px;
    text-align: center;
    color: var(--text-faint);
    line-height: 1.6;
  }
  .row {
    display: flex;
    align-items: center;
    height: 26px; /* ROW_H 와 같아야 한다 */
    box-sizing: border-box;
    border-radius: 5px;
  }
  .row:hover {
    background: var(--bg-hover);
  }
  .row.active {
    background: var(--accent-soft);
  }
  .row-main {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
    gap: 10px;
    align-items: center;
    height: 100%;
    padding: 0 7px;
    text-align: left;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
  }
  .path {
    color: var(--accent);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .value {
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  mark {
    background: var(--find-bg);
    color: var(--find-text);
    border-radius: 2px;
  }
</style>
