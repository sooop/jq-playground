/**
 * 자동완성 엔진 — 후보 계산·캐시·Tab 순환·팝업 위치를 한곳에서 관리한다.
 *
 * 렌더링 방식만 Svelte 로 바뀌었고 판단 순서는 원본(`QueryPanel.ts:1104-1377`)과 같다.
 *  ① `$변수` 완성  ② 필드 완성(캐시 → 동기 추출 → 워커 → 컨텍스트 쿼리)  ③ 함수 완성
 *
 * 취소 가드: `#updateId` 를 await 전후로 비교해 늦게 도착한 결과가 최신 화면을 덮지 않게 한다.
 */
import { AutocompleteCache } from '../utils/autocomplete-cache'
import { PipeAnalyzer } from '../utils/pipe-analyzer'
import { jqEngine } from '../core/jq-engine'
import {
  createKeyExtractionWorker,
  extractKeys,
  filterFunctions,
  terminateKeyExtractionWorker,
} from '../core/jq-functions'
import type { BlobWorker } from '../core/jq-functions'
import { getCaretCoordinates } from './caret'
import {
  applyItem,
  atLineIndent,
  filterAndSortKeys,
  getCurrentWord,
  getFallbackContextQuery,
  getFieldAccessContext,
  toJqFieldPath,
  type AcItem,
} from './word'

const WORKER_IDLE_TIMEOUT = 30_000
const UPDATE_DEBOUNCE_DELAY = 300
const SYNC_EXTRACT_LIMIT = 500 * 1024
const CONTEXT_TIMEOUT = 2000
/** 이만큼 마우스를 움직이면 hover 잠금을 푼다 — 키보드로 연 목록이 커서 밑에서 튀지 않게 */
const MOVEMENT_THRESHOLD = 5

export interface AcHost {
  /** 쿼리 textarea. 없으면(미마운트) 자동완성은 아무것도 하지 않는다. */
  el(): HTMLTextAreaElement | null
  /** 현재 입력 JSON 텍스트 */
  inputText(): string
  /** 쿼리 텍스트가 바뀌었음을 알린다(상태 반영 + 실행 디바운스 트리거) */
  setQuery(text: string, cursor: number): void
}

interface Pending {
  resolve: (v: { keys: string[] }) => void
  reject: (e: Error) => void
}

export class AutocompleteEngine {
  items = $state.raw<AcItem[]>([])
  selected = $state(-1)
  open = $state(false)
  /** 팝업 위치(뷰포트 고정 좌표) */
  pos = $state({ top: 0, left: 0, maxHeight: 200 })
  /** 키보드로 연 직후에는 마우스 hover 를 무시한다 */
  hoverLocked = $state(false)

  #host: AcHost
  #cache = new AutocompleteCache({ maxContextEntries: 100, contextTTL: 60_000 })

  // Tab 순환(zsh menu completion) 상태
  #originalWord: string | null = null
  #tabWordStart = 0

  // 키 추출 워커
  #worker: BlobWorker | null = null
  #pendingId = 0
  #pending = new Map<number, Pending>()
  #workerIdle: ReturnType<typeof setTimeout> | null = null
  #lastInputHash: string | null = null
  /** 워커에 전체 추출을 요청했거나 끝낸 입력의 해시 — 요청이 취소돼도 다시 시도할 수 있게 `#lastInputHash` 와 따로 둔다 */
  #requestedHash: string | null = null
  /** 사용자가 직접 닫은 뒤 새 입력·클릭(update)이 오기 전까지 true — 늦게 끝난 워커 추출이 팝업을 되살리지 않게 한다 */
  #closedByUser = false
  #debounce: ReturnType<typeof setTimeout> | null = null
  #updateId = 0

  // hover 잠금 해제용 마우스 감시
  #mouseHandler: ((e: MouseEvent) => void) | null = null
  #mouseStart: { x: number; y: number } | null = null

