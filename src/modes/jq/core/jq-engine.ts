/**
 * jq 실행 엔진 — 전용 Web Worker 를 기본 경로로 쓰고, 워커가 죽으면 메인 스레드로 내려간다.
 *
 * 원본(jq-playground)과 달라진 점:
 *  - `init()`이 `window.jq` 를 **요구하지 않는다**. 워커가 CDN 에서 직접 `importScripts` 하므로
 *    보통은 메인 스레드에 jq-web 을 올리지 않는다. 워커가 실패했을 때만 `loadScript` 로
 *    받아와 폴백한다(그때도 Emscripten 로그는 `Module.print/printErr` 로 삼킨다).
 *  - `executeForContext` 가드가 `!this.instance` → `!this.worker && !this.instance` 로 완화됐다.
 *    워커 전용 모드에서 자동완성 컨텍스트 추론이 조용히 죽던 버그(원본 jq-engine.ts:257).
 *  - `console.*` 출력 0 — 실패는 상태(`failed`)와 `lastError` 로만 알린다.
 */
import { createJqWorker, JQ_CDN_BASE, JQ_CDN_JS, terminateJqWorker } from './jq-functions'
import type { BlobWorker } from './jq-functions'
import { loadScript } from '../../../lib/util/cdn'
import type { ContextResult, ExecuteResult, FormatResult } from '../types'
import type { JqInstance } from '../jq-web'

export type EngineState = 'idle' | 'loading' | 'ready' | 'failed'

type Pending = {
  resolve: (v: ExecuteResult | FormatResult) => void
  reject: (e: Error) => void
}

interface WorkerMessage {
  type: 'ready' | 'init_error' | 'result' | 'formatted' | 'error'
  id?: number
  message?: string
  resultBuffer?: ArrayBuffer
  resultText?: string
  executionTime?: number
  error?: string
  format?: 'json' | 'csv'
  header?: string[]
  rows?: string[][]
}

/** 워커 초기화를 기다릴 최대 시간. 넘으면 메인 스레드 폴백으로 내려간다. */
const WORKER_INIT_TIMEOUT = 20_000

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

class JqEngine {
  #instance: JqInstance | null = null
  #worker: BlobWorker | null = null
  #workerReady = false
  #workerFailed = false
  #pending = new Map<number, Pending>()
  #requestId = 0
  #queue: object[] = []
  #lastSentInput: string | null = null

  #state: EngineState = 'idle'
  #initPromise: Promise<void> | null = null
  /** 마지막 초기화 실패 사유(사용자에게 보여줄 문구) */
  lastError: string | null = null

  get state(): EngineState {
    return this.#state
  }

  /** 워커가 살아 있는지 — 자동완성 컨텍스트 추론이 가능한지 판단에 쓴다 */
  get usable(): boolean {
    return (this.#worker !== null && !this.#workerFailed) || this.#instance !== null
  }

  /**
   * 엔진을 준비한다. 여러 번 불러도 한 번만 실제로 로드한다.
   * 실패한 약속은 캐시하지 않는다 — 온라인이 되면 다시 시도할 수 있어야 한다.
   */
  init(): Promise<void> {
    if (this.#initPromise) return this.#initPromise
    this.#state = 'loading'
    this.lastError = null
    const p = this.#doInit().catch((e: unknown) => {
      this.#state = 'failed'
      this.lastError = errMessage(e)
      this.#initPromise = null
      throw e
    })
    this.#initPromise = p
    return p
  }

  async #doInit(): Promise<void> {
    try {
      await this.#initWorker()
      this.#state = 'ready'
      return
    } catch {
      // 워커 경로 실패 — 메인 스레드 폴백으로 내려간다
      this.#workerFailed = true
      if (this.#worker) {
        terminateJqWorker(this.#worker)
        this.#worker = null
      }
    }
    await this.#initMainThread()
    this.#state = 'ready'
  }

