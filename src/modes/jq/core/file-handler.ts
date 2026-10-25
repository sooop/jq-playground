/**
 * 입력 파일 읽기 — 크기 상한과 인코딩 처리만 담당한다.
 *
 * 원본 jq-playground 는 `FileReader.readAsText`(UTF-8 고정)를 썼지만, 여기서는 xsv 의
 * `decodeBytes` 를 거쳐 cp949 한글 파일도 깨지지 않게 한다(CSV 입력을 그대로 받는 경로가
 * 있으므로 실제로 필요하다).
 */
import { decodeBytes } from '../../../lib/parse/detect'

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

export function validateFileSize(file: File): true {
  if (file.size > MAX_FILE_SIZE) {
    const maxMB = (MAX_FILE_SIZE / 1024 / 1024).toFixed(1)
    const currentMB = (file.size / 1024 / 1024).toFixed(1)
    throw new Error(`파일이 너무 큽니다. 최대 ${maxMB}MB까지만 허용됩니다. (현재: ${currentMB}MB)`)
  }
  return true
}

/** 파일 전체를 텍스트로 읽는다. 크기 초과·읽기 실패는 reject. */
export async function readFile(file: File): Promise<string> {
  validateFileSize(file)
  const buf = await file.arrayBuffer()
  return decodeBytes(buf).text
}

/** 텍스트를 파일로 내려받는다. */
export function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/plain; charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