  constructor(host: AcHost) {
    this.#host = host
  }

  // ── 워커 ───────────────────────────────────────────────────────────────────

  #initWorker(): void {
    if (!this.#worker) {
      try {
        this.#worker = createKeyExtractionWorker()
        this.#worker.onmessage = (e: MessageEvent) => this.#onWorkerMessage(e)
        this.#worker.onerror = () => this.terminateWorker()
      } catch {
        this.#worker = null
      }
    }
    this.#resetIdle()
  }

  #resetIdle(): void {
    if (this.#workerIdle) clearTimeout(this.#workerIdle)
    this.#workerIdle = setTimeout(() => this.terminateWorker(), WORKER_IDLE_TIMEOUT)
  }

  terminateWorker(): void {
    if (this.#worker) {
      terminateKeyExtractionWorker(this.#worker)
      this.#worker = null
    }
    // 기다리는 요청이 영원히 멈춰 있지 않도록 실패로 끝낸다
    for (const [, p] of this.#pending) p.reject(new Error('key extraction worker terminated'))
    this.#pending.clear()
    if (this.#workerIdle) {
      clearTimeout(this.#workerIdle)
      this.#workerIdle = null
    }
  }

  #onWorkerMessage(e: MessageEvent): void {
    const { type, id, keys, message } = e.data as {
      type: string
      id: number
      keys?: string[]
      message?: string
    }
    const pending = this.#pending.get(id)
    if (!pending) return
    this.#resetIdle()

    if (type === 'result') {
      pending.resolve({ keys: keys ?? [] })
      this.#pending.delete(id)
    } else if (type === 'error') {
      pending.reject(new Error(message ?? 'key extraction failed'))
      this.#pending.delete(id)
    }
    // 'progress' 는 키 개수만 알려 준다 — 최종 result 에서 한 번에 처리한다
  }

  #requestKeys(jsonString: string): Promise<{ keys: string[] }> {
    return new Promise((resolve, reject) => {
      this.#initWorker()
      if (!this.#worker) {
        try {
          resolve({ keys: extractKeys(JSON.parse(jsonString), 8) })
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
        return
      }
      const id = ++this.#pendingId
      this.#pending.set(id, { resolve, reject })
      this.#worker.postMessage({
        type: 'extract',
        id,
        jsonString,
        options: { maxDepth: 8, sampleSize: 5 },
      })
    })
  }

  // ── 캐시 ───────────────────────────────────────────────────────────────────

  invalidate(): void {
    this.#cache.invalidate()
    this.#lastInputHash = null
    this.#requestedHash = null
  }

  /** 쿼리 입력마다 컨텍스트 캐시를 현재 파이프 것만 남기고 비운다 */
  trimContextCache(text: string, cursor: number): void {
    const analysis = PipeAnalyzer.analyze(text, cursor)
    if (!analysis.completedQuery) return
    const cur = this.#cache.getContextKeys(analysis.completedQuery)
    this.#cache.invalidateContext()
    if (cur) this.#cache.setContextKeys(analysis.completedQuery, cur.keys, cur.type)
  }

  // ── 표시 ───────────────────────────────────────────────────────────────────

  /** 바깥에서 닫는 경로(Esc·blur·적용·실행) — 진행 중인 update() 가 닫힌 뒤 팝업을 되살리지 못하게 무효화한다 */
  hide(): void {
    this.#updateId++
    this.#closedByUser = true
    this.#dismiss()
  }

  /** update() 안에서 "보여 줄 것이 없다"는 뜻으로 닫는다 — 뒤이은 갱신을 막지 않는다 */
  #dismiss(): void {
    this.open = false
    this.items = []
    this.selected = -1
    this.#originalWord = null
    this.#tabWordStart = 0
    this.#unlockHover()
  }

  #show(items: AcItem[]): void {
    this.items = items
    this.selected = -1
    this.#originalWord = null
    this.#tabWordStart = 0
    this.open = true
    this.reposition()
    this.#lockHover()
  }

  /** 캐럿 기준으로 팝업을 배치한다. 아래 공간이 모자라면 위로 뒤집는다. */
  reposition(): void {
    const ta = this.#host.el()
    if (!ta) return
    const caret = getCaretCoordinates(ta, ta.selectionStart)
    const listW = 320
    const listH = 200
    const vw = window.innerWidth
    const vh = window.innerHeight

    let top = caret.y + caret.lineHeight
    let maxHeight = vh - top - 8

    if (top + listH > vh - 8) {
      top = caret.y - listH
      maxHeight = caret.y - 8
      if (top < 4) {
        top = 4
        maxHeight = vh - 8
      }
    }

    let left = caret.x
    if (left + listW > vw - 8) left = vw - listW - 8
    if (left < 4) left = 4

    this.pos = { top, left, maxHeight: Math.max(maxHeight, 80) }
  }

  #lockHover(): void {
    this.#unlockHover()
    this.hoverLocked = true
    const capture = (e: MouseEvent): void => {
      this.#mouseStart = { x: e.clientX, y: e.clientY }
    }
    document.addEventListener('mousemove', capture, { once: true })

    this.#mouseHandler = (e: MouseEvent) => {
      if (!this.hoverLocked || !this.#mouseStart) return
      const dx = Math.abs(e.clientX - this.#mouseStart.x)
      const dy = Math.abs(e.clientY - this.#mouseStart.y)
      if (Math.sqrt(dx * dx + dy * dy) > MOVEMENT_THRESHOLD) this.#unlockHover()
    }
    document.addEventListener('mousemove', this.#mouseHandler)
  }

  #unlockHover(): void {
    this.hoverLocked = false
    if (this.#mouseHandler) {
      document.removeEventListener('mousemove', this.#mouseHandler)
      this.#mouseHandler = null
    }
    this.#mouseStart = null
  }

  /** 마우스로 항목을 짚었을 때(hover 잠금이 풀린 뒤에만 먹는다) */
  hoverItem(i: number): void {
    if (this.hoverLocked) return
    this.selected = i
  }

  hoverOut(): void {
    if (!this.hoverLocked) this.selected = -1
  }

  // ── 후보 계산 ──────────────────────────────────────────────────────────────

  async update(): Promise<void> {
    const ta = this.#host.el()
    if (!ta) return
    const updateId = ++this.#updateId
    this.#closedByUser = false
    const text = ta.value
    const cursor = ta.selectionStart
    const { word, isFieldAccess, isCursorAtWordEnd } = getCurrentWord(text, cursor)

    // 커서가 단어 중간이면 띄우지 않는다
    if (!isCursorAtWordEnd && word.length > 0) {
      this.#dismiss()
      return
    }

    // ① `$변수`
    if (word.startsWith('$')) {
      const variables = PipeAnalyzer.extractVariables(text, cursor)
      const term = word.substring(1).toLowerCase()
      const matches: AcItem[] = variables
        .filter((v) => v.substring(1).toLowerCase().startsWith(term))
        .map((v) => ({
          name: v,
          desc:
            v === '$ENV' ? 'Environment variables' : v === '$__loc__' ? 'Source location' : 'User variable',
          inputType: 'variable',
        }))

      if (matches.length === 0) {
        this.#dismiss()
        return
      }
      if (matches.length === 1 && matches[0]!.name.toLowerCase() === word.toLowerCase()) {
        this.#dismiss()
        return
      }
      this.#show(matches)
      return
    }

    const pre = PipeAnalyzer.analyze(text, cursor)
    const needsField =
      isFieldAccess || (pre.isInsideObjectConstruction && (pre.isShorthandPosition || pre.isAfterColon))
    const inputData = this.#host.inputText()

    // ② 필드 완성
    if (needsField && inputData) {
      let searchTerm: string
      let hasPrefix: boolean
      let prefix: string

      if (pre.isInsideObjectConstruction && pre.isShorthandPosition) {
        searchTerm = pre.incompleteField || ''
        hasPrefix = false
        prefix = ''
      } else {
        const fieldCtx = getFieldAccessContext(text, cursor)
        hasPrefix = fieldCtx.hasPrefix
        prefix = fieldCtx.prefix
        searchTerm = fieldCtx.currentSegment || word
      }

      const inputHash = AutocompleteCache.hashInput(inputData)
      let contextKeys: string[] = []
      let inputKeys: string[] = []

      const hashChanged = this.#lastInputHash !== inputHash
      if (hashChanged) {
        this.#lastInputHash = inputHash
        this.#cache.invalidate()
      }

      // 1) 캐시가 있으면 먼저 보여 준다(3단 렌더의 1단)
      const cached = this.#cache.getInputKeys(inputHash)
      if (cached) {
        inputKeys = cached.keys
        if (inputKeys.length > 0) this.#renderFields(inputKeys, [], searchTerm, hasPrefix, prefix)
      } else if (inputData.length <= SYNC_EXTRACT_LIMIT) {
        // 2) 소용량이면 동기 추출로 즉시(2단)
        try {
          inputKeys = extractKeys(JSON.parse(inputData), 8)
          if (inputKeys.length > 0) {
            this.#cache.setInputKeys(inputKeys, inputHash, false)
            this.#renderFields(inputKeys, [], searchTerm, hasPrefix, prefix)
          }
        } catch {
          /* 유효하지 않은 JSON — 워커/컨텍스트 경로로 */
        }
      }

      // 3) 이 입력을 아직 워커로 추출하지 않았다면 전체 추출(3단).
      //    이후 키 입력이 update() 를 다시 불러도 이 요청은 버리지 않는다 — 결과는 캐시에 넣고,
      //    팝업은 그때의 커서 기준으로 다시 그린다. (예전에는 300ms 안의 다음 키 입력이 콜백을
      //    폐기하고 해시는 이미 '처리됨'이라 대용량 입력의 필드 후보가 영영 안 나왔다.)
      if (this.#requestedHash !== inputHash) {
        this.#requestedHash = inputHash
        if (this.#debounce) clearTimeout(this.#debounce)
        this.#debounce = setTimeout(async () => {
          try {
            const result = await this.#requestKeys(inputData)
            // 그 사이 입력이 바뀌었으면 이 키는 쓸모없다
            if (this.#lastInputHash !== inputHash) return
            this.#cache.setInputKeys(result.keys, inputHash, false)
            const el = this.#host.el()
            if (!el || document.activeElement !== el || this.#closedByUser) return
            const cur = getCurrentWord(el.value, el.selectionStart)
            if (!cur.isFieldAccess) return
            const ctx2 = getFieldAccessContext(el.value, el.selectionStart)
            this.#renderFields(
              [...new Set([...result.keys, ...contextKeys])],
              contextKeys,
              ctx2.currentSegment || cur.word,
              ctx2.hasPrefix,
              ctx2.prefix,
            )
          } catch {
            // 워커 실패는 조용히 — 이미 동기/캐시 결과가 떠 있다. 다음 update 에서 다시 시도한다.
            if (this.#requestedHash === inputHash) this.#requestedHash = null
          }
        }, UPDATE_DEBOUNCE_DELAY)
      }

      // 4) 컨텍스트 쿼리 실행(파이프 앞부분의 실제 결과에서 키를 뽑는다)
      let contextQuery = pre.effectiveContextQuery || pre.completedQuery
      if (!contextQuery && pre.isInsideFunction && pre.isInsideObjectConstruction) {
        contextQuery = getFallbackContextQuery(pre, inputData)
      }
      // 단일 세그먼트 `.field` 도 `. | .field` 와 같게 다룬다
      if (!contextQuery && isFieldAccess) {
        const fc = getFieldAccessContext(text, cursor)
        contextQuery = fc.hasPrefix && fc.prefix ? '.' + fc.prefix : '.'
      }

      if (contextQuery) {
        const cachedCtx = this.#cache.getContextKeys(contextQuery)
        if (cachedCtx) {
          contextKeys = cachedCtx.keys
        } else {
          try {
            const ctxResult = await jqEngine.executeForContextWithTimeout(
              inputData,
              contextQuery,
              CONTEXT_TIMEOUT,
            )
            if (updateId !== this.#updateId) return
            contextKeys = ctxResult.keys ?? []
            this.#cache.setContextKeys(contextQuery, contextKeys, ctxResult.type)
          } catch {
            contextKeys = []
          }
        }
      }

      // 5) 객체 생성/함수 문맥에 맞춰 검색어를 다시 잡는다
      let term = searchTerm
      let pfx = prefix
      let hasPfx = hasPrefix

      if (pre.isInsideObjectConstruction) {
        if (pre.isShorthandPosition || pre.isAfterColon) {
          term = pre.incompleteField || ''
          hasPfx = false
          pfx = ''
        }
      } else if (pre.isInsideFunction && pre.fieldPath) {
        const fieldPath = pre.fieldPath.replace(/^\./, '')
        const lastDot = fieldPath.lastIndexOf('.')
        if (lastDot === -1) {
          term = fieldPath
          hasPfx = false
          pfx = ''
        } else {
          pfx = fieldPath.substring(0, lastDot)
          term = fieldPath.substring(lastDot + 1)
          hasPfx = true
        }
      }

      // 컨텍스트 쿼리를 기다리는 사이 워커 추출이 끝났을 수 있다 — 캐시의 최신 키를 다시 읽는다
      // (읽지 않으면 대용량 입력에서 컨텍스트가 타임아웃될 때 빈 inputKeys 로 팝업을 닫아 버린다)
      inputKeys = this.#cache.getInputKeys(inputHash)?.keys ?? inputKeys
      const allKeys = contextKeys.length > 0 ? [...new Set([...contextKeys, ...inputKeys])] : inputKeys

      if (updateId !== this.#updateId) return
      if (allKeys.length > 0) this.#renderFields(allKeys, contextKeys, term, hasPfx, pfx)
      else this.#dismiss()
      return
    }

    // 입력이 없는데 필드 접근이면 띄울 것이 없다
    if (needsField && !inputData && isFieldAccess) {
      this.#dismiss()
      return
    }

    // ③ 함수 완성
    if (word.length < 1) {
      this.#dismiss()
      return
    }
    const matches = filterFunctions(word)
    if (matches.length === 0) {
      this.#dismiss()
      return
    }
    if (matches.length === 1 && matches[0]!.name.toLowerCase() === word.toLowerCase()) {
      this.#dismiss()
      return
    }
    if (updateId !== this.#updateId) return
    this.#show(matches)
  }

  #renderFields(
    keys: string[],
    contextKeys: string[],
    searchTerm: string,
    hasPrefix: boolean,
    prefix: string,
  ): void {
    const matches = filterAndSortKeys(keys, contextKeys, searchTerm, hasPrefix, prefix)
    if (matches.length === 0) {
      this.#dismiss()
      return
    }
    // 정확히 하나가 완전히 일치하면 더 보여 줄 것이 없다
    if (matches.length === 1 && matches[0]!.name.toLowerCase() === searchTerm.toLowerCase()) {
      this.#dismiss()
      return
    }
    this.#show(matches)
  }

  // ── 적용 ───────────────────────────────────────────────────────────────────

  /** 후보를 확정 적용하고 팝업을 닫는다 */
  apply(item: AcItem): void {
    const ta = this.#host.el()
    if (!ta) return
    const { start, end } = getCurrentWord(ta.value, ta.selectionStart)
    const next = applyItem(ta.value, item, start, end)
    this.hide()
    this.#host.setQuery(next.text, next.cursor)
  }

  /**
   * Tab 순환 중의 즉시 교체 — 팝업은 열어 둔다(함수는 괄호 없이 이름만 넣는다).
   * 앞의 `.` 을 지우지 않으므로 교체 구간은 항상 `#tabWordStart..cursor` 로 고정된다.
   */
  #applyInPlace(item: AcItem): void {
    const ta = this.#host.el()
    if (!ta) return
    const text = ta.value
    const cursor = ta.selectionStart
    const start = this.#tabWordStart
    const insert =
      item.inputType === 'field' && text[start - 1] === '.' ? toJqFieldPath(item.name) : item.name
    this.#host.setQuery(text.substring(0, start) + insert + text.substring(cursor), start + insert.length)
  }

  /**
   * 팝업이 열려 있을 때의 키 처리. 처리했으면 true(호출부가 preventDefault 한다).
   */
  handleKeydown(e: KeyboardEvent): boolean {
    if (!this.open) {
      // 아직 열리기 전(추출·컨텍스트 대기 중)에 누른 Esc 도 "안 띄운다"는 뜻이다. 다른 Esc 처리는 막지 않는다.
      if (e.key === 'Escape') {
        this.#updateId++
        this.#closedByUser = true
      }
      return false
    }
    const ta = this.#host.el()
    if (!ta) return false

    if (e.key === 'ArrowDown') {
      this.selected = Math.min(this.selected + 1, this.items.length - 1)
      return true
    }
    if (e.key === 'ArrowUp') {
      this.selected = Math.max(this.selected - 1, -1)
      return true
    }
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
      // 닫지 않고 커서 이동 뒤 다시 필터링한다
      setTimeout(() => void this.update(), 0)
      return false
    }
    if (e.key === 'Tab' && this.items.length > 0) {
      // 줄 시작이면 Tab 은 들여쓰기다
      if (atLineIndent(ta.value, ta.selectionStart)) {
        const start = ta.selectionStart
        const end = ta.selectionEnd
        const next = ta.value.substring(0, start) + '  ' + ta.value.substring(end)
        this.#host.setQuery(next, start + 2)
        void this.update()
        return true
      }
      if (this.#originalWord === null) {
        const info = getCurrentWord(ta.value, ta.selectionStart)
        this.#originalWord = info.word
        this.#tabWordStart = info.start
        this.selected = e.shiftKey ? this.items.length - 1 : 0
      } else if (e.shiftKey) {
        this.selected = this.selected <= 0 ? this.items.length - 1 : this.selected - 1
      } else {
        this.selected = (this.selected + 1) % this.items.length
      }
      this.#applyInPlace(this.items[this.selected]!)
      return true
    }
    if (e.key === 'Enter' && this.selected >= 0) {
      // Tab 순환 중이면 후보가 이미 들어가 있다 — 다시 넣으면 `["a-b"]` 뒤에 이름이 한 번 더 붙는다
      if (this.#originalWord !== null) {
        this.hide()
        return true
      }
      this.apply(this.items[this.selected]!)
      return true
    }
    if (e.key === 'Escape') {
      if (this.#originalWord !== null) {
        // Tab 순환 중이었으면 원래 단어로 되돌린다
        const text = ta.value
        const cursor = ta.selectionStart
        const restored =
          text.substring(0, this.#tabWordStart) + this.#originalWord + text.substring(cursor)
        const at = this.#tabWordStart + this.#originalWord.length
        this.hide()
        this.#host.setQuery(restored, at)
      } else {
        this.hide()
      }
      return true
    }
    return false
  }

  dispose(): void {
    this.terminateWorker()
    if (this.#debounce) clearTimeout(this.#debounce)
    this.#unlockHover()
  }
}
