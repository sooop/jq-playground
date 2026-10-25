<script lang="ts">
  export interface MenuItem {
    label: string
    /** 오른쪽에 표시할 단축키 (전역 단축키 안내) */
    hint?: string
    /**
     * 메뉴가 열려 있을 **동안에만** 이 한 글자를 누르면 바로 실행된다.
     * (전역 단축키가 아니다 — 메뉴가 닫히면 리스너도 함께 사라진다.)
     * 라벨에 해당 글자가 있으면 밑줄로, 없으면 오른쪽 키 배지로 표시된다.
     * 한 메뉴 안에서 중복되지 않아야 한다 (개발 모드에서 검사한다).
     */
    accel?: string
    disabled?: boolean
    danger?: boolean
    run?: () => void
    /** true면 구분선 */
    sep?: boolean
  }

  interface Props {
    x: number
    y: number
    items: MenuItem[]
    onClose: () => void
  }
  let { x, y, items, onClose }: Props = $props()

  let el = $state<HTMLDivElement | null>(null)
  /** 키보드로 짚고 있는 항목 (구분선·비활성 제외) */
  let cursor = $state(-1)

  /** 실제로 고를 수 있는 항목의 인덱스 목록 */
  const pickable = $derived(
    items.map((it, i) => ({ it, i })).filter(({ it }) => !it.sep && !it.disabled).map(({ i }) => i),
  )

  /** 화면 밖으로 나가지 않도록 보정 */
  const pos = $derived.by(() => {
    const W = 226
    const H = items.length * 25 + 10
    return {
      left: Math.min(x, Math.max(8, window.innerWidth - W - 8)),
      top: Math.min(y, Math.max(8, window.innerHeight - H - 8)),
    }
  })

  function pick(item: MenuItem): void {
    if (item.disabled || item.sep) return
    onClose()
    item.run?.()
  }

  /** cursor를 다음 선택 가능한 항목으로 이동 */
  function move(dir: 1 | -1): void {
    if (pickable.length === 0) return
    const at = pickable.indexOf(cursor)
    const next = at < 0 ? (dir === 1 ? 0 : pickable.length - 1) : (at + dir + pickable.length) % pickable.length
    cursor = pickable[next]
    scrollCursorIntoView()
  }

  function scrollCursorIntoView(): void {
    requestAnimationFrame(() => {
      el?.querySelector('[data-cursor="1"]')?.scrollIntoView({ block: 'nearest' })
    })
  }

  /**
   * 라벨을 accel 글자 기준으로 쪼갠다 (밑줄 표시용).
   * 한국어 라벨에는 accel 글자가 들어 있지 않은 것이 보통이므로,
   * 찾지 못하면 `null`을 돌려주고 대신 오른쪽에 키 배지를 그린다.
   */
  function accelParts(item: MenuItem): { pre: string; key: string; post: string } | null {
    if (!item.accel) return null
    const idx = item.label.toLowerCase().indexOf(item.accel.toLowerCase())
    if (idx < 0) return null
    return {
      pre: item.label.slice(0, idx),
      key: item.label.slice(idx, idx + 1),
      post: item.label.slice(idx + 1),
    }
  }

  /**
   * 눌린 키를 단축 문자 한 글자로 환산한다. 수정키가 걸려 있으면 `null`.
   *
   * `e.key`만 보면 **한글 IME가 켜져 있을 때 단축 문자가 전부 죽는다** — IME가 조합을 가로채
   * `key`가 `'Process'`나 조합 중인 한글이 되기 때문이다. 물리 키를 그대로 알려주는 `e.code`를
   * 폴백으로 두면 입력기 상태와 무관하게 동작한다.
   */
  function accelKeyOf(e: KeyboardEvent): string | null {
    if (e.ctrlKey || e.metaKey || e.altKey) return null
    if (e.key.length === 1) return e.key.toLowerCase()
    const m = /^Key([A-Z])$/.exec(e.code)
    return m ? m[1].toLowerCase() : null
  }

  $effect(() => {
    // 메뉴가 열리면 컨테이너에 포커스를 줘서 키 입력을 받는다
    requestAnimationFrame(() => el?.focus())

    if (import.meta.env.DEV) {
      // 중복된 단축 문자는 앞선 항목만 실행되어 조용히 어긋난다. 개발 중에 잡는다.
      const seen = new Map<string, string>()
      for (const it of items) {
        if (!it.accel) continue
        const k = it.accel.toLowerCase()
        const prev = seen.get(k)
        if (prev) console.warn(`[ContextMenu] 단축 문자 '${k}' 중복: "${prev}" ↔ "${it.label}"`)
        else seen.set(k, it.label)
      }
    }

    const onDown = (e: PointerEvent) => {
      if (el && !el.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      // 메뉴가 열려 있는 동안 키는 전부 여기서 처리하고 아래로 흘리지 않는다
      const stop = () => {
        e.preventDefault()
        e.stopPropagation()
      }
      switch (e.key) {
        case 'Escape':
          stop()
          onClose()
          return
        case 'ArrowDown':
          stop()
          move(1)
          return
        case 'ArrowUp':
          stop()
          move(-1)
          return
        case 'Home':
          stop()
          cursor = pickable[0] ?? -1
          scrollCursorIntoView()
          return
        case 'End':
          stop()
          cursor = pickable[pickable.length - 1] ?? -1
          scrollCursorIntoView()
          return
        case 'Enter':
        case ' ':
          if (cursor >= 0) {
            stop()
            pick(items[cursor])
          }
          return
      }

      // 단축 문자 — 수정키 없이 누른 한 글자
      const k = accelKeyOf(e)
      if (k) {
        const hit = items.findIndex(
          (it) => !it.sep && !it.disabled && it.accel && it.accel.toLowerCase() === k,
        )
        if (hit >= 0) {
          stop()
          pick(items[hit])
        }
      }
    }

    const id = setTimeout(() => window.addEventListener('pointerdown', onDown, true), 0)
    window.addEventListener('keydown', onKey, true)
    return () => {
      clearTimeout(id)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  })
</script>

<div
  class="menu pop"
  bind:this={el}
  style="left:{pos.left}px;top:{pos.top}px"
  role="menu"
  tabindex="-1"
  aria-activedescendant={cursor >= 0 ? `mi-${cursor}` : undefined}
>
  {#each items as item, i (i)}
    {#if item.sep}
      <hr />
    {:else}
      {@const ap = accelParts(item)}
      <button
        id="mi-{i}"
        role="menuitem"
        class:danger={item.danger}
        class:cursor={i === cursor}
        data-cursor={i === cursor ? '1' : '0'}
        disabled={item.disabled}
        onclick={() => pick(item)}
        onpointerenter={() => {
          if (!item.disabled) cursor = i
        }}
      >
        <span class="lbl">
          {#if ap}{ap.pre}<u>{ap.key}</u>{ap.post}{:else}{item.label}{/if}
        </span>
        {#if item.hint}<i>{item.hint}</i>{/if}
        {#if item.accel && !ap}<kbd class="acc">{item.accel.toUpperCase()}</kbd>{/if}
      </button>
    {/if}
  {/each}
</div>

<style>
  .menu {
    position: fixed;
    z-index: var(--z-menu);
    min-width: 216px;
    max-height: min(560px, calc(100vh - 24px));
    overflow-y: auto;
    padding: 4px;
    outline: none;
    animation: in 110ms var(--ease);
  }
  @keyframes in {
    from {
      opacity: 0;
      transform: scale(0.97);
    }
  }

  button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 25px;
    padding: 0 8px;
    border-radius: 4px;
    color: var(--text-dim);
    font-size: 11.5px;
    text-align: left;
    transition:
      background var(--dur) var(--ease),
      color var(--dur) var(--ease);
  }
  .lbl {
    flex: 1;
  }
  /* 단축 문자에 밑줄 — 어떤 키를 누르면 되는지 바로 보인다 */
  .lbl u {
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
    color: var(--accent);
  }
  button i {
    flex: none;
    font-style: normal;
    color: var(--text-faint);
    font-size: 10px;
  }
  /* 라벨에 accel 글자가 없을 때(한국어 라벨) 오른쪽에 키 배지로 알려준다 */
  .acc {
    flex: none;
    min-width: 14px;
    padding: 1px 3px;
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--text-faint);
    font: inherit;
    font-size: 9.5px;
    line-height: 1.3;
    text-align: center;
  }
  button.cursor:not(:disabled) .acc,
  button:hover:not(:disabled) .acc {
    border-color: color-mix(in srgb, var(--accent) 55%, transparent);
    color: var(--accent);
  }
  button:hover:not(:disabled),
  button.cursor:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text);
  }
  button:disabled {
    opacity: 0.34;
    cursor: default;
  }
  button.danger:hover:not(:disabled),
  button.danger.cursor:not(:disabled) {
    background: color-mix(in srgb, var(--danger) 16%, transparent);
    color: var(--danger);
  }

  hr {
    height: 1px;
    margin: 4px 6px;
    border: none;
    background: var(--border);
  }
</style>