  /** 워커를 만들고 `ready` 메시지를 기다린다. */
  #initWorker(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const done = (err?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (err) reject(err)
        else resolve()
      }

      let worker: BlobWorker
      try {
        worker = createJqWorker()
      } catch (e) {
        reject(new Error('jq 워커를 만들지 못했습니다: ' + errMessage(e)))
        return
      }
      this.#worker = worker
      this.#workerReady = false
      this.#workerFailed = false

      worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const msg = e.data
        if (msg.type === 'ready') {
          this.#workerReady = true
          for (const m of this.#queue) worker.postMessage(m)
          this.#queue = []
          done()
          return
        }
        if (msg.type === 'init_error') {
          this.#failWorker('워커 초기화 실패: ' + (msg.message ?? ''))
          done(new Error(msg.message ?? 'worker init error'))
          return
        }
        this.#handleWorkerMessage(msg)
      }

      worker.onerror = (err: ErrorEvent) => {
        this.#failWorker('워커 오류: ' + (err.message || 'unknown'))
        done(new Error(err.message || 'worker error'))
      }

      timer = setTimeout(() => {
        this.#failWorker('워커 초기화 시간 초과')
        done(new Error('worker init timeout'))
      }, WORKER_INIT_TIMEOUT)
    })
  }

  /** 메인 스레드 폴백 — CDN 에서 jq-web 을 받아 `window.jq` 를 쓴다. */
  async #initMainThread(): Promise<void> {
    // Emscripten 로그를 삼키고 wasm 경로를 CDN 절대 URL 로 고정한다
    const g = window as unknown as { Module?: Record<string, unknown> }
    g.Module = {
      ...(g.Module ?? {}),
      print: () => {},
      printErr: () => {},
      locateFile: (f: string) => JQ_CDN_BASE + f,
    }
    await loadScript(JQ_CDN_JS)
    if (typeof window.jq === 'undefined') {
      throw new Error('jq-web 을 불러오지 못했습니다')
    }
    // jq-web 0.5.x 는 `window.jq.promised`, 0.6.x 는 `window.jq` 자체가 Promise 다
    this.#instance = await (window.jq.promised ?? window.jq)
  }

  #failWorker(reason: string): void {
    this.#workerFailed = true
    this.#workerReady = false
    this.lastError = reason
    for (const [, pending] of this.#pending) pending.reject(new Error(reason))
    this.#pending.clear()
    this.#queue = []
  }

  #handleWorkerMessage(msg: WorkerMessage): void {
    const pending = msg.id === undefined ? undefined : this.#pending.get(msg.id)
    if (!pending || msg.id === undefined) return // 이미 교체된 요청의 응답 → 무시
    this.#pending.delete(msg.id)

    if (msg.type === 'result') {
      // 워커는 결과를 Transferable ArrayBuffer 로 돌려준다
      let resultText: string
      if (msg.resultBuffer !== undefined) {
        resultText =
          msg.resultBuffer.byteLength > 0
            ? new TextDecoder().decode(new Uint8Array(msg.resultBuffer))
            : '[]'
      } else {
        resultText = msg.resultText || '[]'
      }
      pending.resolve({ resultText, executionTime: msg.executionTime ?? 0 })
    } else if (msg.type === 'formatted') {
      if (msg.error) pending.reject(new Error(msg.error))
      else
        pending.resolve({
          format: msg.format ?? 'json',
          resultText: msg.resultText,
          header: msg.header,
          rows: msg.rows,
        })
    } else if (msg.type === 'error') {
      pending.reject(new Error(msg.message ?? 'jq 실행 오류'))
    }
  }

  /**
   * jq 쿼리 실행. 워커가 살아 있으면 워커로, 아니면 메인 스레드로.
   * `cache: false` 는 자동완성 컨텍스트처럼 "본 실행의 결과가 아닌" 실행이다 — 워커가 마지막 결과로
   * 기억하지 않아야 이후 포맷 전환(`formatResult`)이 엉뚱한 결과를 바꾸지 않는다.
   */
  async execute(input: string, query: string, opts: { cache?: boolean } = {}): Promise<ExecuteResult> {
    if (this.#worker && !this.#workerFailed) return this.#executeInWorker(input, query, opts.cache !== false)
    await this.#ensureMainThread()
    return this.#executeMainThread(input, query)
  }

  #mainInit: Promise<void> | null = null

  /**
   * 초기화가 끝난 뒤 워커가 죽었거나(런타임 오류) 종료된 경우의 폴백. `init()` 은 이미 성공으로
   * 끝난 약속을 캐시하고 있어 다시 돌지 않으므로, 메인 스레드 인스턴스가 없으면 여기서 올린다.
   */
  #ensureMainThread(): Promise<void> {
    if (this.#instance) return Promise.resolve()
    if (this.#worker) {
      terminateJqWorker(this.#worker)
      this.#worker = null
    }
    this.#mainInit ??= this.#initMainThread().catch((e: unknown) => {
      this.#mainInit = null
      throw e
    })
    return this.#mainInit
  }

  /** 입력이 바뀐 경우에만 워커로 보낸다(2MB+ 재전송 방지) */
  #sendInputIfChanged(input: string): void {
    if (input === this.#lastSentInput) return
    this.#lastSentInput = input
    this.#post({ type: 'setInput', input })
  }

  #post(msg: object): void {
    if (this.#workerReady && this.#worker) this.#worker.postMessage(msg)
    else this.#queue.push(msg)
  }

  #executeInWorker(input: string, query: string, cache: boolean): Promise<ExecuteResult> {
    this.#sendInputIfChanged(input)
    return new Promise<ExecuteResult>((resolve, reject) => {
      const id = ++this.#requestId
      this.#pending.set(id, { resolve: resolve as Pending['resolve'], reject })
      this.#post({ type: 'execute', id, query, cache })
    })
  }

  /** 워커에 캐싱된 마지막 결과를 요청한 포맷으로 다시 만든다. */
  formatResult(format: 'json' | 'csv'): Promise<FormatResult> {
    if (!this.#worker || this.#workerFailed) {
      return Promise.reject(new Error('워커를 쓸 수 없습니다'))
    }
    return new Promise<FormatResult>((resolve, reject) => {
      const id = ++this.#requestId
      this.#pending.set(id, { resolve: resolve as Pending['resolve'], reject })
      this.#post({ type: 'formatResult', id, format })
    })
  }

  async #executeMainThread(input: string, query: string): Promise<ExecuteResult> {
    if (!this.#instance) throw new Error('jq 엔진이 준비되지 않았습니다')
    const startTime = performance.now()
    try {
      const parsedInput = JSON.parse(input)
      const result = await this.#instance.json(parsedInput, query)
      return {
        result,
        resultText: JSON.stringify(result, null, 2),
        executionTime: performance.now() - startTime,
      }
    } catch (error) {
      const executionTime = performance.now() - startTime
      // jq-web 은 출력이 비면 "Unexpected end of JSON input" 을 던진다
      if (errMessage(error).includes('Unexpected end of JSON input')) {
        return { result: [], resultText: '[]', executionTime }
      }
      throw error
    }
  }

  /** 워커 종료. 모드가 파괴될 때 호출한다. */
  terminate(): void {
    if (this.#worker) {
      terminateJqWorker(this.#worker)
      this.#worker = null
      this.#workerReady = false
    }
    this.#lastSentInput = null
    for (const [, pending] of this.#pending) pending.reject(new Error('jq 엔진이 종료되었습니다'))
    this.#pending.clear()
    this.#queue = []
  }

  /**
   * 부분 쿼리를 실행해 커서 위치의 값 타입과 키 목록을 추론한다(자동완성용).
   * 가드가 워커까지 보므로 워커 전용 모드에서도 동작한다.
   */
  async executeForContext(input: string, partialQuery: string, maxDepth = 8): Promise<ContextResult> {
    if (!this.usable) throw new Error('jq 엔진이 준비되지 않았습니다')

    try {
      const execResult = await this.execute(input, partialQuery, { cache: false })
      // 워커 경로는 resultText 만, 메인 스레드는 result 도 돌려준다
      const result =
        execResult.result !== undefined ? execResult.result : JSON.parse(execResult.resultText)

      if (Array.isArray(result)) {
        if (result.length > 0 && typeof result[0] === 'object') {
          const keys = new Set<string>()
          const sampleSize = Math.min(result.length, 5)
          for (let i = 0; i < sampleSize; i++) {
            this.#extractKeysDeep(result[i], '', 0, maxDepth, keys)
          }
          return { type: 'array', keys: Array.from(keys) }
        }
        return { type: 'array', keys: [] }
      }
      if (typeof result === 'object' && result !== null) {
        const keys = new Set<string>()
        this.#extractKeysDeep(result, '', 0, maxDepth, keys)
        return { type: 'object', keys: Array.from(keys) }
      }
      return { type: typeof result as ContextResult['type'], keys: [] }
    } catch {
      return { type: 'any', keys: [] }
    }
  }

  #extractKeysDeep(
    obj: unknown,
    path: string,
    depth: number,
    maxDepth: number,
    keys: Set<string>,
  ): void {
    if (depth > maxDepth || obj === null || obj === undefined) return

    if (Array.isArray(obj)) {
      const sampleSize = Math.min(obj.length, 5)
      for (let i = 0; i < sampleSize; i++) {
        this.#extractKeysDeep(obj[i], path + '[]', depth, maxDepth, keys)
      }
    } else if (typeof obj === 'object') {
      const rec = obj as Record<string, unknown>
      for (const key of Object.keys(rec)) {
        const newPath = path ? `${path}.${key}` : key
        keys.add(newPath)
        this.#extractKeysDeep(rec[key], newPath, depth + 1, maxDepth, keys)
      }
    }
  }

  /** 컨텍스트 추론에 제한 시간을 건다 — 무거운 쿼리가 자동완성을 막지 않게. */
  async executeForContextWithTimeout(
    input: string,
    partialQuery: string,
    timeout = 2000,
  ): Promise<ContextResult> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        this.executeForContext(input, partialQuery),
        new Promise<ContextResult>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Context execution timeout')), timeout)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
}

export const jqEngine = new JqEngine()
