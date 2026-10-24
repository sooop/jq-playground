<script lang="ts">
  import DialogHost from './lib/ui/dialog/DialogHost.svelte'
  import { dialogs } from './lib/ui/dialog/dialog.svelte'
  import { modals } from './lib/ui/modals.svelte'
  import Toast from './lib/ui/Toast.svelte'
  import { toasts } from './lib/ui/toasts.svelte'
  import JqMode from './modes/jq/JqMode.svelte'
  import { OPEN_ACCEPT } from './shell/fileKind'
  import { shell } from './shell/shell.svelte'
  import { themeCtl } from './shell/theme.svelte'
  import Viewer from './viewer/Viewer.svelte'

  // --- 테마 --- (상태는 shell/theme.svelte.ts, DOM 반영과 시스템 감지는 여기)
  $effect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    themeCtl.systemDark = mq.matches
    const onChange = (e: MediaQueryListEvent) => (themeCtl.systemDark = e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  })

  $effect(() => {
    document.documentElement.dataset.theme = themeCtl.theme
    themeCtl.persist()
  })

  let jq = $state<JqMode | null>(null)
  let viewer = $state<Viewer | null>(null)
  $effect(() => {
    shell.jq = jq ?? undefined
  })

  let fileInput = $state<HTMLInputElement | null>(null)
  $effect(() => {
    shell.fileInput = fileInput
  })

  /**
   * 창 전체에 파일을 떨어뜨려도 열리게 한다. 입력 패널이 자기 영역의 드롭을 먼저 처리하고
   * `preventDefault`를 하므로, 여기서는 `defaultPrevented`인 이벤트를 건너뛴다 — 그렇지
   * 않으면 같은 파일이 두 번 열린다.
   */
  let dragDepth = $state(0)
  function onWindowDragOver(e: DragEvent): void {
    if (e.defaultPrevented) {
      dragDepth = 0
      return
    }
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault()
      dragDepth = 1
    }
  }
  function onWindowDrop(e: DragEvent): void {
    dragDepth = 0
    if (e.defaultPrevented) return
    const files = e.dataTransfer?.files
    if (files?.length) {
      e.preventDefault()
      void shell.openFiles(files)
    }
  }

  // --- 전역 단축키 ---
  function onGlobalKeyDown(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey
    if (dialogs.pending > 0) return
    // 공용 모달이 떠 있으면 Escape는 맨 위 모달을 닫는 것으로 끝난다
    if (e.key === 'Escape' && modals.closeTop()) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (mod && !e.shiftKey && !e.altKey && (e.key === 'o' || e.key === 'O')) {
      e.preventDefault()
      e.stopPropagation()
      shell.requestOpen()
      return
    }
    if (shell.viewer) viewer?.handleKeydown(e)
    else jq?.handleKeydown(e)
  }

  $effect(() => {
    window.addEventListener('keydown', onGlobalKeyDown, true)
    return () => window.removeEventListener('keydown', onGlobalKeyDown, true)
  })
</script>

<svelte:head>
  <title>{shell.docTitle}</title>
</svelte:head>

<svelte:window
  ondragover={onWindowDragOver}
  ondragleave={() => (dragDepth = 0)}
  ondrop={onWindowDrop}
/>

<div class="app">
  <!-- jq 페인은 뷰어 밑에서도 살아 있다(입력·쿼리 상태 유지). display:none은 overflow:auto
       요소의 scrollTop을 0으로 되돌리므로 visibility로만 숨기고, inert로 포커스를 막는다. -->
  <div class="pane" class:inactive={!!shell.viewer} inert={!!shell.viewer}>
    <JqMode bind:this={jq} isActive={!shell.viewer} />
  </div>
  {#if shell.viewer}
    <div class="pane">
      {#key shell.viewer}
        <Viewer bind:this={viewer} source={shell.viewer} onClose={() => shell.closeViewer()} />
      {/key}
    </div>
  {/if}
  {#if dragDepth > 0}
    <div class="drop-hint">놓으면 파일을 엽니다</div>
  {/if}
</div>

<input
  bind:this={fileInput}
  id="shell-file-input"
  type="file"
  accept={OPEN_ACCEPT}
  hidden
  onchange={(e) => {
    const f = e.currentTarget.files
    if (f?.length) void shell.openFiles(f)
    e.currentTarget.value = ''
  }}
/>

<Toast items={toasts.items} onDismiss={(id) => toasts.dismiss(id)} />

<!-- 공통 다이얼로그 렌더러 — alert/confirm/prompt가 여기서 그려진다 -->
<DialogHost />

<style>
  .app {
    position: relative;
    height: 100%;
    min-height: 0;
  }

  .pane {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bg);
  }
  .pane.inactive {
    visibility: hidden;
    pointer-events: none;
  }
</style>
