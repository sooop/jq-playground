/**
 * 셸 상태 — jq 작업공간 위에 겹치는 CSV 뷰어와 파일 열기.
 *
 * 문서는 한 번에 하나만 연다. jq 모드는 항상 마운트되어 있고(입력·쿼리 상태 유지), 뷰어는
 * `viewer`가 있을 때만 그 위에 전체 화면으로 뜬다. 저장하지 않으므로 새로고침하면 사라진다.
 */
import { sniffFile } from './fileKind'

/** 뷰어가 여는 문서. 표는 텍스트로 직렬화하지 않고 2차원 배열 그대로 넘긴다. */
export type ViewerSource =
  | { kind: 'file'; file: File }
  | { kind: 'table'; header: string[]; rows: string[][]; name: string; from: 'jq' | 'paste' }
  | { kind: 'text'; text: string; name: string }

export interface JqHandle {
  openFile(file: File): Promise<void>
  openText(text: string, name: string): Promise<void>
}

/** 브라우저 탭 제목의 꼬리표. */
export const APP_NAME = 'jq Playground'

class ShellController {
  /** 대용량 행렬을 proxy로 감싸지 않도록 raw 로 둔다 */
  viewer = $state.raw<ViewerSource | null>(null)

  /** jq 모드가 채우는 문서 이름 */
  jqLabel = $state('')
  viewerLabel = $state('')

  /** 반응형이 아니다(컴포넌트 인스턴스를 proxy로 감싸면 안 된다). */
  jq: JqHandle | undefined = undefined

  /** 셸이 소유한 숨은 `<input type=file>`. App이 `bind:this`로 채운다. */
  fileInput: HTMLInputElement | null = null

  get docTitle(): string {
    const label = this.viewer ? this.viewerLabel : this.jqLabel
    return [label, this.viewer ? 'CSV 뷰어' : '', APP_NAME].filter(Boolean).join(' · ')
  }

  /** 파일 선택 대화상자를 연다(메뉴 "파일 열기", Ctrl+O). */
  requestOpen(): void {
    this.fileInput?.click()
  }

  /** 드롭·파일 선택의 모든 진입점. 첫 파일만 연다. */
  async openFiles(files: FileList | File[] | null | undefined): Promise<void> {
    const file = files?.[0]
    if (!file) return
    if ((await sniffFile(file)) === 'viewer') {
      this.viewer = { kind: 'file', file }
      return
    }
    this.viewer = null
    await this.jq?.openFile(file)
  }

  openViewer(src: ViewerSource): void {
    this.viewer = src
  }

  closeViewer(): void {
    this.viewer = null
  }
}

export const shell = new ShellController()
