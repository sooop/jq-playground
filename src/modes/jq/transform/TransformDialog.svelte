<script lang="ts">
  /**
   * JSON Transform — 로그에서 JSON을 골라내고(Extract), 문자열로 감싸인 값을 풀어(unstringify)
   * 입력에 되돌린다.
   *
   * 3단 연쇄: 소스 → `scan`(후보) → `fields`(문자열 필드 트리) → `render`(미리보기).
   * 각 단계는 `#gen` 카운터로 취소한다 — 소스를 계속 고치는 동안 늦게 온 결과가 화면을
   * 덮으면 안 된다.
   */
  import { dialogs } from '../../../lib/ui/dialog/dialog.svelte'
  import Modal from '../../../lib/ui/Modal.svelte'
  import { toasts } from '../../../lib/ui/toasts.svelte'
  import {
    checkSizeGuard,
    createPreprocessClient,
    needsSizeConfirm,
    needsSizeWarning,
  } from '../utils/json-preprocess-client'
  import type { JsonCandidateMeta } from '../utils/json-preprocessor'
  import { allKeys, withAncestors, type StringifiedNode } from '../utils/stringified-fields'
  import CandidateList from './CandidateList.svelte'
  import FieldTree from './FieldTree.svelte'
  import type { TransformOpenOptions } from './options'
  import TransformPreview from './TransformPreview.svelte'

  interface Props {
    /** 현재 입력 텍스트(Transform 의 기본 소스) */
    inputText: string
    /** 적용 — 새 텍스트와 되돌리기 함수를 준다 */
    onApply: (text: string, undo: () => void) => void
    onClose: () => void
  }
  let { inputText, onApply, onClose }: Props = $props()

  const SCAN_DEBOUNCE = 300
  const PREVIEW_DEBOUNCE = 120
  const LOADING_HINT_MS = 500

  const client = createPreprocessClient()

  let source = $state('')
  let extract = $state(true)
  let preserveFormat = $state(false)
  let spansAvailable = $state(false)

  let candidates = $state.raw<JsonCandidateMeta[]>([])
  let selectedIndex = $state<number | null>(null)
  let nodes = $state.raw<StringifiedNode[]>([])
  let selectedKeys = $state.raw<Set<string>>(new Set())

  let formatted = $state('')
  let loading = $state(false)
  let loadingText = $state('처리 중…')
  let scanWarnings = $state.raw<string[]>([])
  let fieldWarnings = $state.raw<string[]>([])
  let guardMessage = $state('')
  let clipboardNote = $state(false)

  let sourceEl = $state<HTMLTextAreaElement | null>(null)
  let tree = $state<FieldTree | null>(null)

  let gen = 0
  let jobId = 0
  let scanTimer: ReturnType<typeof setTimeout> | null = null
  let previewTimer: ReturnType<typeof setTimeout> | null = null
  let hintTimer: ReturnType<typeof setTimeout> | null = null
  let focusPaths: string[] | null = null

  function setLoading(on: boolean): void {
    loading = on
    if (on) {
      hintTimer = setTimeout(() => (loadingText = '대용량 처리 중…'), LOADING_HINT_MS)
    } else if (hintTimer) {
      clearTimeout(hintTimer)
      hintTimer = null
      loadingText = '처리 중…'
    }
  }

  // ── 열기 ───────────────────────────────────────────────────────────────────

  /** 모달을 연다. 입력이 비어 있으면 클립보드에서 가져온다. */
  export async function open(opts: TransformOpenOptions = {}): Promise<boolean> {
    let text = opts.initialText ?? (opts.source !== 'empty' ? inputText : '')
    clipboardNote = false

    if (!text.trim() && opts.source !== 'empty') {
      try {
        const clip = await navigator.clipboard.readText()
        if (clip.trim()) {
          text = clip
          clipboardNote = true
        }
      } catch {
        /* 클립보드 접근 불가 — 빈 채로 연다 */
      }
    }

    if (needsSizeConfirm(text)) {
      const ok = await dialogs.confirm({
        title: '대용량 입력',
        message: '입력이 10MB를 넘습니다. 처리에 시간이 걸릴 수 있습니다. 계속할까요?',
        okLabel: '계속',
      })
      if (!ok) return false
    }

    const guard = checkSizeGuard(text)
    if (!guard.ok) {
      await dialogs.alert({ title: '처리할 수 없습니다', message: guard.reason ?? '', tone: 'warn' })
      return false
    }

    source = text
    extract = opts.extract ?? true
    preserveFormat = opts.preserveFormat ?? false
    focusPaths = opts.focusPaths ?? null

    candidates = []
    selectedIndex = null
    nodes = []
    selectedKeys = new Set()
    spansAvailable = false
    scanWarnings = []
    fieldWarnings = []
    guardMessage = ''
    formatted = ''

    scheduleScan()
    return true
  }

  export function close(): void {
    gen++
    if (scanTimer) clearTimeout(scanTimer)
    if (previewTimer) clearTimeout(previewTimer)
    client.cancel()
    onClose()
  }

  // ── 스캔 → 필드 → 미리보기 ────────────────────────────────────────────────

  function scheduleScan(): void {
    if (scanTimer) clearTimeout(scanTimer)
    scanTimer = setTimeout(() => void runScan(), SCAN_DEBOUNCE)
  }

  function schedulePreview(): void {
    if (previewTimer) clearTimeout(previewTimer)
    previewTimer = setTimeout(() => void loadPreview(), PREVIEW_DEBOUNCE)
  }

  async function runScan(): Promise<void> {
    const text = source
    // Extract 를 끄면 후보 목록이 필요 없다 — 문서 전체를 대상으로 필드 스캔만 한다
    const options = { extract, unstringify: extract }

    const guard = checkSizeGuard(text)
    if (!guard.ok) {
      guardMessage = guard.reason ?? ''
      candidates = []
      nodes = []
      formatted = ''
      return
    }
    guardMessage = ''

    const my = ++gen
    setLoading(true)
    formatted = ''

    try {
      const result = await client.scan(text, options)
      if (my !== gen) return

      jobId = result.jobId
      candidates = result.candidates
      scanWarnings = options.extract ? result.warnings : []
      selectedIndex = candidates.length > 0 ? candidates[0]!.index : null

      await loadFields(my)
    } catch (err) {
      if (my !== gen) return
      if ((err as Error).message === 'Cancelled') return
      guardMessage = (err as Error).message
    } finally {
      if (my === gen) setLoading(false)
    }
  }

  async function loadFields(my = gen): Promise<void> {
    const candidateIndex = extract ? selectedIndex : null

    if (extract && candidateIndex === null) {
      nodes = []
      selectedKeys = new Set()
      spansAvailable = false
      fieldWarnings = []
      formatted = ''
      return
    }

    setLoading(true)
    try {
      const result = await client.fields(jobId, candidateIndex)
      if (my !== gen) return

      nodes = result.nodes
      spansAvailable = result.spansAvailable
      fieldWarnings = result.warnings
      selectedKeys = defaultSelection(result.nodes)
      if (!spansAvailable) preserveFormat = false

      await loadPreview(my)
    } catch (err) {
      if (my !== gen) return
      nodes = []
      selectedKeys = new Set()
      fieldWarnings = [(err as Error).message]
      formatted = ''
    } finally {
      if (my === gen) setLoading(false)
    }
  }

  /** Find 의 ↧ 로 들어왔으면 그 경로만, 아니면 전부 켠다 */
  function defaultSelection(list: StringifiedNode[]): Set<string> {
    if (focusPaths && focusPaths.length > 0) {
      const wanted = new Set(focusPaths)
      const picked = new Set(list.filter((n) => wanted.has(n.path)).map((n) => n.key))
      focusPaths = null
      if (picked.size > 0) return withAncestors(list, picked)
    }
    focusPaths = null
    return allKeys(list)
  }

  async function loadPreview(my = gen): Promise<void> {
    setLoading(true)
    try {
      const text = await client.render(jobId, [...selectedKeys], preserveFormat && spansAvailable)
      if (my !== gen) return
      formatted = text
    } catch (err) {
      if (my !== gen) return
      formatted = ''
      fieldWarnings = [(err as Error).message]
    } finally {
      if (my === gen) setLoading(false)
    }
  }

  // ── 조작 ───────────────────────────────────────────────────────────────────

  function onSourceInput(): void {
    focusPaths = null
    scheduleScan()
  }

  function onSelectCandidate(index: number): void {
    selectedIndex = index
    void loadFields()
  }

  function onSelectionChange(next: Set<string>): void {
    selectedKeys = next
    schedulePreview()
  }

  async function copyOut(): Promise<void> {
    if (!formatted) return
    try {
      await navigator.clipboard.writeText(formatted)
      toasts.push('변환 결과를 복사했습니다.', 'ok')
    } catch {
      toasts.push('클립보드 복사에 실패했습니다.', 'warn')
    }
  }

  function apply(): void {
    if (!formatted) return
    onApply(formatted, () => {})
    close()
  }

  const warnings = $derived([
    ...(needsSizeWarning(source) ? ['5MB 이상 — 미리보기가 제한됩니다.'] : []),
    ...(!spansAvailable && nodes.length > 0
      ? ['이 문서는 원본 포맷 유지를 쓸 수 없어 전체를 다시 직렬화합니다.']
      : []),
    ...scanWarnings,
    ...fieldWarnings,
  ])
