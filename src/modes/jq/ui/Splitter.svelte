<script lang="ts">
  /**
   * 패널 분할선. 드래그하는 동안 비율(20~80%)을 갱신하고, 놓을 때 저장한다.
   * 포인터 캡처를 쓰므로 커서가 textarea 위로 지나가도 드래그가 끊기지 않는다.
   */
  interface Props {
    orientation: 'vertical' | 'horizontal'
    /** 컨테이너(부모) 요소 — 비율 계산 기준 */
    container: HTMLElement | null
    value: number
    onChange: (v: number) => void
    onCommit: () => void
  }
  let { orientation, container, value, onChange, onCommit }: Props = $props()

  let dragging = $state(false)

  function onPointerDown(e: PointerEvent): void {
    if (!container) return
    dragging = true
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging || !container) return
    const rect = container.getBoundingClientRect()
    const pct =
      orientation === 'vertical'
        ? ((e.clientX - rect.left) / rect.width) * 100
        : ((e.clientY - rect.top) / rect.height) * 100
    if (pct > 20 && pct < 80) onChange(pct)
  }

  function onPointerUp(e: PointerEvent): void {
    if (!dragging) return
    dragging = false
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    onCommit()
  }

  /** 키보드로도 옮길 수 있어야 한다 */
  function onKeydown(e: KeyboardEvent): void {
    const dec = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp'
    const inc = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown'
    if (e.key !== dec && e.key !== inc) return
    e.preventDefault()
    const next = Math.min(80, Math.max(20, value + (e.key === inc ? 2 : -2)))
    onChange(next)
    onCommit()
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="splitter {orientation}"
  class:dragging
  role="separator"
  aria-orientation={orientation}
  aria-valuenow={Math.round(value)}
  tabindex="0"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  onkeydown={onKeydown}
></div>

<style>
  .splitter {
    flex: none;
    background: transparent;
    transition: background var(--dur) var(--ease);
  }
  .splitter:hover,
  .splitter.dragging,
  .splitter:focus-visible {
    background: var(--accent-line);
  }
  .vertical {
    width: 6px;
    cursor: col-resize;
  }
  .horizontal {
    height: 6px;
    cursor: row-resize;
  }
</style>
