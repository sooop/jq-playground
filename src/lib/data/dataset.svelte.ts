import { columnLabel, detectColType, normalizeHeader } from '../parse/detect'
import { searchKeyFor } from './filter'
import type { ColType, Delimiter, Op, ParseResult } from './types'

/** 칼럼 폭 추정 시 상한/하한 (px) */
const MIN_W = 56
const MAX_W = 420
/** 셀 좌우 패딩 */
const CELL_PAD = 16
/** 헤더의 타입 글리프 + 정렬 버튼 + 필터 버튼 + 간격 + 패딩이 차지하는 고정 폭 */
const HEAD_CHROME = 68

/** 폰트 지정 문자열 (canvas 측정용). 실제 적용된 폰트 스택을 그대로 쓴다. */
const CELL_FONT = 12.5
const HEAD_FONT = 11

/**
 * 텍스트 실제 픽셀 폭 측정.
 *
 * 문자 수 × 상수로 어림하면 한글·전각·폰트 폴백 때문에 반드시 어긋나고, 그 결과가 곧
 * "헤더가 잘려 보인다"로 나타난다. 브라우저에서는 canvas로 **실측**하고, DOM이 없는
 * 환경(단위 테스트)에서는 표시 폭 기반 근사로 떨어진다.
 */
let measureCtx: CanvasRenderingContext2D | null | undefined
let fontStack = ''

function textPx(s: string, sizePx: number, letterSpacing = 0): number {
  if (measureCtx === undefined) {
    try {
      measureCtx = document.createElement('canvas').getContext('2d')
      fontStack = getComputedStyle(document.body).fontFamily || 'monospace'
    } catch {
      measureCtx = null
    }
  }
  if (measureCtx) {
    measureCtx.font = `${sizePx}px ${fontStack}`
    return measureCtx.measureText(s).width + letterSpacing * sizePx * s.length
  }
  // 폴백: 반각 1칸 ≈ 0.56em
  return displayWidth(s) * sizePx * 0.56
}

/**
 * 모노스페이스에서 문자열이 차지하는 **칸 수**.
 *
 * 한글·CJK·전각·이모지는 반각 문자의 두 배 폭을 차지한다. `String.length`로 세면 한글 표에서
 * 칼럼이 절반 폭으로 잡혀 내용이 잘린다.
 */
export function displayWidth(s: string): number {
  let w = 0
  for (const ch of s) {
    w += isWide(ch.codePointAt(0) ?? 0) ? 2 : 1
  }
  return w
}

function isWide(c: number): boolean {
  return (
    (c >= 0x1100 && c <= 0x115f) || // 한글 자모
    (c >= 0x2e80 && c <= 0x303e) || // CJK 부호·기호
    (c >= 0x3041 && c <= 0x33ff) || // 가나, 한글 호환 자모, CJK 기호
    (c >= 0x3400 && c <= 0x4dbf) || // CJK 확장 A
    (c >= 0x4e00 && c <= 0x9fff) || // CJK 통합 한자
    (c >= 0xa000 && c <= 0xa4cf) || // 이족 음절
    (c >= 0xac00 && c <= 0xd7a3) || // 한글 음절
    (c >= 0xf900 && c <= 0xfaff) || // CJK 호환 한자
    (c >= 0xfe30 && c <= 0xfe6f) || // CJK 호환 형식
    (c >= 0xff00 && c <= 0xff60) || // 전각
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x1f300 && c <= 0x1f9ff) || // 이모지
    (c >= 0x20000 && c <= 0x3fffd) // CJK 확장 B 이상
  )
}