</script>

<Modal
  label="JSON Transform"
  title="JSON Transform"
  width="880px"
  maxHeight="92vh"
  initialFocus={() => sourceEl}
  onClose={close}
>
  <div class="fields">
    <label class="label" for="jq-transform-source">Source</label>
    <textarea
      id="jq-transform-source"
      bind:this={sourceEl}
      class="source"
      spellcheck="false"
      placeholder="텍스트를 붙여넣거나 Input에서 불러옵니다..."
      bind:value={source}
      oninput={onSourceInput}
    ></textarea>

    <div class="toggles">
      <label class="chk">
        <input type="checkbox" bind:checked={extract} onchange={scheduleScan} /> JSON 추출
      </label>
      <label class="chk" class:disabled={!spansAvailable} title="선택한 구간만 교체하고 나머지 공백·줄바꿈은 그대로 둡니다">
        <input
          type="checkbox"
          bind:checked={preserveFormat}
          disabled={!spansAvailable}
          onchange={schedulePreview}
        /> 원본 포맷 유지
      </label>
    </div>

    {#if guardMessage}
      <p class="warn">{guardMessage}</p>
    {/if}
    {#if clipboardNote}
      <p class="info">Input이 비어 있어 클립보드 내용을 불러왔습니다.</p>
    {/if}
    {#each warnings as w}
      <p class="info">{w}</p>
    {/each}

    {#if extract}
      <div class="section-label">후보 {candidates.length ? `(${candidates.length})` : ''}</div>
      <CandidateList {candidates} selected={selectedIndex} onSelect={onSelectCandidate} />
    {/if}

    <div class="section-label">
      문자열로 감싸인 값 {nodes.length ? `(${selectedKeys.size}/${nodes.length})` : ''}
      <span class="sec-actions">
        <button class="btn outline" disabled={nodes.length === 0} onclick={() => tree?.selectAll()}>
          전체 선택
        </button>
        <button class="btn outline" disabled={nodes.length === 0} onclick={() => tree?.clearAll()}>
          전체 해제
        </button>
      </span>
    </div>
    <FieldTree bind:this={tree} {nodes} selected={selectedKeys} onChange={onSelectionChange} />

    <div class="section-label">미리보기</div>
    <TransformPreview text={formatted} {loading} {loadingText} />
  </div>

  {#snippet footer()}
    <button class="btn outline" onclick={close}>취소</button>
    <button class="btn outline" disabled={!formatted} onclick={() => void copyOut()}>복사</button>
    <button class="btn primary" disabled={!formatted} onclick={apply}>Input에 적용</button>
  {/snippet}
</Modal>

<style>
  .fields {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .source {
    height: 110px;
    padding: 7px 9px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    resize: vertical;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text);
  }
  .source:focus {
    outline: none;
    border-color: var(--accent-line);
  }
  .toggles {
    display: flex;
    gap: 14px;
    padding: 2px 0;
  }
  .chk {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--fs-ui);
    color: var(--text-dim);
  }
  .chk.disabled {
    opacity: 0.45;
  }
  .section-label {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
    font-size: var(--fs-label);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .sec-actions {
    margin-left: auto;
    display: flex;
    gap: 4px;
  }
  .sec-actions :global(.btn) {
    height: 20px;
    padding: 0 6px;
    font-size: 10px;
  }
  .warn,
  .info {
    margin: 0;
    font-size: var(--fs-label);
    line-height: 1.5;
  }
  .warn {
    color: var(--danger);
  }
  .info {
    color: var(--text-dim);
  }
</style>
