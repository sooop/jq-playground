import { serialize } from '../parse/serialize'
import { writeTable, writeText } from './clipboard'
import type { Dataset } from './dataset.svelte'
import { boundingBox } from './selection.svelte'
import type { SelectionStore } from './selection.svelte'
import type { Delimiter, ExportOptions } from './types'
import type { View } from './view.svelte'

/**
 * 내보낼 2차원 배열을 만든다.
 *
 * - `all`: 필터·정렬을 무시한 원본 전체 (칼럼 순서 옵션만 적용)
 * - `view`: 화면에 보이는 대로 (필터 + 정렬 + 칼럼 순서)
 * - `selection`: 선택 영역만. 다중 범위는 합집합의 바운딩 사각형을 쓰고, 선택되지 않은 셀은
 *   빈 값으로 둔다 (Excel은 이 경우 복사를 거부하지만, 붙여넣기 가능한 사각형을 주는 게 낫다)
 */
export function buildMatrix(
  ds: Dataset,
  view: View,
  sel: SelectionStore,
  opts: ExportOptions,
): { matrix: string[][]; headerRow: boolean; truncatedFromMultiRange: boolean } {
  /*
   * 칼럼 목록 결정
   * - `all` 범위 + 칼럼 순서 미적용: 원본 그대로(숨김도 무시) — "전체"의 의미를 지킨다
   * - 그 외: 화면에 보이는 칼럼(숨김 제외, 현재 순서)
   * `selection` 범위는 뷰 좌표를 쓰므로 반드시 화면 칼럼 목록이어야 한다.
   */
  const cols = opts.applyColOrder
    ? view.viewCols
    : opts.scope === 'selection'
      ? view.viewCols
      : ds.header.map((_, i) => i)
  const out: string[][] = []
  let headerRow = false
  let truncated = false

  if (opts.scope === 'selection') {
    const box = boundingBox(sel.ranges)
    if (!box) return { matrix: [], headerRow: false, truncatedFromMultiRange: false }
    truncated = sel.ranges.length > 1

    // 뷰 좌표 → source 좌표
    const viewCols = cols
    const c0 = Math.max(0, box.c0)
    const c1 = Math.min(viewCols.length - 1, box.c1)

    if (opts.includeHeader) {
      const h: string[] = []
      for (let c = c0; c <= c1; c++) h.push(ds.header[viewCols[c]] ?? '')
      out.push(h)
      headerRow = true
    }

    for (let r = box.r0; r <= box.r1; r++) {
      const src = view.viewRows[r]
      if (src === undefined) continue
      const row = ds.rows[src]
      const line: string[] = []
      for (let c = c0; c <= c1; c++) {
        // 다중 범위에서 선택되지 않은 셀은 빈 값
        line.push(isSelected(sel, r, c) ? (row?.[viewCols[c]] ?? '') : '')
      }
      out.push(line)
    }
    return { matrix: out, headerRow, truncatedFromMultiRange: truncated }
  }

  if (opts.includeHeader) {
    out.push(cols.map((c) => ds.header[c] ?? ''))
    headerRow = true
  }

  if (opts.scope === 'all') {
    for (const row of ds.rows) out.push(cols.map((c) => row[c] ?? ''))
  } else {
    const idx = view.viewRows
    for (let i = 0; i < idx.length; i++) {
      const row = ds.rows[idx[i]]
      out.push(cols.map((c) => row?.[c] ?? ''))
    }
  }
  return { matrix: out, headerRow, truncatedFromMultiRange: false }
}

function isSelected(sel: SelectionStore, r: number, c: number): boolean {
  for (const rg of sel.ranges) {
    if (r >= rg.r0 && r <= rg.r1 && c >= rg.c0 && c <= rg.c1) return true
  }
  return false
}

/** 실제 내보내기 실행. @returns 사용자에게 보여줄 결과 메시지 */
export async function runExport(
  ds: Dataset,
  view: View,
  sel: SelectionStore,
  opts: ExportOptions,
): Promise<string> {
  const { matrix, headerRow } = buildMatrix(ds, view, sel, opts)
  if (matrix.length === 0) return '내보낼 데이터가 없습니다'

  const dataRows = headerRow ? matrix.length - 1 : matrix.length
  const label = `${dataRows.toLocaleString('ko-KR')}행 × ${matrix[0].length}열`

  if (opts.target === 'clipboard') {
    if (opts.format === 'tsv') {
      await writeTable(matrix, { headerRow })
    } else {
      await writeText(
        serialize(matrix, { delimiter: ',', quoting: opts.quoting, newline: opts.newline }),
      )
    }
    return `${label} 클립보드에 복사`
  }

  const base = fileBase(ds.fileName, opts.scope)
  const delim: Delimiter = opts.format === 'tsv' ? '\t' : ','
  const text = serialize(matrix, {
    delimiter: delim,
    quoting: opts.quoting,
    newline: opts.newline,
  })
  // BOM(U+FEFF)은 Excel이 UTF-8 CSV의 한글을 제대로 읽게 하는 유일한 신호다
  const parts: BlobPart[] = opts.bom ? ['﻿', text] : [text]
  download(new Blob(parts, { type: 'text/plain;charset=utf-8' }), `${base}.${opts.format}`)
  return `${label} → ${base}.${opts.format}`
}

function fileBase(fileName: string, scope: string): string {
  const dot = fileName.lastIndexOf('.')
  const stem = (dot > 0 ? fileName.slice(0, dot) : fileName) || 'xsv-export'
  const suffix = scope === 'view' ? '-filtered' : scope === 'selection' ? '-selection' : ''
  return stem + suffix
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 다운로드가 시작될 시간을 준 뒤 해제
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
