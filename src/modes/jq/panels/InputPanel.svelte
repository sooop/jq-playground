<script lang="ts">
  /**
   * 입력 패널 — JSON 텍스트, 파일 열기·드롭, 포맷, 히스토리, 찾기.
   *
   * 파일/드롭/붙여넣기의 분기는 전부 `core/input-pipeline.ts` 로 옮겼다. 여기서는 그 결과를
   * 상태에 반영하고 UI 를 켜고 끄는 일만 한다.
   */
  import { dialogs } from '../../../lib/ui/dialog/dialog.svelte'
  import { toasts } from '../../../lib/ui/toasts.svelte'
  import { readFile } from '../core/file-handler'
  import {
    convertCsvToJson,
    fromFileContent,
    fromPaste,
    fromRawText,
    type PipelineResult,
  } from '../core/input-pipeline'
  import { saveInputHistory, updateInputHistoryContent } from '../data/storage'
  import { jq } from '../jqState.svelte'
  import type { TransformOpenOptions } from '../transform/options'
  import type { InputHistoryEntry } from '../types'
  import { handleTabKey } from '../utils/keyboard'
  import { formatJsonInWorker } from '../util/formatWorker'
  import InputFindPanel from './InputFindPanel.svelte'
  import InputHistoryMenu from './InputHistoryMenu.svelte'

  interface Props {
    onOpenTransform: (opts?: TransformOpenOptions) => void
    onInjectQuery: (q: string) => void
  }
  let { onOpenTransform, onInjectQuery }: Props = $props()

  /** 20초 동안 더 고치지 않으면 히스토리에 넣는다 */
  const AUTOSAVE_MS = 20_000

  let ta = $state<HTMLTextAreaElement | null>(null)
  let fileEl = $state<HTMLInputElement | null>(null)
  let historyBtn = $state<HTMLButtonElement | null>(null)
  let findBtn = $state<HTMLButtonElement | null>(null)
  let showParseCsv = $state(false)
  let historyOpen = $state(false)
  let findOpen = $state(false)
  let dragging = $state(false)
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  /** 크기·변환 상태를 알리는 작은 라벨 */
  const sizeLabel = $derived.by(() => {
    if (!jq.autoFormat) return '자동 포맷 꺼짐'
    const n = jq.input.length
    if (n > 2.5 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB · 자동 실행 제한 임박`
    if (n > 500 * 1024) return `${Math.round(n / 1024)}KB`
    return ''
  })
  const sizeWarn = $derived(jq.autoFormat && jq.input.length > 2.5 * 1024 * 1024)

  export function focus(): void {
    ta?.focus()
  }

  export function closePopups(): void {
    historyOpen = false
    findOpen = false
  }

  export function openFind(): void {
    findOpen = true
  }

  /** 열려 있는 팝업이 있으면 하나 닫고 true */
  export function closeTop(): boolean {
    if (findOpen) {
      findOpen = false
      return true
    }
    if (historyOpen) {
      historyOpen = false
      return true
    }
    return false
  }

  function scheduleAutoSave(): void {
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      const content = jq.input.trim()
      if (content) void saveInputHistory(content, jq.inputName)
    }, AUTOSAVE_MS)
  }

  function applyResult(r: PipelineResult): void {
    jq.setInput(r.text, r.fileName)
    showParseCsv = r.showParseCsv
    jq.autoFormat = r.autoFormat
    if (r.notice) toasts.push(r.notice, 'ok')
    if (r.openTransform) onOpenTransform()
  }

  // ── 파일 ───────────────────────────────────────────────────────────────────

  /** 셸이 부르는 진입점이기도 하다(JqMode.openFile 이 그대로 위임) */
  export async function openFile(file: File): Promise<void> {
    try {
      const content = await readFile(file)
      applyResult(await fromFileContent(content, file.name))
      await saveInputHistory(jq.input, jq.inputName)
    } catch (error) {
      await dialogs.alert({
        title: '파일을 열지 못했습니다',
        message: error instanceof Error ? error.message : String(error),
        tone: 'warn',
      })
    }
  }

  async function onFilePicked(e: Event): Promise<void> {
    const el = e.target as HTMLInputElement
    const file = el.files?.[0]
    el.value = ''
    if (file) await openFile(file)
  }

  /**
   * 패널 자체 드롭. `preventDefault` 를 해 두면 셸의 창 전역 드롭 라우팅이 건너뛴다
   * (jq 는 CSV 파일도 입력으로 받으므로 종류 판정에 맡기면 CSV 모드로 새어 나간다).
   */
  async function onDrop(e: DragEvent): Promise<void> {
    e.preventDefault()
    dragging = false
    const file = e.dataTransfer?.files?.[0]
    if (file) await openFile(file)
  }

  // ── 편집 도구 ──────────────────────────────────────────────────────────────

  async function formatJson(): Promise<void> {
    const value = jq.input.trim()
    if (!value) return
    jq.autoFormat = true
    try {
      jq.input = await formatJsonInWorker(value)
      scheduleAutoSave()
    } catch (error) {
      const r = await fromRawText(value, jq.inputName)
      if (r.text !== value) {
        applyResult(r)
      } else {
        await dialogs.alert({
          title: '유효하지 않은 JSON',
          message: error instanceof Error ? error.message : String(error),
          tone: 'warn',
        })
      }
    }
  }

  function parseCsv(): void {
    try {
      jq.setInput(convertCsvToJson(jq.input), null)
      showParseCsv = false
      toasts.push('CSV → JSON 으로 변환했습니다.', 'ok')
    } catch (error) {
      void dialogs.alert({
        title: 'CSV 변환 실패',
        message: error instanceof Error ? error.message : String(error),
        tone: 'warn',
      })
    }
  }

  function clearInput(): void {
    jq.setInput('', null)
    showParseCsv = false
  }

  function undoTransform(): void {
    jq.transformUndo?.()
    jq.transformUndo = null
  }

  async function pickHistory(entry: InputHistoryEntry): Promise<void> {
    // 원본을 먼저 넣어 즉시 반응하고, 포맷은 워커에서 뒤따라 적용한다
    jq.setInput(entry.content, entry.fileName)
    historyOpen = false
    if (!jq.autoFormat) {
      await saveInputHistory(entry.content, entry.fileName)
      return
    }
    try {
      const formatted = await formatJsonInWorker(entry.content)
      if (formatted !== entry.content) {
        jq.input = formatted
        await updateInputHistoryContent(entry.id, formatted)
      } else {
        await saveInputHistory(entry.content, entry.fileName)
      }
    } catch {
      await saveInputHistory(entry.content, entry.fileName)
    }
  }

  // ── 이벤트 ─────────────────────────────────────────────────────────────────

  function onInput(): void {
    showParseCsv = false
    scheduleAutoSave()
  }

  async function onPaste(): Promise<void> {
    jq.autoFormat = false
    // 붙여넣기가 textarea 에 반영된 뒤에 판정해야 한다
    await new Promise((r) => setTimeout(r, 10))
    applyResult(await fromPaste(jq.input, jq.inputName))
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault()
      jq.runNow()
      return
    }
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      findOpen = true
      return
    }
    if (e.ctrlKey && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
      e.preventDefault()
      void formatJson()
      return
    }
    handleTabKey(e)
    if (e.key === 'Tab') {
      // handleTabKey 는 DOM 을 직접 고치므로 상태를 다시 맞춰 준다
      if (ta) jq.input = ta.value
    }
  }
</script>

<section class="panel" aria-label="JSON 입력">
  <header class="panel-head">
    <span class="panel-title">
      Input
      {#if sizeLabel}<span class="size" class:warn={sizeWarn}>{sizeLabel}</span>{/if}
      {#if jq.autoPlay}<span class="chip">자동 실행</span>{/if}
    </span>
    <div class="panel-actions">
      {#if showParseCsv}
        <button class="btn outline" onclick={parseCsv}>CSV로 파싱</button>
      {/if}
      <button class="btn" title="JSON 포맷 (Ctrl+Shift+F)" onclick={() => void formatJson()}>포맷</button>
      <button class="btn" title="JSON Transform (Ctrl+Shift+T)" onclick={() => onOpenTransform()}>
        Transform
      </button>
      {#if jq.transformUndo}
        <button class="btn outline" title="Transform 적용 되돌리기" onclick={undoTransform}>되돌리기</button>
      {/if}
      <button class="btn" onclick={clearInput}>비우기</button>
      <button class="btn" onclick={() => fileEl?.click()}>파일 열기</button>
      <button
        bind:this={findBtn}
        class="btn"
        class:on={findOpen}
        title="JSON 안에서 찾기 (Ctrl+F)"
        onclick={() => (findOpen = !findOpen)}
      >
        찾기
      </button>
      <button bind:this={historyBtn} class="btn" class:on={historyOpen} onclick={() => (historyOpen = !historyOpen)}>
        히스토리
      </button>
      <input
        bind:this={fileEl}
        type="file"
        accept=".json,.jsonl,.ndjson,.txt,.log,.csv,.tsv"
        hidden
        onchange={(e) => void onFilePicked(e)}
      />
    </div>

    {#if historyOpen}
      <InputHistoryMenu
        onPick={(e) => void pickHistory(e)}
        onClose={() => (historyOpen = false)}
        anchor={historyBtn}
      />
    {/if}
    {#if findOpen}
      <InputFindPanel
        textarea={ta}
        text={jq.input}
        onClose={() => (findOpen = false)}
        onInjectQuery={(q) => {
          onInjectQuery(q)
          findOpen = false
        }}
        onUnstringify={(path) => {
          findOpen = false
          onOpenTransform({ source: 'input', extract: false, focusPaths: [path] })
        }}
        anchor={findBtn}
      />
    {/if}
  </header>

  <div
    class="panel-body"
    role="group"
    ondragover={(e) => {
      e.preventDefault()
      dragging = true
    }}
    ondragleave={(e) => {
      if (e.target === e.currentTarget) dragging = false
    }}
    ondrop={(e) => void onDrop(e)}
  >
    <textarea
      bind:this={ta}
      bind:value={jq.input}
      spellcheck="false"
      placeholder="여기에 JSON을 붙여넣거나 파일을 끌어다 놓으세요..."
      oninput={onInput}
      onpaste={() => void onPaste()}
      onkeydown={onKeydown}
    ></textarea>
    {#if dragging}
      <div class="drop-hint">여기에 놓으면 입력으로 엽니다</div>
    {/if}
  </div>
</section>

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
    display: flex;
    align-items: baseline;
    gap: 7px;
    padding-left: 4px;
    font-size: var(--fs-label);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
    white-space: nowrap;
  }
  .size {
    text-transform: none;
    letter-spacing: 0;
    color: var(--text-faint);
  }
  .size.warn {
    color: var(--danger);
  }
  .chip {
    padding: 0 5px;
    border-radius: 3px;
    background: var(--accent-soft);
    color: var(--accent);
    text-transform: none;
    letter-spacing: 0;
    font-size: 10px;
    line-height: 15px;
  }

  .panel-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    overflow-x: auto;
    scrollbar-width: none;
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
