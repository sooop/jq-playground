<script lang="ts">
  /**
   * 변환 결과 미리보기.
   *
   * 임계값 두 개가 있다. 200KB 를 넘으면 가상 스크롤로 그리고, 2MB 를 넘으면 앞 50KB 만
   * 보여 준다(복사·적용에는 항상 전체를 쓴다 — 잘린 것은 화면뿐이다).
   */
  import { VirtualScroller } from '../utils/virtual-scroller'

  const PREVIEW_FULL_MAX = 200 * 1024
  const PREVIEW_TRUNCATE_AT = 2 * 1024 * 1024
  const PREVIEW_SHOW_BYTES = 50 * 1024

  interface Props {
    /** 전체 결과(복사·적용에 쓰는 값) */
    text: string
    loading?: boolean
    loadingText?: string
  }
  let { text, loading = false, loadingText = '처리 중…' }: Props = $props()

  let el = $state<HTMLPreElement | null>(null)
  let vs: VirtualScroller | null = null

  const truncated = $derived(text.length > PREVIEW_TRUNCATE_AT)
  const shown = $derived(truncated ? text.slice(0, PREVIEW_SHOW_BYTES) : text)
  const virtual = $derived(shown.length > PREVIEW_FULL_MAX)

  $effect(() => {
    if (!el) return
    vs = new VirtualScroller(el)
    return () => {
      vs?.destroy()
      vs = null
    }
  })

  $effect(() => {
    const s = shown
    const v = virtual
    if (!el) return
    if (v) {
      vs?.setText(s)
    } else {
      vs?.setText('')
      el.textContent = s
    }
  })
</script>

<div class="wrap">
  {#if loading}
    <div class="loading">
      <span class="spinner"></span>
      <span>{loadingText}</span>
    </div>
  {/if}
  <pre bind:this={el} class="preview"></pre>
  {#if truncated}
    <p class="note">
      미리보기는 {Math.round(PREVIEW_SHOW_BYTES / 1024)}KB만 표시합니다. 복사·적용에는 전체
      {Math.round(text.length / 1024)}KB가 쓰입니다.
    </p>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }
  .preview {
    flex: 1;
    min-height: 120px;
    margin: 0;
    padding: 8px 10px;
    overflow: auto;
    background: var(--bg);
    border: 1px solid var(--border-soft);
    border-radius: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    line-height: 18px;
    color: var(--text);
    white-space: pre;
  }
  .preview :global(.vline) {
    white-space: pre;
  }
  .note {
    margin: 4px 0 0;
    font-size: var(--fs-label);
    color: var(--text-faint);
  }
  .loading {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: var(--bg-overlay);
    color: var(--text-dim);
    font-size: var(--fs-label);
  }
  .spinner {
    width: 13px;
    height: 13px;
    border: 2px solid var(--border-strong);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
