/**
 * jq 모드 상태 — 입력·쿼리·결과와 실행 파이프라인.
 *
 * 실행 규칙(원본 `App.ts:395-495` 를 그대로 옮긴 것):
 *  - 디바운스 지연은 **입력 길이**로 정한다: 3MB 초과 1000ms / 500KB 초과 500ms / 그 외 300ms.
 *    `.length` 는 O(1) 이라 매 타이핑마다 Blob 을 만들지 않는다.
 *  - 자동 실행 트리거는 `input.length` · `query` · `autoPlay` **셋뿐**이다. 포맷 변경은
 *    재실행이 아니라 워커에 캐싱된 결과의 재포맷(`formatResult`)이므로 별도 effect 로 뺀다.
 *  - generation 카운터로 stale 응답을 버린다(느린 쿼리 뒤에 빠른 쿼리가 끝나는 경우).
 *  - 포맷은 `await execute()` **뒤에** 읽는다 — 기다리는 동안 사용자가 바꿨을 수 있다.
 *  - 입력이 3MB 를 넘고 강제 실행이 아니면 자동 실행을 꺼 버린다.
 */
import { untrack } from 'svelte'
import { jqEngine, type EngineState } from './core/jq-engine'
import type { Matrix } from './core/csv-converter'
import { jsonToMatrix } from './core/csv-converter'
import { saveQueryHistory } from './data/storage'
import { load, save } from '../../lib/util/storage'

export type OutputFormat = 'json' | 'csv'

const SIZE_3MB = 3 * 1024 * 1024
const SIZE_500KB = 500 * 1024

/** 결과 그리드가 감당할 만한 행 수. 넘으면 토스트로 경고한다. */
export const GRID_ROW_WARN = 200_000

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

class JqStore {
  // ── 입력 ───────────────────────────────────────────────────────────────────
  input = $state('')
  inputName = $state<string | null>(null)
  /** 붙여넣기 자동 포맷. 대용량 붙여넣기에서 자동으로 꺼진다. */
  autoFormat = $state(true)
  /** Transform 적용 직전 스냅샷 되돌리기 — 있으면 Input 툴바에 Undo 버튼이 뜬다 */
  transformUndo = $state<(() => void) | null>(null)

  // ── 쿼리 ───────────────────────────────────────────────────────────────────
  query = $state('')

  // ── 출력 ───────────────────────────────────────────────────────────────────
  format = $state<OutputFormat>('json')
  autoPlay = $state(true)
  maximized = $state(false)
  resultText = $state<string | null>(null)
  /**
   * CSV 결과 행렬. 수만 행이 들어오므로 **반응형 프록시로 감싸지 않는다**
   * (`$state.raw`) — 깊은 프록시는 여기서 순수한 낭비다.
   */
  matrix = $state.raw<Matrix | null>(null)
  execMs = $state<number | undefined>(undefined)
  loading = $state(false)
  error = $state<string | null>(null)
  /** 에러가 났지만 이전 결과를 흐리게 남겨 둔 상태 */
  stale = $state(false)
  lastRunAt = $state('')

  // ── 레이아웃 ───────────────────────────────────────────────────────────────
  /** 입력/쿼리 가로 분할 비율(%) */
  splitH = $state<number>(load('jq.splitH', 50))
  /** 상단/출력 세로 분할 비율(%) */
  splitV = $state<number>(load('jq.splitV', 50))

  // ── 엔진 ───────────────────────────────────────────────────────────────────
  engine = $state<EngineState>('idle')
  engineError = $state<string | null>(null)

  #gen = 0
  #timer: ReturnType<typeof setTimeout> | null = null
  #installed = false
  /** 결과 행수 경고를 한 번만 내기 위한 표시 */
  #warnedRows = false

  /** 외부에서 결과를 받았을 때 알리는 훅(그리드 적재·토스트). JqMode 가 채운다. */
  onResult: ((m: Matrix | null) => void) | null = null
  onNotice: ((msg: string, kind?: 'info' | 'ok' | 'warn') => void) | null = null

  get hasDocument(): boolean {
    return this.input.trim().length > 0
  }

