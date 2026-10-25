/**
 * 파일 종류 판정 — 뷰어로 열 표인가, jq 입력으로 넘길 JSON/텍스트인가.
 *
 * 확장자가 확실하면 확장자를, 아니면 내용을 본다. 파일 앞 64KB만 읽어 판정하고 본문은 연 쪽이
 * 읽는다(큰 CSV를 두 번 읽지 않기 위해).
 */
import { CsvParser } from '../lib/parse/csv'
import { FILE_ACCEPT, decodeBytes } from '../lib/parse/detect'
import type { Delimiter } from '../lib/data/types'

export type OpenTarget = 'viewer' | 'jq'

const JSON_EXTS = new Set(['.json', '.jsonl', '.ndjson', '.geojson'])
const CSV_EXTS = new Set(['.csv', '.tsv', '.tab', '.psv'])

/** 파일 선택 대화상자의 `accept` — CSV 계열 + JSON + 일반 텍스트 */
export const OPEN_ACCEPT = [FILE_ACCEPT, ...JSON_EXTS, '.log', 'application/json'].join(',')

/** 앞부분만 읽어 판정할 때의 크기 */
export const SNIFF_BYTES = 64 << 10

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i).toLowerCase()
}

export function detectFileKind(name: string, sample: string): OpenTarget {
  const ext = extOf(name)
  if (JSON_EXTS.has(ext)) return 'jq'
  if (CSV_EXTS.has(ext)) return 'viewer'
  return sniffText(sample)
}

/** 확장자로 알 수 없을 때(`.txt`, `.log`, 무확장자) 내용으로 판정한다. */
export function sniffText(sample: string): OpenTarget {
  const t = sample.replace(/^﻿/, '').trimStart()
  if (t === '') return 'jq'
  if (t[0] === '{' || t[0] === '[') return 'jq'
  const lines = t.split(/\r?\n/)
  // 샘플이 줄 중간에서 잘렸을 수 있으니 마지막 줄은 판정에서 뺀다
  const whole = lines.length > 1 ? lines.slice(0, -1) : lines
  const nonEmpty = whole.filter((l) => l.trim() !== '')
  if (nonEmpty.length > 0 && nonEmpty.slice(0, 2).every(isJsonLine)) return 'jq'
  return looksDelimited(whole.join('\n')) ? 'viewer' : 'jq'
}

function isJsonLine(line: string): boolean {
  const s = line.trim()
  if (!(s.startsWith('{') || s.startsWith('['))) return false
  try {
    JSON.parse(s)
    return true
  } catch {
    return false
  }
}

const DELIMS: Delimiter[] = [',', '\t', ';', '|']

/**
 * 구분자 후보 중 하나로 파싱했을 때 **필드 수가 2 이상이고 행마다 일정**하면 표로 본다.
 * `detectDelimiter`는 아무것도 쪼개지지 않아도 `,`를 폴백으로 돌려주므로 여기서 직접 확인한다.
 */
function looksDelimited(text: string): boolean {
  for (const d of DELIMS) {
    const p = new CsvParser(d)
    p.push(text)
    const rows = p.finish().slice(0, 20)
    if (rows.length < 2) continue
    const widths = rows.map((r) => r.length)
    if (widths[0] < 2) continue
    if (widths.every((w) => w === widths[0])) return true
  }
  return false
}

/** 파일 앞부분만 읽어 종류를 판정한다. 본문은 읽지 않는다. */
export async function sniffFile(file: File): Promise<OpenTarget> {
  const ext = extOf(file.name)
  if (JSON_EXTS.has(ext)) return 'jq'
  if (CSV_EXTS.has(ext)) return 'viewer'
  try {
    const buf = await file.slice(0, SNIFF_BYTES).arrayBuffer()
    return sniffText(decodeBytes(buf).text)
  } catch {
    return 'viewer'
  }
}
