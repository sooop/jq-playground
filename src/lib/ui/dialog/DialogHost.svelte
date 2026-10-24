<!--
  공통 다이얼로그 렌더러. 앱 최상단에 한 번만 둔다.
  `dialogs.alert/confirm/prompt`가 만든 요청을 순서대로 그린다.
  이 컴포넌트는 dialog.svelte.ts 외의 의존성이 없다 — 폴더 단위로 복사해 쓸 수 있다.
-->
<script lang="ts">
  import { dialogs } from './dialog.svelte'

  const req = $derived(dialogs.current)

  let inputEl = $state<HTMLInputElement | HTMLTextAreaElement | null>(null)
  let okEl = $state<HTMLButtonElement | null>(null)
  let value = $state('')
  let error = $state<string | null>(null)
  /** 지금 포커스를 채운 요청 id — 요청이 바뀔 때만 초기화하기 위한 표시 */
  let primed = -1

  /** 새 요청이 올라오면 입력값을 채우고 알맞은 곳에 포커스를 준다 */
  $effect(() => {
    const r = req
    if (!r) {
      primed = -1
      return
    }
    if (primed === r.id) return
    primed = r.id
    value = r.kind === 'prompt' ? (r.opts.value ?? '') : ''
    error = null
    // 렌더 직후에 포커스 (요소가 생기기 전에는 잡을 수 없다)
    requestAnimationFrame(() => {
      if (r.kind === 'prompt') {
        inputEl?.focus()
        inputEl?.select()
      } else {
        okEl?.focus()
      }
    })
  })

  const tone = $derived(req?.opts.tone ?? (isDanger(req) ? 'danger' : 'info'))

  function isDanger(r: typeof req): boolean {
    return !!r && r.kind !== 'alert' && 'danger' in r.opts && r.opts.danger === true
  }

  function accept(): void {
    const r = req
    if (!r) return
    if (r.kind === 'prompt') {
      const msg = r.opts.validate?.(value) ?? null
      if (msg !== null) {
        error = msg
        inputEl?.focus()
        return
      }
      dialogs.settle(r.id, value)
      return
    }
    dialogs.settle(r.id, true)
  }

  function cancel(): void {
    const r = req
    if (!r) return
    dialogs.settle(r.id, r.kind === 'confirm' ? false : null)
  }

  function onKeyDown(e: KeyboardEvent): void {
    // 다이얼로그가 떠 있는 동안에는 그리드 등 아래쪽 단축키로 새지 않게 한다
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
      return
    }
    if (e.key === 'Enter' && !e.isComposing) {
      // 여러 줄 입력에서는 Enter가 줄바꿈이어야 하므로 Ctrl+Enter로 확정한다
      const multiline = req?.kind === 'prompt' && req.opts.multiline === true
      if (multiline && !(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      accept()
    }
  }

  /** 포커스가 다이얼로그 밖으로 나가지 않도록 되돌린다 (간단한 포커스 트랩) */
  function onFocusOut(e: FocusEvent): void {
    const panel = e.currentTarget as HTMLElement
    const next = e.relatedTarget as Node | null
    if (next && panel.contains(next)) return
    // 아래 레이어로 포커스가 빠지면 확인 버튼으로 되돌린다
    requestAnimationFrame(() => {
      if (dialogs.current && !panel.contains(document.activeElement)) {
        ;(req?.kind === 'prompt' ? inputEl : okEl)?.focus()
      }
    })
  }
</script>

{#if req}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="dlg-scrim" onclick={req.kind === 'alert' ? accept : cancel}></div>

  <div
    class="dlg-panel tone-{tone}"
    role="alertdialog"
    aria-modal="true"
    aria-label={req.opts.title ?? req.opts.message}
    tabindex="-1"
    onkeydown={onKeyDown}
    onfocusout={onFocusOut}
  >
    {#if req.opts.title}
      <h2>{req.opts.title}</h2>
    {/if}

    <p class="dlg-msg">{req.opts.message}</p>

    {#if req.opts.detail}
      <p class="dlg-detail">{req.opts.detail}</p>
    {/if}

    {#if req.kind === 'prompt'}
      {#if req.opts.multiline}
        <textarea
          bind:this={inputEl}
          bind:value
          placeholder={req.opts.placeholder ?? ''}
          spellcheck="false"
          rows="4"
        ></textarea>
      {:else}
        <input
          bind:this={inputEl}
          bind:value
          placeholder={req.opts.placeholder ?? ''}
          spellcheck="false"
          autocomplete="off"
        />
      {/if}
      {#if error}
        <p class="dlg-error" role="alert">{error}</p>
      {/if}
    {/if}

    <footer>
      {#if req.kind !== 'alert'}
        <button class="dlg-btn" onclick={cancel}>
          {('cancelLabel' in req.opts && req.opts.cancelLabel) || '취소'}
        </button>
      {/if}
      <button class="dlg-btn primary" bind:this={okEl} onclick={accept}>
        {req.opts.okLabel ?? (req.kind === 'alert' ? '확인' : '확인')}
      </button>
    </footer>

    {#if dialogs.pending > 1}
      <span class="dlg-queue">대기 {dialogs.pending - 1}건</span>
    {/if}
  </div>
{/if}

<style>
  /*
   * 색은 앱의 CSS 변수를 쓰되, 변수가 없는 프로젝트에서도 그대로 동작하도록
   * 모든 var()에 기본값을 함께 준다.
   */
  .dlg-scrim {
    position: fixed;
    inset: 0;
    z-index: var(--z-system-dialog, 2000);
    background: var(--bg-overlay, rgba(10, 10, 12, 0.62));
    animation: dlg-fade 130ms ease-out;
  }
  @keyframes dlg-fade {
    from {
      opacity: 0;
    }
  }

  .dlg-panel {
    position: fixed;
    z-index: calc(var(--z-system-dialog, 2000) + 1);
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(400px, calc(100vw - 32px));
    padding: 16px 16px 12px;
    background: var(--bg-raised, #fff);
    color: var(--text, #16181c);
    border: 1px solid var(--border-strong, #c9ccd2);
    border-top: 2px solid var(--dlg-accent);
    border-radius: 8px;
    box-shadow: var(--shadow-pop, 0 12px 40px -8px rgba(0, 0, 0, 0.35));
    font-family: inherit;
    animation: dlg-rise 160ms cubic-bezier(0.32, 0.72, 0, 1);
    outline: none;
  }
  @keyframes dlg-rise {
    from {
      opacity: 0;
      transform: translate(-50%, calc(-50% + 8px));
    }
  }

  /* 톤에 따라 상단 라인과 확인 버튼 색만 바꾼다 — 아이콘 없이 성격을 알린다 */
  .tone-info {
    --dlg-accent: var(--sel, #3b82f6);
  }
  .tone-warn {
    --dlg-accent: var(--accent, #d97706);
  }
  .tone-danger {
    --dlg-accent: var(--danger, #dc2626);
  }

  h2 {
    margin: 0 0 6px;
    font-size: 13px;
    font-weight: 700;
  }
  .dlg-msg {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.6;
    white-space: pre-wrap;
  }
  .dlg-detail {
    margin: 7px 0 0;
    color: var(--text-dim, #6b7280);
    font-size: 11.5px;
    line-height: 1.55;
    white-space: pre-wrap;
  }

  input,
  textarea {
    width: 100%;
    margin-top: 11px;
    padding: 6px 8px;
    background: var(--bg, #fff);
    color: inherit;
    border: 1px solid var(--border, #d4d7dd);
    border-radius: 5px;
    font: inherit;
    font-size: 12.5px;
    outline: none;
    resize: vertical;
  }
  input:focus,
  textarea:focus {
    border-color: var(--dlg-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--dlg-accent) 22%, transparent);
  }

  .dlg-error {
    margin: 6px 0 0;
    color: var(--danger, #dc2626);
    font-size: 11px;
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 15px;
  }

  .dlg-btn {
    height: 28px;
    padding: 0 13px;
    border: 1px solid var(--border, #d4d7dd);
    border-radius: 5px;
    background: transparent;
    color: var(--text-dim, #4b5563);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    transition:
      background 120ms ease,
      color 120ms ease;
  }
  .dlg-btn:hover {
    background: var(--bg-hover, #f1f2f4);
    color: var(--text, #16181c);
  }
  .dlg-btn.primary {
    background: var(--dlg-accent);
    border-color: var(--dlg-accent);
    color: #fff;
    font-weight: 600;
  }
  .dlg-btn.primary:hover {
    filter: brightness(1.08);
  }
  .dlg-btn:focus-visible {
    outline: 2px solid var(--dlg-accent);
    outline-offset: 2px;
  }

  .dlg-queue {
    position: absolute;
    right: 16px;
    bottom: 16px;
    color: var(--text-faint, #9aa0a6);
    font-size: 10px;
  }
</style>