  /** 디바운스 `$effect` 를 한 번만 건다. 컴포넌트 밖의 싱글턴이라 루트 스코프를 쓴다. */
  install(): void {
    if (this.#installed) return
    this.#installed = true

    $effect.root(() => {
      // 자동 실행 — 트리거는 입력 길이·쿼리·autoPlay 셋뿐이다
      $effect(() => {
        const len = this.input.length
        void this.query
        void this.autoPlay
        this.#schedule(len)
      })

      // 포맷 전환 — 재실행이 아니라 캐싱된 결과의 재포맷이다.
      // 의존은 `format` 하나뿐이어야 한다. `reformat` 이 resultText/matrix 를 쓰므로
      // 그것들을 추적하면 effect 가 자기 쓰기에 다시 반응해 무한 루프가 된다.
      $effect(() => {
        const fmt = this.format
        untrack(() => {
          if (this.resultText === null && this.matrix === null) return
          void this.reformat(fmt)
        })
      })
      return () => {}
    })
  }

  #schedule(len: number): void {
    if (this.#timer !== null) clearTimeout(this.#timer)
    const delay = len > SIZE_3MB ? 1000 : len > SIZE_500KB ? 500 : 300
    this.#timer = setTimeout(() => void this.run(false), delay)
  }

  /** 수동 실행(Execute 버튼 / Ctrl+Enter). autoPlay 상태를 바꾸지 않는다. */
  runNow(): void {
    if (this.#timer !== null) clearTimeout(this.#timer)
    void this.run(true)
  }

  /** jq 엔진 준비. 실패하면 `engine='failed'` 로 두고 사유를 남긴다. */
  async ensureEngine(): Promise<boolean> {
    if (this.engine === 'ready') return true
    this.engine = 'loading'
    try {
      await jqEngine.init()
      this.engine = 'ready'
      this.engineError = null
      return true
    } catch (e) {
      this.engine = 'failed'
      this.engineError = errMessage(e)
      return false
    }
  }

  async run(force: boolean): Promise<void> {
    if (!force && !this.autoPlay) return

    const input = this.input
    if (input.length > SIZE_3MB && !force) {
      // 자동 실행을 끄고 안내한다 — 매 타이핑마다 3MB 를 파싱하게 둘 수 없다
      if (this.autoPlay) {
        this.autoPlay = false
        this.error = '자동 실행을 껐습니다: 입력이 3MB를 넘습니다. Execute 버튼으로 직접 실행하세요.'
        this.stale = this.resultText !== null || this.matrix !== null
      }
      return
    }

    const query = this.query
    if (!input || !query) {
      this.clearResult()
      return
    }

    if (!(await this.ensureEngine())) {
      this.error = this.engineError ?? 'jq 엔진을 불러오지 못했습니다.'
      return
    }

    this.loading = true
    const gen = ++this.#gen

    try {
      const { resultText, executionTime } = await jqEngine.execute(input, query)
      if (gen !== this.#gen) return

      // 기다리는 동안 포맷이 바뀌었을 수 있으므로 지금 읽는다
      const format = this.format
      void saveQueryHistory(query)

      this.error = null
      this.stale = false
      this.execMs = executionTime
      this.lastRunAt = new Date().toLocaleTimeString()

      if (format === 'json') {
        this.resultText = resultText
        this.#setMatrix(null)
      } else {
        try {
          const csv = await jqEngine.formatResult('csv')
          if (gen !== this.#gen) return
          this.resultText = resultText
          this.#setMatrix({ header: csv.header ?? [], rows: csv.rows ?? [] })
        } catch {
          // 워커 포맷 실패 → 메인 스레드에서 직접 행렬을 만든다
          if (gen !== this.#gen) return
          this.resultText = resultText
          try {
            this.#setMatrix(jsonToMatrix(JSON.parse(resultText)))
          } catch {
            this.format = 'json'
            this.#setMatrix(null)
          }
        }
      }
    } catch (e) {
      if (gen !== this.#gen) return
      this.error = errMessage(e)
      // 이전 결과는 지우지 않고 흐리게 남긴다
      this.stale = this.resultText !== null || this.matrix !== null
    } finally {
      if (gen === this.#gen) this.loading = false
    }
  }

  /** 포맷만 바꿔 다시 그린다. 워커에 캐싱된 결과를 쓰고, 실패하면 재실행한다. */
  async reformat(format: OutputFormat): Promise<void> {
    if (this.engine !== 'ready') return
    const gen = this.#gen
    try {
      const r = await jqEngine.formatResult(format)
      if (gen !== this.#gen) return
      if (r.format === 'json') {
        this.resultText = r.resultText ?? this.resultText
        this.#setMatrix(null)
      } else {
        this.#setMatrix({ header: r.header ?? [], rows: r.rows ?? [] })
      }
    } catch {
      // 워커 캐시가 없을 때: 마지막 텍스트로 직접 변환, 그것도 안 되면 재실행
      if (format === 'csv' && this.resultText) {
        try {
          this.#setMatrix(jsonToMatrix(JSON.parse(this.resultText)))
          return
        } catch {
          /* 재실행으로 넘어간다 */
        }
      } else if (format === 'json') {
        this.#setMatrix(null)
        return
      }
      void this.run(true)
    }
  }

  #setMatrix(m: Matrix | null): void {
    this.matrix = m
    if (m && m.rows.length > GRID_ROW_WARN && !this.#warnedRows) {
      this.#warnedRows = true
      this.onNotice?.(
        `결과가 ${m.rows.length.toLocaleString()}행입니다. 그리드가 느려질 수 있습니다.`,
        'warn',
      )
    }
    if (!m || m.rows.length <= GRID_ROW_WARN) this.#warnedRows = false
    this.onResult?.(m)
  }

  clearResult(): void {
    this.#gen++
    this.resultText = null
    this.#setMatrix(null)
    this.execMs = undefined
    this.error = null
    this.stale = false
    this.loading = false
  }

  /** 입력 교체 — 파일 열기·붙여넣기·모드 간 전송의 공통 종착점 */
  setInput(text: string, name: string | null): void {
    this.input = text
    this.inputName = name
    this.transformUndo = null
  }

  toggleAutoPlay(): void {
    this.autoPlay = !this.autoPlay
    if (this.autoPlay) this.runNow()
  }

  persistSplit(): void {
    save('jq.splitH', this.splitH)
    save('jq.splitV', this.splitV)
  }

  dispose(): void {
    if (this.#timer !== null) clearTimeout(this.#timer)
    jqEngine.terminate()
  }
}

export const jq = new JqStore()
