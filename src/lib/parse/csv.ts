import type { Delimiter } from '../data/types'

/**
 * 재개 가능한 RFC4180 파서.
 *
 * 수십 MB 입력에서 UI가 오래 얼어붙지 않도록, 상태(`inQuotes`, 진행 중인 필드/행)를 인스턴스에
 * 보관해 여러 번의 `push()` 호출로 나눠 파싱할 수 있게 만들었다. 청크 경계는 문자 단위로 임의
 * 위치에 와도 안전하다. 한 번에 다 파싱하려면 {@link parseAll}을 쓴다.
 *
 * 처리 규칙
 * - `"` 인용, `""`는 리터럴 `"`. 인용 안에서는 구분자·개행이 데이터로 취급된다
 * - 필드 **선두**의 `"`만 인용 시작으로 인정한다 (`a"b` 같은 값은 그대로 보존)
 * - 개행은 `\r\n` / `\n` / `\r` 모두 행 구분으로 본다
 * - 완전히 빈 줄은 버린다(파일 끝 개행과 구분되지 않으므로). 단 `""`처럼 인용된 빈 값은 살린다
 * - 인용이 닫히지 않고 입력이 끝나면 남은 내용을 마지막 필드로 확정한다(관대한 복구)
 */
export class CsvParser {
  private readonly delim: number
  private rows: string[][] = []
  private field = ''
  private row: string[] = []
  private inQuotes = false
  /** 인용 안에서 `"`를 만난 직후 — 다음 문자가 `"`면 이스케이프, 아니면 인용 종료 */
  private quotePending = false
  /** 현재 필드에 인용이 있었는지. 빈 값과 "값 없음"을 구분한다. */
  private fieldQuoted = false
  /** 현재 행의 어떤 필드에든 인용이 있었는지. 빈 줄 스킵 판정에 쓴다. */
  private rowQuoted = false
  /** 직전 문자가 `\r`이어서 곧바로 오는 `\n`을 삼켜야 하는지 */
  private pendingLf = false

  constructor(delimiter: Delimiter) {
    this.delim = delimiter.charCodeAt(0)
  }

  /** 텍스트 조각을 파싱해 내부 행 버퍼에 누적한다. */
  push(chunk: string): void {
    const delim = this.delim
    const len = chunk.length
    let start = 0 // 아직 field로 복사하지 않은 평문 구간의 시작

    for (let i = 0; i < len; i++) {
      const code = chunk.charCodeAt(i)

      if (this.pendingLf) {
        this.pendingLf = false
        if (code === 10) {
          // \r\n 의 \n — 이미 \r에서 행을 끊었으므로 건너뛴다
          start = i + 1
          continue
        }
      }

      if (this.inQuotes) {
        if (this.quotePending) {
          this.quotePending = false
          if (code === 34) {
            // "" → 리터럴 따옴표
            this.field += '"'
            start = i + 1
            continue
          }
          // 인용 종료. 이 문자는 인용 밖 문자로 다시 판정한다.
          this.inQuotes = false
          start = i
        } else {
          if (code === 34) {
            this.field += chunk.slice(start, i)
            this.quotePending = true
            start = i + 1
          }
          continue
        }
      }

      // --- 인용 밖 ---
      if (code === delim) {
        this.field += chunk.slice(start, i)
        this.endField()
        start = i + 1
      } else if (code === 10) {
        this.field += chunk.slice(start, i)
        this.endRow()
        start = i + 1
      } else if (code === 13) {
        this.field += chunk.slice(start, i)
        this.endRow()
        this.pendingLf = true
        start = i + 1
      } else if (code === 34 && this.field === '' && start === i && !this.fieldQuoted) {
        this.inQuotes = true
        this.fieldQuoted = true
        this.rowQuoted = true
        start = i + 1
      }
    }

    if (start < len) this.field += chunk.slice(start)
  }

  private endField(): void {
    this.row.push(this.field)
    this.field = ''
    this.fieldQuoted = false
  }

  private endRow(): void {
    this.endField()
    const blank = this.row.length === 1 && this.row[0] === '' && !this.rowQuoted
    this.rowQuoted = false
    if (blank) {
      this.row = []
      return
    }
    this.rows.push(this.row)
    this.row = []
  }

  /** 남은 상태를 확정하고 누적된 전체 행을 돌려준다. 호출 후 파서는 재사용하지 않는다. */
  finish(): string[][] {
    this.quotePending = false
    this.inQuotes = false
    if (this.field !== '' || this.row.length > 0 || this.fieldQuoted) {
      this.endRow()
    }
    const out = this.rows
    this.rows = []
    return out
  }

  /** 지금까지 확정된 행 수 — 진행률 표시용. */
  get rowCount(): number {
    return this.rows.length
  }
}

/** 전체 텍스트를 한 번에 파싱한다. 테스트와 소용량 입력(붙여넣기)에 쓴다. */
export function parseAll(text: string, delimiter: Delimiter): string[][] {
  const p = new CsvParser(delimiter)
  p.push(text)
  return p.finish()
}

/**
 * 큰 텍스트를 청크로 나눠 파싱하며 진행률을 보고한다.
 * 청크 경계에서 양보하므로 진행률 오버레이가 갱신된다.
 */
export async function parseChunked(
  text: string,
  delimiter: Delimiter,
  onProgress?: (ratio: number, rows: number) => void,
  chunkSize = 4 << 20,
): Promise<string[][]> {
  const p = new CsvParser(delimiter)
  const total = text.length
  if (total <= chunkSize) {
    p.push(text)
    onProgress?.(1, p.rowCount)
    return p.finish()
  }
  for (let pos = 0; pos < total; pos += chunkSize) {
    p.push(text.slice(pos, Math.min(total, pos + chunkSize)))
    onProgress?.(Math.min(1, (pos + chunkSize) / total), p.rowCount)
    await new Promise<void>((r) => setTimeout(r, 0))
  }
  return p.finish()
}
