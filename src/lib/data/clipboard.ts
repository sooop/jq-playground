import { CsvParser } from '../parse/csv'
import { detectDelimiter } from '../parse/detect'
import { toHtmlTable, toTsv } from '../parse/serialize'

/**
 * 클립보드에 표를 쓴다.
 *
 * `text/plain`(TSV)과 `text/html`(`<table>`)을 함께 기록하는 것이 핵심이다. Excel과 Google
 * Sheets는 `text/html`이 있으면 그걸 우선 읽어 셀 경계를 그대로 살려 붙여넣는다. TSV만 주면
 * 값에 탭·개행이 있을 때 표가 어긋난다.
 *
 * `ClipboardItem`을 지원하지 않는 환경에서는 `writeText`로 폴백한다.
 */
export async function writeTable(
  matrix: readonly string[][],
  opts: { headerRow: boolean } = { headerRow: false },
): Promise<void> {
  const tsv = toTsv(matrix)

  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      const html = toHtmlTable(matrix, opts.headerRow)
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([tsv], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ])
      return
    } catch {
      /* 권한 거부 등 → 아래 폴백 */
    }
  }
  await writeText(tsv)
}

/** 순수 텍스트를 클립보드에 쓴다. `navigator.clipboard`가 없으면 임시 textarea로 폴백. */
export async function writeText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      /* 아래 폴백 */
    }
  }
  // file:// 등 보안 컨텍스트가 아닐 때를 위한 레거시 경로
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '-1000px'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
  } finally {
    document.body.removeChild(ta)
  }
}

/**
 * 붙여넣기 텍스트를 표로 해석한다.
 *
 * 구분자는 자동 인식한다. 다만 클립보드에서 오는 표는 거의 항상 TSV이므로 탭이 하나라도 있으면
 * 탭을 우선한다 — 값 안에 콤마가 많은 데이터에서 오판을 막는다.
 */
export function parseClipboardTable(text: string): string[][] {
  const sample = text.slice(0, 64 << 10)
  const delim = sample.includes('\t') ? '\t' : detectDelimiter(sample)
  const p = new CsvParser(delim)
  p.push(text)
  const rows = p.finish()
  if (rows.length === 0) return []
  // 붙여넣기 블록은 사각형이어야 하므로 최대 폭으로 패딩한다
  let width = 0
  for (const r of rows) if (r.length > width) width = r.length
  for (const r of rows) while (r.length < width) r.push('')
  return rows
}

/**
 * 클립보드에서 텍스트를 읽는다.
 *
 * `navigator.clipboard.readText()`는 권한 프롬프트가 뜨거나 `file://`에서 막히는 일이 잦다.
 * 그래서 실제 붙여넣기 경로는 `paste` 이벤트의 `clipboardData`를 쓰고(항상 동작),
 * 이 함수는 버튼으로 붙여넣기를 호출하는 보조 경로에만 쓴다.
 */
export async function readText(): Promise<string | null> {
  if (!navigator.clipboard?.readText) return null
  try {
    return await navigator.clipboard.readText()
  } catch {
    return null
  }
}
