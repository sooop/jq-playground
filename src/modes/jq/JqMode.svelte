<script lang="ts">
  /**
   * jq 모드 — 입력 / 쿼리 / 출력 세 패널과 모드 툴바.
   *
   * 셸 규약.
   *  - window keydown 리스너를 달지 않는다. App 이 활성일 때만 `handleKeydown` 을 넘긴다.
   *  - window paste 는 `isActive` 일 때만, 그리고 편집 요소 밖에서 일어났을 때만 받는다.
   *  - 창 전역 드롭은 App 이 `shell.openFiles` 로 라우팅한다. 입력 패널 자체 드롭만 `preventDefault` 로 가로챈다.
   *  - `isActive` 가 꺼지면 팝업·모달을 전부 닫는다.
   */
  import ContextMenu, { type MenuItem } from '../../lib/ui/ContextMenu.svelte'
  import { dialogs } from '../../lib/ui/dialog/dialog.svelte'
  import { toasts } from '../../lib/ui/toasts.svelte'
  import { shell } from '../../shell/shell.svelte'
  import { parsePastedTable } from '../../lib/parse/pasteTable'
  import { fromRawText, tableFromPaste } from './core/input-pipeline'
  import { SAMPLE_INPUT, SAMPLE_QUERY } from './data/sample'
  import { saveInputHistory } from './data/storage'
  import { jq } from './jqState.svelte'
  import InputPanel from './panels/InputPanel.svelte'
  import OutputPanel from './panels/OutputPanel.svelte'
  import QueryPanel from './panels/QueryPanel.svelte'
  import TransformDialog from './transform/TransformDialog.svelte'
  import type { TransformOpenOptions } from './transform/options'
  import CheatsheetDialog from './ui/CheatsheetDialog.svelte'
  import CommandPalette from './ui/CommandPalette.svelte'
  import HelpDialog from './ui/HelpDialog.svelte'
  import SnippetsDialog from './ui/SnippetsDialog.svelte'
  import Splitter from './ui/Splitter.svelte'
  import { createKeymap } from './utils/keymap'

  interface Props {
    /** 뷰어에 가려져 있지 않은지 */
    isActive: boolean
  }
  let { isActive }: Props = $props()

  let input = $state<InputPanel | null>(null)
  let query = $state<QueryPanel | null>(null)
  let output = $state<OutputPanel | null>(null)
  let transform = $state<TransformDialog | null>(null)

  let topRow = $state<HTMLElement | null>(null)
  let mainCol = $state<HTMLElement | null>(null)

  let showTransform = $state(false)
  let showCheatsheet = $state(false)
  let showSnippets = $state(false)
  let showHelp = $state(false)
  let showPalette = $state(false)
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null)

  const anyModal = $derived(showTransform || showCheatsheet || showSnippets || showHelp || showPalette)

  // ── 단축키 ─────────────────────────────────────────────────────────────────

  const keymap = createKeymap()
  keymap.registerAll([
    { id: 'palette', keys: 'Ctrl+K', label: '커맨드 팰릿 열기', handler: () => (showPalette = true) },
    { id: 'focus-input', keys: 'Ctrl+1', label: 'Input 패널 포커스', handler: () => input?.focus() },
    { id: 'focus-query', keys: 'Ctrl+2', label: 'Query 패널 포커스', handler: () => query?.focus() },
    { id: 'focus-output', keys: 'Ctrl+3', label: 'Output 패널 포커스', handler: () => output?.focusOutput() },
    { id: 'cycle', keys: 'F6', label: '다음 패널로 포커스', handler: () => cycle(1) },
    { id: 'cycle-back', keys: 'Shift+F6', label: '이전 패널로 포커스', handler: () => cycle(-1) },
    {
      id: 'transform',
      keys: 'Ctrl+Shift+T',
      label: 'JSON Transform',
      description: '로그에서 JSON 추출 / unstringify',
      handler: () => void openTransform(),
    },
    {
      id: 'autoplay',
      keys: 'Ctrl+Shift+E',
      label: '자동 실행 토글',
      handler: () => jq.toggleAutoPlay(),
    },
    {
      id: 'maximize',
      keys: 'Ctrl+Shift+M',
      label: '출력 패널 최대화 토글',
      handler: () => (jq.maximized = !jq.maximized),
    },
    { id: 'help', keys: '?', label: '단축키 목록', handler: () => (showHelp = true) },
  ])

  let focusIdx = 0
  function cycle(dir: 1 | -1): void {
    focusIdx = (focusIdx + dir + 3) % 3
    if (focusIdx === 0) input?.focus()
    else if (focusIdx === 1) query?.focus()
    else output?.focusOutput()
  }

  function inEditable(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null
    if (!el) return false
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
  }

  function closeAllPopups(): void {
    menu = null
    input?.closePopups()
    query?.closePopups()
    output?.closePopups()
  }

  // ── 셸 계약 ────────────────────────────────────────────────────────────────

  export async function openFile(file: File): Promise<void> {
    await input?.openFile(file)
  }

  export async function openText(text: string, name: string): Promise<void> {
    const r = await fromRawText(text, name || null)
    jq.setInput(r.text, r.fileName)
    await saveInputHistory(r.text, r.fileName)
  }

  export function focusMode(): void {
    input?.focus()
  }

  export function handleKeydown(e: KeyboardEvent): boolean {
    // 모달이 떠 있으면 keymap을 넘기지 않는다 — Escape는 셸이 modals.closeTop()으로 이미 처리했다
    if (anyModal) return false

    if (keymap.dispatch(e)) return true

    // 출력이 그리드일 때의 워크벤치 단축키(`/` 필터·Ctrl+F·F3·Ctrl+E)
    if (!inEditable(e.target) && output?.gridKeydown(e)) return true

    if (e.key === 'Escape') {
      if (menu) {
        menu = null
        e.preventDefault()
        return true
      }
      if (input?.closeTop() || query?.closeTop() || output?.closeTop()) {
        e.preventDefault()
        return true
      }
      if (jq.maximized) {
        jq.maximized = false
        e.preventDefault()
        return true
      }
    }
    return false
  }

  // ── 툴바 ───────────────────────────────────────────────────────────────────

  function openMenu(e: MouseEvent, items: MenuItem[]): void {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    menu = { x: rect.left, y: rect.bottom + 2, items }
  }

  const fileMenu: MenuItem[] = [
    { label: '샘플 불러오기', accel: 's', run: loadSample },
    { label: '파일 열기…', accel: 'o', run: () => shell.requestOpen() },
    { label: '클립보드의 표를 뷰어로 열기', accel: 'v', run: () => void openClipboardTable() },
    { label: '', sep: true },
    { label: '입력 비우기', accel: 'c', run: () => jq.setInput('', null) },
  ]
  const viewMenu: MenuItem[] = [
    { label: '스니펫', accel: 'n', run: () => (showSnippets = true) },
    { label: '문법 참조', accel: 'r', run: () => (showCheatsheet = true) },
    { label: '', sep: true },
    {
      label: '출력 패널 최대화',
      accel: 'm',
      hint: 'Ctrl Shift M',
      run: () => (jq.maximized = !jq.maximized),
    },
  ]
  const toolsMenu: MenuItem[] = [
    { label: 'JSON Transform…', accel: 't', hint: 'Ctrl Shift T', run: () => void openTransform() },
    { label: '커맨드 팰릿…', accel: 'k', hint: 'Ctrl K', run: () => (showPalette = true) },
  ]
  const helpMenu: MenuItem[] = [
    { label: '단축키', accel: 's', hint: '?', run: () => (showHelp = true) },
    { label: 'jq 매뉴얼 열기', accel: 'm', run: () => window.open('https://jqlang.github.io/jq/manual/', '_blank') },
  ]

  function loadSample(): void {
    jq.setInput(SAMPLE_INPUT, 'sample.json')
    query?.setQuery(SAMPLE_QUERY)
  }

  // ── Transform ──────────────────────────────────────────────────────────────

  async function openTransform(opts: TransformOpenOptions = {}): Promise<void> {
    showTransform = true
    // 모달이 마운트된 뒤에 열기 절차를 태운다(클립보드 읽기·크기 확인 포함)
    await Promise.resolve()
    const ok = await transform?.open({ source: 'input', extract: true, ...opts })
    if (!ok) showTransform = false
  }

  function applyTransform(text: string): void {
    const snapshot = jq.input
    const name = jq.inputName
    jq.setInput(text, name)
    jq.transformUndo = () => {
      jq.input = snapshot
      jq.inputName = name
    }
    showTransform = false
  }

  /** 클립보드의 표(HTML·마크다운·박스 문자·목록·CSV/TSV·JSON)를 입력을 건드리지 않고 뷰어로 연다. */
  async function openClipboardTable(): Promise<void> {
    let text = ''
    let html: string | undefined
    try {
      for (const item of await navigator.clipboard.read()) {
        if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text()
        if (item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text()
      }
    } catch {
      try {
        text = await navigator.clipboard.readText()
      } catch {
        await dialogs.alert({ message: '클립보드를 읽을 수 없습니다. 권한을 확인하세요.', tone: 'warn' })
        return
      }
    }
    const t = parsePastedTable(text, html)
    if (!t) {
      await dialogs.alert({ message: '클립보드에서 표 형식을 찾지 못했습니다.', tone: 'warn' })
      return
    }
    shell.openViewer({ kind: 'table', header: t.header, rows: t.rows, name: '붙여넣은 표', from: 'paste' })
  }

  // ── 확대(뷰어) ─────────────────────────────────────────────────────────────

  async function expandOutput(): Promise<void> {
    const m = jq.matrix
    if (!m || m.header.length === 0) {
      await dialogs.alert({ message: '표 형식(CSV)의 결과가 있어야 확대할 수 있습니다.', tone: 'warn' })
      return
    }
    shell.openViewer({
      kind: 'table',
      header: m.header,
      rows: m.rows,
      name: jq.inputName ?? 'jq 결과',
      from: 'jq',
    })
  }

  // ── 수명주기 ───────────────────────────────────────────────────────────────

  jq.onNotice = (msg, kind) => toasts.push(msg, kind)

  // 실행 디바운스 effect 는 한 번만 건다. 정리 함수를 두지 않는 이유: 이 모드는 한 번
  // 마운트되면 앱이 끝날 때까지 살아 있고(셸의 mounted 래치), 워커를 중간에 끊으면
  // 다음 실행이 폴백 경로로 새기 때문이다.
  $effect(() => {
    jq.install()
  })

  // 비활성으로 바뀌면 떠 있는 것을 전부 닫는다
  $effect(() => {
    if (isActive) return
    closeAllPopups()
    showTransform = false
    showCheatsheet = false
    showSnippets = false
    showHelp = false
    showPalette = false
  })

  // 다시 활성화되면 그리드 치수를 다시 잰다(숨겨진 동안 0으로 잡혔을 수 있다)
  $effect(() => {
    if (!isActive) return
    requestAnimationFrame(() => output?.remeasure())
  })

  // 창 붙여넣기 — 활성 모드이고 편집 요소 밖일 때만 입력으로 받는다
  $effect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      if (!isActive || anyModal) return
      if (inEditable(e.target)) return
      const text = e.clipboardData?.getData('text/plain')
      if (!text) return
      e.preventDefault()
      const table = tableFromPaste(text, e.clipboardData?.getData('text/html') || undefined)
      if (table) {
        jq.setInput(table.text, null)
        if (table.notice) toasts.push(table.notice, 'ok')
        return
      }
      void openText(text, '')
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  $effect(() => {
    shell.jqLabel = jq.inputName ?? ''
  })
</script>

<section class="mode">
  <div class="toolbar" role="menubar" aria-label="jq 메뉴">
    <span class="brand label">jq</span>
    <button class="btn" role="menuitem" onclick={(e) => openMenu(e, fileMenu)}>파일</button>
    <button class="btn" role="menuitem" onclick={(e) => openMenu(e, viewMenu)}>보기</button>
    <button class="btn" role="menuitem" onclick={(e) => openMenu(e, toolsMenu)}>도구</button>
    <button class="btn" role="menuitem" onclick={(e) => openMenu(e, helpMenu)}>도움말</button>
    <span class="divider"></span>
    <span class="engine label">
      {#if jq.engine === 'ready'}엔진 준비됨
      {:else if jq.engine === 'loading'}엔진 로드 중…
      {:else if jq.engine === 'failed'}엔진 실패
      {:else}엔진 대기{/if}
    </span>
    <span class="spacer"></span>
    <button class="btn outline" title="커맨드 팰릿 (Ctrl+K)" onclick={() => (showPalette = true)}>
      명령… <span class="kbd">Ctrl K</span>
    </button>
  </div>

  <div class="main" bind:this={mainCol}>
    <div
      class="top"
      bind:this={topRow}
      style:flex-basis="{jq.maximized ? 0 : jq.splitV}%"
      style:flex-grow="0"
      hidden={jq.maximized}
    >
      <div class="pane" style:flex-basis="{jq.splitH}%">
        <InputPanel
          bind:this={input}
          onOpenTransform={(opts) => void openTransform(opts)}
          onInjectQuery={(q) => query?.setQuery(q)}
        />
      </div>
      <Splitter
        orientation="vertical"
        container={topRow}
        value={jq.splitH}
        onChange={(v) => (jq.splitH = v)}
        onCommit={() => jq.persistSplit()}
      />
      <div class="pane" style:flex-basis="{100 - jq.splitH}%">
        <QueryPanel bind:this={query} />
      </div>
    </div>

    {#if !jq.maximized}
      <Splitter
        orientation="horizontal"
        container={mainCol}
        value={jq.splitV}
        onChange={(v) => (jq.splitV = v)}
        onCommit={() => jq.persistSplit()}
      />
    {/if}

    <div class="bottom">
      <OutputPanel bind:this={output} onExpand={() => void expandOutput()} />
    </div>
  </div>
</section>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = null)} />
{/if}

{#if showTransform}
  <TransformDialog
    bind:this={transform}
    inputText={jq.input}
    onApply={(text) => applyTransform(text)}
    onClose={() => (showTransform = false)}
  />
{/if}

{#if showCheatsheet}
  <CheatsheetDialog
    onPick={(q) => {
      query?.appendQuery(q)
      showCheatsheet = false
    }}
    onClose={() => (showCheatsheet = false)}
  />
{/if}

{#if showSnippets}
  <SnippetsDialog
    onPick={(q) => {
      query?.setQuery(q, true)
      showSnippets = false
    }}
    onClose={() => (showSnippets = false)}
  />
{/if}

{#if showHelp}
  <HelpDialog entries={keymap.entries} onClose={() => (showHelp = false)} />
{/if}

{#if showPalette}
  <CommandPalette
    entries={keymap.entries}
    onQuery={(q) => query?.setQuery(q)}
    onClose={() => (showPalette = false)}
  />
{/if}

<style>
  .mode {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .brand {
    padding: 0 4px 0 2px;
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: 13px;
    text-transform: none;
    letter-spacing: 0;
  }
  .engine {
    white-space: nowrap;
  }
  .spacer {
    flex: 1;
  }

  .main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    padding: 7px;
    gap: 0;
  }

  .top {
    display: flex;
    min-height: 0;
    flex-shrink: 1;
  }
  .pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    flex-grow: 0;
    flex-shrink: 1;
  }
  .pane > :global(.panel) {
    flex: 1;
    min-height: 0;
  }

  .bottom {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .bottom > :global(.panel) {
    flex: 1;
    min-height: 0;
  }
</style>