/**
 * 데이터셋 스토어.
 *
 * ## 성능상의 핵심 결정
 * `rows`는 `$state.raw`다. 10만 × 25 = 250만 개의 문자열을 Svelte의 deep proxy로 감싸면
 * 접근마다 프록시 트랩을 타서 스크롤이 불가능해진다. 대신 변경 시 {@link version}을 올려
 * 명시적으로 무효화를 알린다. `$derived`는 `version`을 읽어 재계산된다.
 *
 * 따라서 **`rows`를 직접 변형한 뒤에는 반드시 `bump()`를 불러야 한다.** 이 클래스 밖에서
 * `rows`를 변형하지 않는 것이 규칙이고, 모든 변경은 {@link apply}를 통과한다.
 */
export class Dataset {
  /** 헤더를 제외한 데이터 행. 프록시 없는 원시 배열. */
  rows = $state.raw<string[][]>([])
  /** 칼럼명 */
  header = $state.raw<string[]>([])
  /** 변경 카운터 — 파생 계산의 무효화 신호 */
  version = $state(0)

  /** 뷰 칼럼 인덱스 → source 칼럼 인덱스. 열 순서 변경은 이것만 치환한다. */
  colOrder = $state.raw<number[]>([])
  /** source 칼럼 인덱스별 폭(px) */
  colWidths = $state.raw<number[]>([])
  /** source 칼럼 인덱스별 추론 타입 */
  colTypes = $state.raw<ColType[]>([])

  /** 감지된 구분자 — 상태바 표시 및 내보내기 기본값 */
  delimiter = $state<Delimiter>(',')
  /** 원본 1행 — 헤더 토글 시 재파싱 없이 앞뒤로 옮기기 위해 보관 */
  hasHeader = $state(true)
  /** 로드된 파일명 (내보내기 기본 파일명에 쓴다) */
  fileName = $state('')

  /**
   * 대소문자 무시 검색용 인덱스. 행마다 모든 셀을 `\t`로 합쳐 소문자화한 문자열.
   * 매 키 입력마다 250만 셀을 훑는 대신 10만 번의 `indexOf`로 끝내는 것이 목적.
   */
  searchIndex: string[] = []

  get rowCount(): number {
    return this.rows.length
  }
  get colCount(): number {
    return this.header.length
  }

  /** 파생 계산에 무효화를 알린다. `rows`/`header`를 변형한 뒤 반드시 호출. */
  bump(): void {
    this.version++
  }

  /**
   * 셀 값 읽기 — **템플릿에서 셀을 읽을 때는 반드시 이 함수를 쓴다.**
   *
   * `rows`는 `$state.raw`이고 셀 편집은 `rows[r][c]`를 제자리에서 바꾼다. 즉 배열 참조가
   * 그대로여서, 템플릿이 `ds.rows[r][c]`를 직접 읽으면 편집 후에도 다시 읽히지 않는다
   * (행 인덱스도 그대로이므로 파생값 비교에서도 변화가 감지되지 않는다).
   * 여기서 `version`을 함께 읽어 제자리 편집이 반응성에 확실히 걸리게 한다.
   *
   * 반응성이 필요 없는 경로(내보내기, 클립보드 등)는 `rows`를 직접 읽어도 된다.
   */
  cell(row: number, col: number): string {
    void this.version
    return this.rows[row]?.[col] ?? ''
  }

  /**
   * 원본 1행. 헤더 추론이 틀렸을 때 재파싱 없이 앞뒤로 옮기기 위해 보관한다.
   * 정규화(중복 이름 접미사)를 거치지 않은 값이라 왕복이 손실 없다.
   */
  #firstRow: string[] | null = null

  /** 원본 1행 읽기 — 문서 저장 스냅샷이 헤더 토글 왕복을 보존하기 위해 필요하다. */
  get firstRow(): readonly string[] | null {
    return this.#firstRow
  }

  /** 파싱 결과로 데이터셋을 교체한다. */
  loadParsed(r: ParseResult, fileName = ''): void {
    this.rows = r.rows
    this.header = r.header
    this.delimiter = r.delimiter
    this.hasHeader = r.hasHeader
    this.fileName = fileName
    this.#firstRow = r.firstRow
    this.colOrder = r.header.map((_, i) => i)
    this.colTypes = r.header.map((_, i) => detectColType(r.rows, i))
    this.colWidths = estimateWidths(r.rows, r.header)
    this.rebuildSearchIndex()
    this.bump()
  }

