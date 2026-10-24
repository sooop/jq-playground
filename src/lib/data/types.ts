/** 칼럼의 추론된 데이터 타입. 정렬 비교자·정렬(alignment)·칼럼 필터 UI를 결정한다. */
export type ColType = 'number' | 'date' | 'string'

export type Delimiter = ',' | '\t' | ';' | '|'

/** 파서가 돌려주는 원시 파싱 결과. */
export interface ParseResult {
  /** 헤더를 제외한 데이터 행. 모든 행은 `width` 길이로 패딩되어 있다. */
  rows: string[][]
  /** 칼럼명. `hasHeader`가 false면 A, B, C… 로 생성된 이름. */
  header: string[]
  width: number
  delimiter: Delimiter
  /** 1행을 헤더로 판단했는지 (휴리스틱 결과 또는 사용자 지정) */
  hasHeader: boolean
  /** 원본 1행 — 헤더 토글 시 재파싱 없이 앞뒤로 옮기기 위해 보관 */
  firstRow: string[] | null
  /** 길이가 최대 칼럼 수에 못 미쳐 패딩된 행 수 */
  raggedRows: number
  /** 디코딩 중 U+FFFD가 나타났는지 — cp949 폴백 배너 트리거 */
  suspectEncoding: boolean
}

/** 정렬 지시. 배열 순서가 곧 우선순위(앞이 높음). */
export interface SortSpec {
  /** source 칼럼 인덱스 */
  col: number
  dir: 'asc' | 'desc'
}

/** 칼럼 필터 — 고유값 체크박스 모드와 텍스트 조건 모드 중 하나. */
export type ColumnFilter =
  | {
      mode: 'values'
      /** 제외된 값들. 비어 있으면 필터가 없는 것과 같다. */
      excluded: Set<string>
    }
  | {
      mode: 'text'
      query: string
      /** true면 정규식, false면 부분 문자열 */
      regex: boolean
      /** true면 조건에 맞는 행을 제외 */
      negate: boolean
    }

/** 스마트 필터 쿼리를 컴파일한 결과. */
export interface Matcher {
  kind: 'empty' | 'terms' | 'regex'
  /** 대소문자를 구분하는지 (스마트 케이스 결과) */
  caseSensitive: boolean
  /** kind==='terms': AND 그룹의 배열. 각 그룹은 OR 항의 배열. */
  groups: string[][]
  /** kind==='regex' */
  re: RegExp | null
  /** 컴파일 실패 메시지 (정규식이 잘못된 경우) */
  error: string | null
}

/** 뷰 좌표계의 사각 선택 범위. r/c는 정규화(r0<=r1, c0<=c1)되어 있다. */
export interface Range {
  r0: number
  c0: number
  r1: number
  c1: number
  /** 'row'/'col'은 행·열 전체 선택으로 만들어졌음을 뜻한다(헤더 강조·순서변경 판정용) */
  kind: 'cell' | 'row' | 'col'
}

export interface CellRef {
  r: number
  c: number
}

/** 뷰 좌표. 행은 viewRows 인덱스, 열은 colOrder 인덱스. */
export interface Selection {
  ranges: Range[]
  anchor: CellRef
  active: CellRef
}

/**
 * 되돌릴 수 있는 편집 연산. 좌표는 모두 **source** 기준.
 *
 * ## 인덱스 배열 규약
 * 행·열 구조 변경 op는 연속 범위가 아니라 **오름차순 인덱스 배열**을 쓴다. Ctrl-클릭으로
 * 비연속 행/열을 골라 삭제하는 경우를 정확히 되돌리기 위해서다. 규약은 두 가지뿐이다.
 *
 * - **삽입**: `at[k]`에 `k`번째 항목을 오름차순으로 하나씩 넣으면 항목 `k`는 정확히 `at[k]`에 놓인다
 * - **삭제**: `at`의 인덱스를 내림차순으로 제거한다
 *
 * 이 둘이 서로의 역연산이므로 모든 구조 변경이 대칭적으로 되돌려진다.
 */
export type Op =
  | { t: 'cells'; changes: { r: number; c: number; before: string; after: string }[] }
  /** `at[k]`에 `rows[k]`를 삽입 */
  | { t: 'insertRows'; at: number[]; rows: string[][] }
  /** `at[k]`의 행을 제거. `rows[k]`는 되돌리기용으로 보관한 내용 */
  | { t: 'deleteRows'; at: number[]; rows: string[][] }
  /**
   * 행 순서 변경. `picks`의 행들을 떼어 `dests`에 놓는다(둘 다 오름차순, 같은 길이).
   * 역연산은 `picks`/`dests`를 맞바꾼 것 — 연속·비연속 선택 모두 정확히 되돌아간다.
   */
  | { t: 'placeRows'; picks: number[]; dests: number[] }
  /**
   * 행 집합 전체 교체. 행 수와 내용이 동시에 바뀌는 변환(예: 셀을 행으로 나누기)에 쓴다.
   *
   * 전후를 통째로 보관하므로 페이로드가 크다 — 부분 연산으로 표현할 수 없는 경우에만 쓰고,
   * 호출부가 크기를 사용자에게 알린다. 히스토리 용량 상한이 오래된 항목부터 정리한다.
   */
  | { t: 'replaceRows'; before: string[][]; after: string[][] }
  /**
   * `at[k]`에 `names[k]` 칼럼을 삽입. `values[r][k]`는 r번째 행에 들어갈 값.
   * `orderBefore`/`orderAfter`는 이 op 전후의 `colOrder` 스냅샷 — 뷰 순서를 정확히 복원한다.
   */
  | {
      t: 'insertCols'
      at: number[]
      names: string[]
      values: string[][]
      orderBefore: number[]
      orderAfter: number[]
    }
  | {
      t: 'deleteCols'
      at: number[]
      names: string[]
      values: string[][]
      orderBefore: number[]
      orderAfter: number[]
    }
  /**
   * 뷰 칼럼 순서 변경 (데이터 불변). 전후 `colOrder` 배열을 그대로 담는다.
   *
   * 인덱스 하나로 표현하면 숨은 칼럼이 섞여 있을 때 뷰 위치 ↔ colOrder 위치 변환이 까다롭고
   * 틀리기 쉽다. colOrder는 길어도 수천 개라 배열 스냅샷이 훨씬 안전하고 충분히 싸다.
   */
  | { t: 'setColOrder'; before: number[]; after: number[] }
  | { t: 'renameCol'; c: number; before: string; after: string }

export type ExportScope = 'all' | 'view' | 'selection'
export type ExportFormat =
  | 'csv'
  | 'tsv'
  /** 서식 없는 `<table>` 마크업 */
  | 'html'
  /** 서식 있는 HTML (클립보드: text/html + TSV, 파일: 인라인 스타일 문서) */
  | 'htmlrich'
  /** 박스 문자 표 */
  | 'box'
  | 'json'
  /** 마크다운 파이프 표 */
  | 'mdtable'
  /** 마크다운 불릿 목록 (레코드당 한 블록) */
  | 'mdlist'
export type ExportTarget = 'file' | 'clipboard'

export interface ExportOptions {
  scope: ExportScope
  format: ExportFormat
  target: ExportTarget
  includeHeader: boolean
  /** 현재 화면의 칼럼 순서를 적용할지 (false면 원본 순서) */
  applyColOrder: boolean
  quoting: 'minimal' | 'always'
  newline: '\n' | '\r\n'
  bom: boolean
}
