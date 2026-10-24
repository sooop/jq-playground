/**
 * 테마 컨트롤러 — 셸이 소유하고 모든 모드가 읽는 모듈 싱글턴.
 *
 * 저장하는 것은 **선호(system/light/dark)**이고, `data-theme`에는 항상 **해석된 값**을 쓴다.
 * 이렇게 두면 CSS는 명시적인 두 블록(dark 기본 + [data-theme='light'])만 있으면 되고,
 * prefers-color-scheme 미디어쿼리용으로 라이트 토큰을 한 번 더 복제할 필요가 없다.
 *
 * `save('themePref')` 키·값 형태는 `tests/e2e.mjs`가 localStorage를 직접 읽으므로 바꾸지 않는다.
 * `document.documentElement.dataset.theme` 반영과 시스템 설정 감지는 `App.svelte`의 `$effect`가
 * 맡는다(컴포넌트 수명에 묶여야 리스너가 정리된다).
 */
import { load, save } from '../lib/util/storage'

export type ThemePref = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

export const THEME_CYCLE: ThemePref[] = ['system', 'light', 'dark']
export const THEME_LABEL: Record<ThemePref, string> = {
  system: '시스템 설정 따름',
  light: '라이트',
  dark: '다크',
}

class ThemeController {
  pref = $state<ThemePref>(load('themePref', 'system'))
  systemDark = $state(true)

  /** 해석된 테마 — md 모드의 Mermaid 재렌더, hljs 채색 등이 구독한다 */
  readonly theme: Theme = $derived(
    this.pref === 'system' ? (this.systemDark ? 'dark' : 'light') : this.pref,
  )

  cycle(): void {
    this.pref = THEME_CYCLE[(THEME_CYCLE.indexOf(this.pref) + 1) % THEME_CYCLE.length]
  }

  /** 저장은 선호만. 해석된 값은 저장하지 않는다. */
  persist(): void {
    save('themePref', this.pref)
  }
}

export const themeCtl = new ThemeController()
