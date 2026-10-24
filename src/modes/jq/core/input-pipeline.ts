/**
 * 입력 진입점 파이프라인 — 파일 선택 / 드롭 / 붙여넣기 / 히스토리 / 모드 간 전송이
 * 전부 여기를 지난다.
 *
 * 원본(`InputPanel.ts`)은 같은 분기를 파일 핸들러·드롭 핸들러·붙여넣기 핸들러에 세 번
 * 복사해 두고 있었다. 한곳으로 모으면서 `confirm/alert` 은 전부 `dialogs` 로 바꿨다
 * (그래서 붙여넣기 경로가 비동기가 된다 — 호출부는 `await` 해야 한다).
 */
import { dialogs } from '../../../lib/ui/dialog/dialog.svelte'
import { csvToJson, detectDelimiter } from './csv-parser'
import { extractJson, needsJsonExtraction, tryFormatJson } from '../utils/json-extractor'
import { formatCandidate, preprocessJson } from '../utils/json-preprocessor'

/** 이 크기 이하면 묻지 않고 JSON을 추출한다 */
const AUTO_EXTRACT_SIZE = 100 * 1024
/** 이 크기를 넘으면 붙여넣기 후처리(CSV 감지·추출·포맷)를 전부 건너뛴다 */
const LARGE_INPUT_THRESHOLD = 1024 * 1024

export interface PipelineResult {
  /** 입력 상자에 넣을 텍스트 */
  text: string
  /** 입력 이름(파일명). 알 수 없으면 null */
  fileName: string | null
  /** "Parse as CSV" 버튼을 띄울지 */
  showParseCsv: boolean
  /** JSON 후보가 여럿이라 Transform 모달을 열어야 하는지 */
  openTransform: boolean
  /** 붙여넣기 이후의 자동 포맷 상태 */
  autoFormat: boolean
  /** 사용자에게 알릴 말(토스트) */
  notice?: string
}

function base(text: string, fileName: string | null): PipelineResult {
  return { text, fileName, showParseCsv: false, openTransform: false, autoFormat: true }
}

/** CSV/TSV 텍스트를 객체 배열 JSON 으로 바꾼다. 실패하면 throw. */
export function convertCsvToJson(text: string): string {
  try {
    return JSON.stringify(csvToJson(text, { hasHeader: true, inferTypes: false }), null, 2)
  } catch (error) {
    throw new Error('CSV 파싱 실패: ' + (error instanceof Error ? error.message : String(error)))
  }
}

/** 유효한 JSON 이 아니면서 구분자가 일정하게 잡히면 CSV 로 본다. */
export function isCsvLike(text: string): boolean {
  try {
    JSON.parse(text)
    return false
  } catch {
    const lines = text.split('\n').filter((l) => l.trim())
    if (lines.length < 2) return false
    return detectDelimiter(text) !== null
  }
}

/** 파일 확장자(소문자, 점 없음) */
function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

/**
 * 파일에서 읽은 내용을 입력으로 만든다(파일 선택·드롭 공통).
 * `.csv/.tsv` 는 JSON 배열로 바꾸고, 그 외에는 JSON 추출·포맷을 시도한다.
 */
export async function fromFileContent(content: string, fileName: string): Promise<PipelineResult> {
  const ext = extOf(fileName)

  if (ext === 'csv' || ext === 'tsv') {
    try {
      return { ...base(convertCsvToJson(content), fileName), notice: `${ext.toUpperCase()} → JSON 으로 변환했습니다.` }
    } catch (error) {
      await dialogs.alert({
        title: 'CSV 변환 실패',
        message: error instanceof Error ? error.message : String(error),
        detail: '원본 내용을 그대로 표시합니다.',
        tone: 'warn',
      })
      return base(content, fileName)
    }
  }

  return { ...(await fromRawText(content, fileName)), fileName }
}

/**
 * 원시 텍스트를 입력으로 만든다. 유효한 JSON 이면 포맷만, 아니면 추출을 묻는다.
 * 파일·모드 간 전송·`openText` 가 공유한다.
 */
export async function fromRawText(text: string, fileName: string | null): Promise<PipelineResult> {
  if (!needsJsonExtraction(text)) return base(tryFormatJson(text), fileName)

  const shouldExtract =
    text.length <= AUTO_EXTRACT_SIZE ||
    (await dialogs.confirm({
      title: 'JSON 추출',
      message: '유효하지 않은 JSON이 감지되었습니다. JSON 객체를 추출할까요?',
      okLabel: '추출',
    }))
  if (!shouldExtract) return base(text, fileName)

  const extracted = extractJson(text)
  if (extracted) return base(extracted, fileName)
  if (text.length > AUTO_EXTRACT_SIZE) {
    await dialogs.alert({ message: '유효한 JSON 객체를 찾을 수 없습니다.', tone: 'warn' })
  }
  return base(text, fileName)
}

/**
 * 붙여넣기 직후의 후처리. 원본의 5분기를 그대로 유지한다.
 *  ① 1MB 초과 → 아무것도 하지 않는다(UI 블로킹 방지, 자동 포맷도 끈 채로 둔다)
 *  ② CSV 처럼 보임 → "Parse as CSV" 버튼만 띄운다
 *  ③ 후보 2개 이상 → Transform 모달을 연다
 *  ④ 후보 1개 → (작으면 바로 / 크면 확인 후) 그 후보를 포맷해 넣는다
 *  ⑤ 후보 0개 → 기존 추출기 폴백
 */
export async function fromPaste(text: string, fileName: string | null): Promise<PipelineResult> {
  const size = text.length

  if (size > LARGE_INPUT_THRESHOLD) {
    return { ...base(text, fileName), autoFormat: false }
  }

  if (isCsvLike(text)) {
    return { ...base(text, fileName), showParseCsv: true }
  }

  if (!needsJsonExtraction(text)) {
    return base(tryFormatJson(text), fileName)
  }

  const { candidates } = preprocessJson(text, { extract: true, unstringify: false })

  if (candidates.length > 1) {
    return { ...base(text, fileName), openTransform: true }
  }

  const shouldExtract =
    size <= AUTO_EXTRACT_SIZE ||
    (await dialogs.confirm({
      title: 'JSON 추출',
      message: '유효하지 않은 JSON이 감지되었습니다. JSON 객체를 추출할까요?',
      okLabel: '추출',
    }))
  if (!shouldExtract) return base(text, fileName)

  if (candidates.length === 1) {
    return base(formatCandidate(candidates[0]!), fileName)
  }

  const extracted = extractJson(text)
  if (extracted) return base(extracted, fileName)
  if (size > AUTO_EXTRACT_SIZE) {
    await dialogs.alert({ message: '유효한 JSON 객체를 찾을 수 없습니다.', tone: 'warn' })
  }
  return base(text, fileName)
}

/** 표를 jq 입력용 객체 배열 JSON 으로 만든다(CSV 모드에서 보낸 payload). */
export function tableToJson(header: string[], rows: string[][]): string {
  const objects = rows.map((r) => {
    const o: Record<string, string> = {}
    header.forEach((h, i) => {
      o[h || `col${i + 1}`] = r[i] ?? ''
    })
    return o
  })
  return JSON.stringify(objects, null, 2)
}
