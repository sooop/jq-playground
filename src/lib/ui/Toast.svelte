<script lang="ts">
  export interface ToastItem {
    id: number
    msg: string
    kind: 'info' | 'ok' | 'warn'
  }

  interface Props {
    items: ToastItem[]
    onDismiss: (id: number) => void
  }
  let { items, onDismiss }: Props = $props()
</script>

<div class="wrap" role="status" aria-live="polite">
  {#each items as t (t.id)}
    <button class="toast {t.kind}" onclick={() => onDismiss(t.id)}>
      <span class="dot"></span>
      {t.msg}
    </button>
  {/each}
</div>

<style>
  .wrap {
    position: fixed;
    left: 50%;
    bottom: calc(var(--status-h) + 14px);
    transform: translateX(-50%);
    z-index: var(--z-toast);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: min(560px, calc(100vw - 32px));
    padding: 7px 12px 7px 10px;
    background: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-radius: 20px;
    box-shadow: var(--shadow-pop);
    color: var(--text);
    font-size: 11.5px;
    text-align: left;
    pointer-events: auto;
    animation: rise 200ms var(--ease);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.97);
    }
  }

  .dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-faint);
  }
  .ok .dot {
    background: var(--ok);
  }
  .warn .dot {
    background: var(--accent);
  }
</style>
