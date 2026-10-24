/**
 * textarea 캐럿의 화면 좌표.
 *
 * 브라우저가 textarea 내부 좌표를 알려 주지 않으므로, 같은 글꼴·패딩·너비를 가진 거울 div 를
 * 같은 자리에 겹쳐 두고 커서까지의 텍스트를 넣은 뒤 끝에 붙인 span 의 위치를 잰다.
 * (원본 `QueryPanel.ts:getCaretCoordinates` 와 같은 방법 — 다른 방법이 없다.)
 */

const COPY_PROPS = [
  'font',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'wordSpacing',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'boxSizing',
] as const

export interface CaretPos {
  x: number
  y: number
  lineHeight: number
}

export function getCaretCoordinates(textarea: HTMLTextAreaElement, pos: number): CaretPos {
  const computed = window.getComputedStyle(textarea)
  const rect = textarea.getBoundingClientRect()

  const div = document.createElement('div')
  div.style.cssText =
    'position:fixed;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;overflow:hidden;'
  div.style.top = rect.top + 'px'
  div.style.left = rect.left + 'px'
  div.style.width = rect.width + 'px'
  div.style.height = rect.height + 'px'

  for (const prop of COPY_PROPS) {
    div.style.setProperty(
      prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()),
      computed.getPropertyValue(prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())),
    )
  }

  div.scrollTop = textarea.scrollTop
  div.scrollLeft = textarea.scrollLeft
  div.textContent = textarea.value.substring(0, pos)

  const span = document.createElement('span')
  span.textContent = '​'
  div.appendChild(span)

  document.body.appendChild(div)
  const spanRect = span.getBoundingClientRect()
  const lineHeight = parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.2
  document.body.removeChild(div)

  return { x: spanRect.left, y: spanRect.top, lineHeight }
}

/**
 * `pos` 가 놓인 줄의 콘텐츠 기준 y(스크롤 0 기준, paddingTop 포함).
 * 줄바꿈(soft wrap)된 줄을 반영하려면 논리 줄 수가 아니라 실제 렌더링 높이를 재야 한다.
 * 거울 폭은 스크롤바를 뺀 `clientWidth` 여야 textarea 와 같은 자리에서 줄이 접힌다.
 */
export function getTextOffsetTop(textarea: HTMLTextAreaElement, pos: number): number {
  const computed = window.getComputedStyle(textarea)
  const div = document.createElement('div')
  div.style.cssText =
    'position:fixed;top:0;left:0;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;' +
    'box-sizing:border-box;border:0;height:auto;'
  div.style.width = textarea.clientWidth + 'px'
  for (const prop of [
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'line-height',
    'letter-spacing',
    'word-spacing',
    'tab-size',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
  ]) {
    div.style.setProperty(prop, computed.getPropertyValue(prop))
  }
  div.textContent = textarea.value.substring(0, pos)

  const span = document.createElement('span')
  span.textContent = '​'
  div.appendChild(span)
  document.body.appendChild(div)
  const top = span.offsetTop
  document.body.removeChild(div)
  return top
}