  /**
   * "첫 행을 헤더로" 토글. 재파싱 없이 헤더와 데이터 사이에서 1행을 옮긴다.
   *
   * 행 인덱스가 1씩 밀리므로 기존 Undo 기록과 어긋난다 — 호출부가 히스토리를 비워야 한다.
   * 입력의 재해석에 해당하는 조작이라 편집 연산(Op)으로 다루지 않는다.
   */
  toggleHeader(): void {
    const width = this.colCount
    if (width === 0) return

    if (this.hasHeader) {
      // 헤더를 데이터 첫 행으로 되돌리고 칼럼명은 A, B, C…
      const asRow = (this.#firstRow ?? this.header).slice(0, width)
      while (asRow.length < width) asRow.push('')
      this.rows = [asRow, ...this.rows]
      this.header = generatedHeader(width)
      this.hasHeader = false
    } else {
      if (this.rows.length === 0) return
      const first = this.rows[0]
      this.#firstRow = first.slice()
      this.header = normalizeHeader(first, width)
      this.rows = this.rows.slice(1)
      this.hasHeader = true
    }
    // 칼럼 순서/폭은 칼럼 수가 그대로이므로 유지한다
    this.retype()
    this.rebuildSearchIndex()
    this.bump()
  }

  rebuildSearchIndex(): void {
    const rows = this.rows
    const out: string[] = new Array(rows.length)
    for (let i = 0; i < rows.length; i++) out[i] = rows[i].join('\t').toLowerCase()
    this.searchIndex = out
  }

  /** 칼럼 타입을 다시 추론한다 (구조 변경 후). */
  retype(): void {
    this.colTypes = this.header.map((_, i) => detectColType(this.rows, i))
  }

  /**
   * 모든 행에서 값이 비어 있는 칼럼의 source 인덱스 목록.
   *
   * 필터 결과가 아니라 **전체 행**을 기준으로 판정한다 — 필터를 바꿀 때마다 "빈 열"의 정의가
   * 흔들리면 일괄 숨기기/삭제의 결과를 예측할 수 없다.
   * 칼럼별로 값이 하나라도 나오면 즉시 다음 칼럼으로 넘어가므로 실제 비용은 매우 낮다.
   */
  emptyCols(): number[] {
    const rows = this.rows
    const out: number[] = []
    for (let c = 0; c < this.colCount; c++) {
      let empty = true
      for (let i = 0; i < rows.length; i++) {
        const v = rows[i][c]
        if (v !== undefined && v !== '') {
          empty = false
          break
        }
      }
      if (empty) out.push(c)
    }
    return out
  }

  setColWidth(col: number, w: number): void {
    const next = this.colWidths.slice()
    next[col] = Math.max(MIN_W, Math.min(1200, Math.round(w)))
    this.colWidths = next
  }

  /** 칼럼 내용에 맞춰 폭을 재계산한다 (헤더 경계 더블클릭). */
  autoWidth(col: number): void {
    const next = this.colWidths.slice()
    next[col] = measureCol(this.rows, this.header[col] ?? '', col)
    this.colWidths = next
  }

  /** 뷰 칼럼 인덱스 → source 칼럼 인덱스 */
  srcCol(viewCol: number): number {
    return this.colOrder[viewCol] ?? 0
  }

  /**
   * 편집 연산을 적용한다. **모든 데이터 변경은 이 함수를 지난다.**
   * 되돌리기는 {@link invert}로 역연산을 만들어 다시 이 함수에 넣는다.
   *
   * @returns 구조(행 수/열 수)가 바뀌었는지 — 호출부가 선택 해제/재추론을 결정하는 데 쓴다.
   */
  apply(op: Op): { structural: boolean } {
    switch (op.t) {
      case 'cells': {
        const rows = this.rows
        const touched = new Set<number>()
        for (const c of op.changes) {
          const row = rows[c.r]
          if (!row) continue
          row[c.c] = c.after
          touched.add(c.r)
        }
        // 편집된 행만 검색 인덱스를 패치한다 (전체 재구축은 10만 행에서 수십 ms)
        for (const r of touched) this.searchIndex[r] = searchKeyFor(rows[r])
        this.bump()
        return { structural: false }
      }

      case 'insertRows': {
        const rows = this.rows.slice()
        const keys = this.searchIndex
        // 오름차순으로 하나씩 넣으면 rows[k]는 정확히 at[k]에 놓인다
        for (let k = 0; k < op.at.length; k++) {
          const copy = op.rows[k].slice()
          rows.splice(op.at[k], 0, copy)
          keys.splice(op.at[k], 0, searchKeyFor(copy))
        }
        this.rows = rows
        this.bump()
        return { structural: true }
      }

      case 'deleteRows': {
        const rows = this.rows.slice()
        const keys = this.searchIndex
        // 내림차순 제거 — 앞에서부터 지우면 뒤 인덱스가 밀린다
        for (let k = op.at.length - 1; k >= 0; k--) {
          rows.splice(op.at[k], 1)
          keys.splice(op.at[k], 1)
        }
        this.rows = rows
        this.bump()
        return { structural: true }
      }

      case 'placeRows': {
        const rows = this.rows
        const keys = this.searchIndex
        const picked = op.picks.map((i) => rows[i])
        const pickedKeys = op.picks.map((i) => keys[i])
        const mark = new Set(op.picks)

        const kept: string[][] = []
        const keptKeys: string[] = []
        for (let i = 0; i < rows.length; i++) {
          if (mark.has(i)) continue
          kept.push(rows[i])
          keptKeys.push(keys[i])
        }
        for (let k = 0; k < op.dests.length; k++) {
          kept.splice(op.dests[k], 0, picked[k])
          keptKeys.splice(op.dests[k], 0, pickedKeys[k])
        }
        this.rows = kept
        this.searchIndex = keptKeys
        this.bump()
        return { structural: true }
      }

      case 'replaceRows': {
        this.rows = op.after.map((r) => r.slice())
        this.rebuildSearchIndex()
        this.retype()
        this.bump()
        return { structural: true }
      }

      case 'insertCols': {
        const rows = this.rows
        const header = this.header.slice()
        const widths = this.colWidths.slice()
        for (let k = 0; k < op.at.length; k++) {
          const at = op.at[k]
          for (let i = 0; i < rows.length; i++) {
            rows[i].splice(at, 0, op.values[i]?.[k] ?? '')
          }
          header.splice(at, 0, op.names[k])
          widths.splice(at, 0, textWidth(op.names[k]))
        }
        this.header = header
        this.colWidths = widths
        this.colOrder = op.orderAfter.slice()
        this.retype()
        this.rebuildSearchIndex()
        this.bump()
        return { structural: true }
      }

      case 'deleteCols': {
        const rows = this.rows
        const header = this.header.slice()
        const widths = this.colWidths.slice()
        for (let k = op.at.length - 1; k >= 0; k--) {
          const at = op.at[k]
          for (let i = 0; i < rows.length; i++) rows[i].splice(at, 1)
          header.splice(at, 1)
          widths.splice(at, 1)
        }
        this.header = header
        this.colWidths = widths
        this.colOrder = op.orderAfter.slice()
        this.retype()
        this.rebuildSearchIndex()
        this.bump()
        return { structural: true }
      }

      case 'setColOrder': {
        // 뷰 순서만 바꾼다 — 데이터는 그대로
        this.colOrder = op.after.slice()
        return { structural: false }
      }

      case 'renameCol': {
        const header = this.header.slice()
        header[op.c] = op.after
        this.header = header
        this.bump()
        return { structural: false }
      }
    }
  }
}

/**
 * 연산의 역연산. `apply(invert(op))`가 `apply(op)`를 되돌린다.
 *
 * 구조 변경 op는 삽입/삭제가 정확히 서로의 역이 되도록 인덱스 배열 규약을 지킨다
 * ({@link Op} 문서 참고). `insertCols`/`deleteCols`는 `colOrder` 스냅샷을 맞바꿔
 * 뷰 순서까지 원상복구한다.
 */
export function invert(op: Op): Op {
  switch (op.t) {
    case 'cells':
      return {
        t: 'cells',
        changes: op.changes.map((c) => ({ r: c.r, c: c.c, before: c.after, after: c.before })),
      }
    case 'insertRows':
      return { t: 'deleteRows', at: op.at, rows: op.rows }
    case 'deleteRows':
      return { t: 'insertRows', at: op.at, rows: op.rows }
    case 'placeRows':
      return { t: 'placeRows', picks: op.dests, dests: op.picks }
    case 'replaceRows':
      return { t: 'replaceRows', before: op.after, after: op.before }
    case 'insertCols':
      return {
        t: 'deleteCols',
        at: op.at,
        names: op.names,
        values: op.values,
        orderBefore: op.orderAfter,
        orderAfter: op.orderBefore,
      }
    case 'deleteCols':
      return {
        t: 'insertCols',
        at: op.at,
        names: op.names,
        values: op.values,
        orderBefore: op.orderAfter,
        orderAfter: op.orderBefore,
      }
    case 'setColOrder':
      return { t: 'setColOrder', before: op.after, after: op.before }
    case 'renameCol':
      return { t: 'renameCol', c: op.c, before: op.after, after: op.before }
  }
}

function clampWidth(px: number): number {
  return Math.max(MIN_W, Math.min(MAX_W, Math.ceil(px)))
}

/** 헤더명 하나가 필요로 하는 폭 (버튼·글리프 여백 포함). */
function headWidth(name: string): number {
  return textPx(name, HEAD_FONT, 0.04) + HEAD_CHROME
}

/** 새 칼럼처럼 내용이 없을 때 헤더명만으로 폭을 잡는다. */
function textWidth(name: string): number {
  return clampWidth(headWidth(name))
}

/**
 * 칼럼 하나의 폭을 내용에서 측정한다.
 *
 * 본문에 필요한 폭과 헤더에 필요한 폭을 따로 계산해 큰 쪽을 쓴다(헤더는 글리프·정렬·필터
 * 버튼이 붙어 고정 여백이 더 크다). 행은 전 구간을 균등 샘플링해 앞부분만 보고 오판하지 않는다.
 *
 * 가장 긴 값을 **표시 폭**으로 먼저 골라낸 뒤 그 문자열만 실측한다 — 400개를 전부 실측하면
 * 칼럼 수가 많을 때 로드가 느려진다.
 */
function measureCol(rows: readonly string[][], headerName: string, col: number): number {
  let widest = ''
  let widestW = -1
  const step = Math.max(1, Math.floor(rows.length / 400))
  for (let i = 0; i < rows.length; i += step) {
    const v = rows[i][col] ?? ''
    const w = displayWidth(v)
    if (w > widestW) {
      widestW = w
      widest = v
    }
  }
  const bodyW = widest === '' ? 0 : textPx(widest, CELL_FONT) + CELL_PAD
  return clampWidth(Math.max(bodyW, headWidth(headerName)))
}

/** 로드 직후 모든 칼럼의 초기 폭을 추정한다. */
function estimateWidths(rows: readonly string[][], header: readonly string[]): number[] {
  return header.map((name, i) => measureCol(rows, name, i))
}

/** 헤더 없는 데이터셋용 A, B, C… 이름 생성. */
export function generatedHeader(width: number): string[] {
  return Array.from({ length: width }, (_, i) => columnLabel(i))
}
