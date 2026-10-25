<script lang="ts">
  /**
   * JSON 결과 뷰 — 5000줄을 넘으면 가상 스크롤로 바뀐다.
   *
   * `VirtualScroller` 는 컨테이너의 innerHTML 을 직접 만든다. 그래서 줄·하이라이트 스타일은
   * scoped 로는 닿지 않고 `:global()` 로 써야 한다(그 대신 컴포넌트 밖으로 새지 않도록
   * `.out` 아래로 한정한다).
   */
  import { VirtualScroller } from '../utils/virtual-scroller'

  interface Props {
    text: string
    /** 에러가 나서 이전 결과를 남겨 둔 상태면 흐리게 */
    stale?: boolean
  }
  let { text, stale = false }: Props = $props()

  let el = $state<HTMLDivElement | null>(null)
  let vs: VirtualScroller | null = null

  /** 검색 결과 정보 — 부모(툴바)가 읽는다 */
  export function search(query: string): { total: number } {
    return vs ? vs.search(query) : { total: 0 }
  }
  export function nextMatch(): void {
    vs?.nextMatch()
  }
  export function prevMatch(): void {
    vs?.prevMatch()
  }
  export function matchInfo(): { current: number; total: number } | null {
    return vs ? vs.getMatchInfo() : null
  }
  export function fullText(): string {
    return vs ? vs.getFullText() : text
  }
  export function focusView(): void {
    el?.focus()
  }

  $effect(() => {
    if (!el) return
    vs = new VirtualScroller(el)
    return () => {
      vs?.destroy()
      vs = null
    }
  })

  $effect(() => {
    const t = text
    if (vs) vs.setText(t)
  })
</script>

<div bind:this={el} class="out" class:stale tabindex="0" role="textbox" aria-readonly="true" aria-label="jq 출력"></div>

<style>
  .out {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 8px 10px;
    background: var(--bg-raised);
    font-family: var(--font-mono);
    font-size: var(--fs-cell);
    line-height: 18px;
    color: var(--text);
    white-space: pre;
    outline: none;
  }
  .out.stale {
    opacity: 0.42;
  }

  /* VirtualScroller 가 직접 만드는 노드들 */
  .out :global(.vline) {
    white-space: pre;
  }
  .out :global(.search-highlight) {
    background: var(--find-bg);
    color: var(--find-text);
    border-radius: 2px;
  }
  .out :global(.search-highlight.current) {
    background: var(--find-cur);
    color: var(--find-on-text);
  }
</style>
