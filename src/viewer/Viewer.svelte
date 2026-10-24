<script lang="ts">
  /**
   * CSV 뷰어 — 표 하나를 전체 화면으로 훑는 읽기 전용 문서 보기.
   *
   * 출처는 세 가지다: 직접 연 파일, jq 출력 표(확대), 텍스트(붙여넣기). 어느 쪽이든 이 컴포넌트가
   * 자기 `Dataset`/`View`/`SelectionStore`/`FindStore`를 만든다 — 정렬·열 순서·숨김은 뷰
   * 상태일 뿐이라 원본(jq 출력 패널, 연 파일)에는 번지지 않는다.
   */
  import { onMount, tick, untrack } from 'svelte'
  import { Dataset } from '../lib/data/dataset.svelte'
  import { FindStore } from '../lib/data/findState.svelte'
  import { SelectionStore } from '../lib/data/selection.svelte'
  import type { ParseResult } from '../lib/data/types'
  import { View } from '../lib/data/view.svelte'
  import { parseChunked } from '../lib/parse/csv'
  import { decodeAs, decodeBytes, detectDelimiter, finalize } from '../lib/parse/detect'
  import GridWorkbench from '../lib/ui/GridWorkbench.svelte'
  import { toasts } from '../lib/ui/toasts.svelte'
  import { num } from '../lib/util/format'
  import { shell, type ViewerSource } from '../shell/shell.svelte'

  interface Props {
    source: ViewerSource
    onClose: () => void
  }
  let { source, onClose }: Props = $props()

  const ds = new Dataset()
  const view = new View(ds)
  const sel = new SelectionStore()
  const find = new FindStore(ds, view, sel, 'viewer.')

  let bench = $state<GridWorkbench | null>(null)
  let progress = $state<number | null>(null)
  let progressLabel = $state('')
  let encoding = $state('utf-8')
  let encodingBanner = $state(false)
  let loaded = $state(false)
  /** 인코딩 폴백을 위해 파일의 원시 바이트를 들고 있는다 */
  let lastBuffer: ArrayBuffer | null = null

  async function loadText(text: string, fileName: string): Promise<void> {
    progress = 0
    progressLabel = '구분자 인식 중…'
    await tick()
    const delim = detectDelimiter(text.slice(0, 64 << 10))
    const raw = await parseChunked(text, delim, (ratio, rows) => {
      progress = ratio * 0.9
      progressLabel = `${num(rows)}행 파싱…`
    })
    progressLabel = '정리 중…'
    progress = 0.95
    await tick()
    apply(finalize(raw, delim, null, encodingBanner), fileName)
  }

  function apply(result: ParseResult, name: string): void {
    untrack(() => {
      ds.loadParsed(result, name)
      view.clearAll()
      sel.clear()
    })
    progress = null
    loaded = true
    shell.viewerLabel = name
    if (result.rows.length === 0) {
      toasts.push('데이터 행이 없습니다', 'warn')
      return
    }
    const bits = [`${num(result.rows.length)}행 × ${result.width}열`]
    if (result.raggedRows > 0) bits.push(`불규칙 행 ${num(result.raggedRows)}개 패딩`)
    if (!result.hasHeader) bits.push('헤더 없음으로 판단')
    toasts.push(bits.join(' · '), 'ok')
    requestAnimationFrame(() => bench?.focusGrid())
  }

  async function load(): Promise<void> {
    const src = source
    try {
      if (src.kind === 'table') {
        // 텍스트로 직렬화하지 않고 바로 넣는다(인용·개행 왕복 손실 방지)
        apply(finalize([src.header, ...src.rows], ',', true, false), src.name)
      } else if (src.kind === 'text') {
        await loadText(src.text, src.name)
      } else {
        progress = 0
        progressLabel = `${src.file.name} 읽는 중…`
        await tick()
        lastBuffer = await src.file.arrayBuffer()
        const dec = decodeBytes(lastBuffer)
        encoding = dec.encoding
        encodingBanner = dec.suspect
        await loadText(dec.text, src.file.name)
      }
    } catch (e) {
      progress = null
      toasts.push(`파일을 읽지 못했습니다: ${e instanceof Error ? e.message : e}`, 'warn')
    }
  }

  /** cp949 폴백 배너에서 다시 읽기 */
  async function reloadAs(enc: string): Promise<void> {
    if (!lastBuffer) return
    encodingBanner = false
    try {
      encoding = enc
      await loadText(decodeAs(lastBuffer, enc), ds.fileName)
    } catch {
      toasts.push(`${enc}로 디코딩할 수 없습니다`, 'warn')
      progress = null
    }
  }

  onMount(() => {
    void load()
  })

  const origin = $derived(
    source.kind === 'table' ? 'jq 결과' : source.kind === 'file' ? '파일' : '붙여넣기',
  )

  export function handleKeydown(e: KeyboardEvent): boolean {
    if (bench?.handleKeydown(e)) return true
    if (e.key === 'Escape') {
      if (bench?.closeTopOverlay()) {
        e.preventDefault()
        return true
      }
      e.preventDefault()
      onClose()
      return true
    }
    return false
  }
</script>

<section class="viewer">
  <header class="bar">
    <button class="btn outline" onclick={onClose} title="닫기 (Esc)">← 돌아가기</button>
    <span class="name" title={ds.fileName}>{ds.fileName || '문서'}</span>
    <span class="origin">{origin}</span>
    <span class="spacer"></span>
    <button class="btn outline" onclick={() => shell.requestOpen()}>파일 열기…</button>
  </header>

  {#if encodingBanner}
    <div class="banner">
      UTF-8이 아닌 인코딩으로 보입니다(현재 {encoding}).
      <button class="btn" onclick={() => void reloadAs('cp949')}>CP949로 다시 읽기</button>
      <button class="btn" onclick={() => (encodingBanner = false)}>무시</button>
    </div>
  {/if}

  {#if progress !== null}
    <div class="loading">
      <div class="prog" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
        <div class="bar-fill" style="width:{progress * 100}%"></div>
      </div>
      <p>{progressLabel}</p>
    </div>
  {:else if loaded}
    <div class="body">
      <GridWorkbench
        bind:this={bench}
        {ds}
        {view}
        {sel}
        {find}
        readonly
        filterStorageKey="viewer.regexMode"
        {encoding}
      />
    </div>
  {/if}
</section>

<style>
  .viewer {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
    height: var(--header-h);
    padding: 0 8px;
    background: var(--bg-header);
    border-bottom: 1px solid var(--border);
  }
  .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .origin {
    font-size: var(--fs-label);
    color: var(--text-dim);
  }
  .spacer {
    flex: 1;
  }
  .banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    font-size: 12px;
    background: var(--accent-soft);
    border-bottom: 1px solid var(--border);
  }
  .body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .loading {
    display: grid;
    place-content: center;
    gap: 8px;
    flex: 1;
    justify-items: center;
    color: var(--text-dim);
  }
  .prog {
    width: 280px;
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
  }
  .bar-fill {
    height: 100%;
    background: var(--accent);
  }
</style>
