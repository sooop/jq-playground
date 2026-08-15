const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => HTML_ESCAPES[c]);
}

/** 필드 하나를 TSV 규칙으로 인용한다 (탭·개행·따옴표가 있을 때만). */
function quoteTsvField(v: string): string {
  if (v === '') return '';
  const needs = v.includes('\t') || v.includes('"') || v.includes('\n') || v.includes('\r');
  return needs ? '"' + v.replace(/"/g, '""') + '"' : v;
}

export function toTsv(matrix: readonly string[][]): string {
  return matrix.map(row => row.map(quoteTsvField).join('\t')).join('\n');
}

/**
 * 클립보드용 HTML 테이블. Excel/Sheets는 `text/html`이 있으면 이걸 우선 사용해
 * 표 구조를 그대로 붙여넣는다.
 */
export function toHtmlTable(matrix: readonly string[][], headerRow: boolean): string {
  const parts: string[] = ['<table>'];
  for (let i = 0; i < matrix.length; i++) {
    const tag = headerRow && i === 0 ? 'th' : 'td';
    parts.push('<tr>');
    for (const cell of matrix[i]) {
      parts.push(`<${tag}>${escapeHtml(cell ?? '')}</${tag}>`);
    }
    parts.push('</tr>');
  }
  parts.push('</table>');
  return parts.join('');
}

/**
 * 클립보드에 표를 쓴다.
 *
 * `text/plain`(TSV)과 `text/html`(`<table>`)을 함께 기록하는 것이 핵심이다. Excel과 Google
 * Sheets는 `text/html`이 있으면 그걸 우선 읽어 셀 경계를 그대로 살려 붙여넣는다.
 *
 * `ClipboardItem`을 지원하지 않는 환경에서는 `writeText`로 폴백한다.
 */
export async function writeTable(
  matrix: readonly string[][],
  opts: { headerRow: boolean } = { headerRow: false }
): Promise<void> {
  const tsv = toTsv(matrix);

  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      const html = toHtmlTable(matrix, opts.headerRow);
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([tsv], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
      return;
    } catch {
      /* 권한 거부 등 → 아래 폴백 */
    }
  }
  await writeText(tsv);
}

/** 순수 텍스트를 클립보드에 쓴다. `navigator.clipboard`가 없으면 임시 textarea로 폴백. */
export async function writeText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* 아래 폴백 */
    }
  }
  // file:// 등 보안 컨텍스트가 아닐 때를 위한 레거시 경로
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-1000px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
}
