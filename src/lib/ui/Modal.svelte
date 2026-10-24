<script lang="ts">
  /**
   * 공용 모달 껍데기 — 스크림 + 패널(.pop) + 헤더(제목, ×) + 본문 + 푸터.
   *
   * 세 모드의 큰 다이얼로그(내보내기·바꾸기·나누기·결합·문서 목록·시트 선택·도움말·jq Transform·
   * 치트시트·스니펫·커맨드 팰릿)가 전부 이것을 쓴다. 껍데기가 맡는 것:
   *  - Escape: `modals` 스택에 등록 → 셸이 맨 위 모달만 닫는다(컴포넌트별 핸들러 불필요)
   *  - 초기 포커스: `initialFocus`("first-input" | "panel" | 요소 반환 함수)를 rAF 한 번 뒤에
   *  - 포커스 트랩: Tab이 패널 밖으로 나가면 되돌린다
   *  - 포커스 복원: 닫힐 때 열기 전 요소로
   *  - 등장 애니메이션(fade + rise), reduced-motion은 전역 규칙이 처리
   *  - role="dialog" aria-modal aria-label
   *
   * 확인·취소 버튼은 푸터 스니펫에 `[취소] … [primary]` 순서로 넣는다. `width`는 패널 폭 상한.
   * 시스템 확인창(alert/confirm/prompt)은 `dialog/DialogHost.svelte`가 따로 그린다 — 그쪽은
   * 모달 위에 다시 뜰 수 있어야 하므로 z-index 대역이 다르다.
   */
  import { untrack, type Snippet } from 'svelte'
  import { modals } from './modals.svelte'

  interface Props {
    /** 접근성 라벨(필수) — 제목이 있으면 같은 값을 쓰면 된다 */
    label: string
    /** 헤더 제목. 없으면 헤더를 생략한다(커맨드 팰릿처럼 입력창이 헤더인 경우) */
    title?: string
    /** 제목 옆 보조 텍스트 (파일명·대상 열 등) */
    subtitle?: string
    /** 패널 폭 상한 (기본 420px). 화면이 좁으면 32px 여백을 남기고 줄어든다 */
    width?: string
    /** 패널 최대 높이 (기본 calc(100vh - 48px)) */
    maxHeight?: string
    /** 헤더의 × 버튼 표시 (기본 true) */
    closeButton?: boolean
    /** 스크림 클릭으로 닫기 (기본 true) */
    closeOnScrim?: boolean
    /** 초기 포커스 대상. 'first-input'=첫 입력 요소, 'panel'=패널 자체, 함수=그 요소 */
    initialFocus?: 'first-input' | 'panel' | (() => HTMLElement | null | undefined)
    /** 본문을 스크롤 컨테이너로 감싸지 않고 그대로 둔다 (본문이 자체 레이아웃을 가질 때) */
    plainBody?: boolean
    /** 패널에 덧붙일 클래스 — 호출자의 scoped 스타일로 패널을 조정할 때 */
    class?: string
    /**
     * 패널 안 키 입력(Escape·Tab 제외). Enter로 확정하는 다이얼로그가 쓴다. 이미
     * stopPropagation된 상태로 넘어오므로 아래 그리드로 새지 않는다.
     */
    onKeydown?: (e: KeyboardEvent) => void
    onClose: () => void
    children: Snippet
    footer?: Snippet
    /** 헤더 오른쪽(× 앞)에 끼울 요소 */
    headerEnd?: Snippet
  }

  let {
    label,
    title,
    subtitle,
    width = '420px',
    maxHeight = 'calc(100vh - 48px)',
    closeButton = true,
    closeOnScrim = true,
    initialFocus = 'first-input',
    plainBody = false,
    class: klass = '',
    onKeydown,
    onClose,
    children,
    footer,
    headerEnd,
  }: Props = $props()

  let panel = $state<HTMLElement | null>(null)

  const FOCUSABLE_PARTS = [
    'input:not([type=hidden]):not([disabled])',
    'textarea:not([disabled])',
    'select:not([disabled])',
    'button:not([disabled])',
    '[href]',
    '[tabindex]:not([tabindex="-1"])',
  ]
  const FOCUSABLE = FOCUSABLE_PARTS.join(', ')
  /** 콤마 목록의 항목마다 접두를 붙인다 — `'.body ' + FOCUSABLE`은 첫 항목에만 붙는다 */
  const BODY_FOCUSABLE = FOCUSABLE_PARTS.map((p) => '.body ' + p).join(', ')

  function firstInput(): HTMLElement | null {
    if (!panel) return null
    // 본문에서 DOM 순서상 첫 컨트롤 — 버튼으로 만든 라디오(.opt)도 포함되도록 종류를 가리지 않는다
    return (
      panel.querySelector<HTMLElement>(BODY_FOCUSABLE) ??
      panel.querySelector<HTMLElement>('footer .btn.primary') ??
      panel
    )
  }

  // 등록·초기 포커스·포커스 복원 — 컴포넌트 수명에 묶는다.
  // `register`는 스택(반응형)을 읽고 쓰므로 untrack — 안 그러면 이 이펙트가 스택 변경에 다시 깨어나
  // 자기 자신을 무한히 재실행한다(effect_update_depth_exceeded).
  $effect(() => {
    const close = onClose
    const before = document.activeElement as HTMLElement | null
    const unregister = untrack(() => modals.register(close))
    const raf = requestAnimationFrame(() => {
      if (!panel) return
      let target: HTMLElement | null | undefined
      if (initialFocus === 'panel') target = panel
      else if (initialFocus === 'first-input') target = firstInput()
      else target = initialFocus()
      ;(target ?? panel).focus()
    })
    return () => {
      cancelAnimationFrame(raf)
      untrack(unregister)
      // 닫힌 뒤 포커스를 열기 전 자리로 — 그 요소가 사라졌으면 그대로 둔다
      if (before && before.isConnected && document.body.contains(before)) before.focus()
    }
  })

  /** 포커스가 패널 밖으로 나가면 되돌린다 (간단한 포커스 트랩) */
  function onFocusOut(e: FocusEvent): void {
    const p = panel
    if (!p) return
    const next = e.relatedTarget as Node | null
    if (next && p.contains(next)) return
    requestAnimationFrame(() => {
      if (p.isConnected && !p.contains(document.activeElement)) firstInput()?.focus()
    })
  }

  function onKeyDown(e: KeyboardEvent): void {
    // 모달 안의 키 입력이 아래 그리드 단축키로 새지 않게 한다. Escape는 셸이 modals 스택으로 처리.
    e.stopPropagation()
    if (e.key === 'Escape') return
    if (e.key !== 'Tab' || !panel) {
      onKeydown?.(e)
      return
    }
    // Tab 순환 — 마지막에서 Tab, 첫 요소에서 Shift+Tab이면 반대편으로
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<div class="scrim" role="presentation" onclick={() => closeOnScrim && onClose()}></div>

<div
  bind:this={panel}
  class="dlg pop {klass}"
  role="dialog"
  aria-modal="true"
  aria-label={label}
  tabindex="-1"
  style:width="min({width}, calc(100vw - 32px))"
  style:max-height={maxHeight}
  onkeydown={onKeyDown}
  onfocusout={onFocusOut}
>
  {#if title !== undefined}
    <header>
      <div class="titles">
        <h2>{title}</h2>
        {#if subtitle}<span class="sub" title={subtitle}>{subtitle}</span>{/if}
      </div>
      {@render headerEnd?.()}
      {#if closeButton}
        <button class="btn icon" onclick={onClose} aria-label="닫기" title="닫기 (Esc)">✕</button>
      {/if}
    </header>
  {/if}

  {#if plainBody}
    {@render children()}
  {:else}
    <div class="body">
      {@render children()}
    </div>
  {/if}

  {#if footer}
    <footer>
      {@render footer()}
    </footer>
  {/if}
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: var(--bg-overlay);
    z-index: var(--z-modal);
    animation: fade 140ms var(--ease);
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  .dlg {
    position: fixed;
    z-index: calc(var(--z-modal) + 1);
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    outline: none;
    animation: rise 180ms var(--ease);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translate(-50%, calc(-50% + 8px));
    }
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    padding: 11px 8px 11px 14px;
    border-bottom: 1px solid var(--border);
  }
  .titles {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  h2 {
    margin: 0;
    font-size: 12.5px;
    font-weight: 600;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
  .sub {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-label);
    color: var(--text-faint);
  }

  .body {
    flex: 1;
    min-height: 0;
    padding: 4px 14px 12px;
    overflow-y: auto;
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    flex: none;
    padding: 10px 14px 12px;
    border-top: 1px solid var(--border);
  }
</style>
