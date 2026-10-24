/**
 * CDN 지연 로더.
 *
 * 무거운 라이브러리(SheetJS, jq-web, highlight.js 등)는 번들에 넣지 않고 처음 필요한 시점에
 * `<script>`/`<link>` 태그를 주입해 받아온다. 같은 URL은 세션 안에서 한 번만 내려받는다.
 *
 * 실패 규약: 네트워크 실패로 reject되면 **캐시를 비운다** — 그 사이 온라인 상태가 되었을 때
 * 다음 호출이 다시 시도할 수 있어야 한다(`parse/xlsx.ts`가 처음부터 지키던 규칙).
 *
 * 콘솔에는 아무것도 쓰지 않는다(`tests/e2e.mjs`가 콘솔 에러 1건에도 실패한다).
 */

const scripts = new Map<string, Promise<void>>()
const styles = new Map<string, Promise<void>>()

/** UMD 스크립트를 주입한다. 전역(`window.XLSX` 등)을 채우는 것은 호출자가 확인한다. */
export function loadScript(url: string): Promise<void> {
  const cached = scripts.get(url)
  if (cached) return cached
  const p = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script')
    el.src = url
    el.async = true
    el.onload = () => resolve()
    el.onerror = () => {
      scripts.delete(url)
      el.remove()
      reject(new Error(`스크립트를 CDN에서 가져오지 못했습니다: ${url}`))
    }
    document.head.appendChild(el)
  })
  scripts.set(url, p)
  return p
}

/** 스타일시트를 주입한다. */
export function loadStyle(url: string): Promise<void> {
  const cached = styles.get(url)
  if (cached) return cached
  const p = new Promise<void>((resolve, reject) => {
    const el = document.createElement('link')
    el.rel = 'stylesheet'
    el.href = url
    el.onload = () => resolve()
    el.onerror = () => {
      styles.delete(url)
      el.remove()
      reject(new Error(`스타일시트를 CDN에서 가져오지 못했습니다: ${url}`))
    }
    document.head.appendChild(el)
  })
  styles.set(url, p)
  return p
}
