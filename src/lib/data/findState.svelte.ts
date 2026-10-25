import type { Dataset } from './dataset.svelte'
import { buildHitSet, hitKey, runFind, stepIndex, type FindHit, type FindSpec } from './find'
import type { SelectionStore } from './selection.svelte'
import { load, save } from '../util/storage'
import type { View } from './view.svelte'

/**
 * 찾기 상태.
 *
 * 패널(입력·목록)과 그리드(셀 강조)가 **같은 결과**를 봐야 하므로 상태를 여기 모았다.
 * 각자 계산하면 스캔이 두 번 돌고, 커서가 어긋날 수 있다.
 */
export class FindStore {
  open = $state(false)

  /** 디바운스가 적용되기 전 입력값 (패널이 씀) */
  raw = $state('')
  /** 실제 검색에 쓰이는 값 */
  query = $state('')

  regex = $state<boolean>(false)
  caseSensitive = $state<boolean>(false)
  wholeCell = $state<boolean>(false)
  /** 선택 영역 안에서만 찾기 */
  inSelection = $state(false)

  /** 현재 매치 인덱스 (-1이면 없음) */
  cursor = $state(-1)

  /** localStorage 키 접두 — 모드마다 달라야 토글 상태가 서로 전이되지 않는다 */
  readonly #keyPrefix: string

  constructor(
    private readonly ds: Dataset,
    private readonly view: View,
    private readonly sel: SelectionStore,
    keyPrefix = '',
  ) {
    this.#keyPrefix = keyPrefix
    this.regex = load(keyPrefix + 'findRegex', false)
    this.caseSensitive = load(keyPrefix + 'findCase', false)
    this.wholeCell = load(keyPrefix + 'findWhole', false)
  }

  spec = $derived<FindSpec>({
    query: this.query,
    regex: this.regex,
    caseSensitive: this.caseSensitive,
    wholeCell: this.wholeCell,
  })

  /**
   * 선택 영역이 2셀 이상일 때만 범위 제한이 의미가 있다.
   * `$derived.by`로 감싸는 이유: 생성자 파라미터 프로퍼티(`sel`)는 필드 초기화 이후에
   * 대입되므로, 즉시 평가처럼 보이는 `$derived(...)` 형태는 타입 검사에서 걸린다.
   */
  selectionUsable = $derived.by(() => this.sel.ranges.length > 0 && this.sel.cellCount > 1)

  bounds = $derived.by(() => {
    if (!this.inSelection || !this.selectionUsable) return undefined
    let r0 = Infinity
    let r1 = -Infinity
    let c0 = Infinity
    let c1 = -Infinity
    for (const rg of this.sel.ranges) {
      r0 = Math.min(r0, rg.r0)
      r1 = Math.max(r1, rg.r1)
      c0 = Math.min(c0, rg.c0)
      c1 = Math.max(c1, rg.c1)
    }
    return { r0, r1, c0, c1 }
  })

  result = $derived.by(() => {
    if (!this.open) return { hits: [] as FindHit[], truncated: false, error: null }
    void this.ds.version
    return runFind(this.ds, this.view, this.spec, this.bounds)
  })

  get hits(): FindHit[] {
    return this.result.hits
  }
  get error(): string | null {
    return this.result.error
  }
  get truncated(): boolean {
    return this.result.truncated
  }

  /** 그리드가 "이 셀이 매치인가"를 O(1)로 묻기 위한 집합 */
  hitSet = $derived(buildHitSet(this.result.hits))

  current = $derived<FindHit | null>(
    this.cursor >= 0 ? (this.result.hits[this.cursor] ?? null) : null,
  )

  /** 셀이 매치인지 (뷰 좌표) */
  isHit(r: number, c: number): boolean {
    return this.hitSet.has(hitKey(r, c))
  }

  /** 이 셀이 지금 커서가 가리키는 매치인지 */
  isCurrent(r: number, c: number): boolean {
    const h = this.current
    return h !== null && h.r === r && h.c === c
  }

  /** 활성 셀 바로 다음(또는 이전) 매치로 커서를 맞춘다 */
  resetCursorNearActive(dir: 1 | -1 = 1): void {
    const hits = this.result.hits
    this.cursor =
      hits.length === 0
        ? -1
        : stepIndex(hits, { r: this.sel.active.r, c: this.sel.active.c - 1 }, dir)
  }

  step(dir: 1 | -1): FindHit | null {
    const hits = this.result.hits
    if (hits.length === 0) {
      this.cursor = -1
      return null
    }
    if (this.cursor < 0) this.resetCursorNearActive(dir)
    else this.cursor = (this.cursor + dir + hits.length) % hits.length
    return this.current
  }

  setCursor(i: number): FindHit | null {
    this.cursor = i
    return this.current
  }

  toggleRegex(): void {
    this.regex = !this.regex
    save(this.#keyPrefix + 'findRegex', this.regex)
  }
  toggleCase(): void {
    this.caseSensitive = !this.caseSensitive
    save(this.#keyPrefix + 'findCase', this.caseSensitive)
  }
  toggleWhole(): void {
    this.wholeCell = !this.wholeCell
    save(this.#keyPrefix + 'findWhole', this.wholeCell)
  }

  reset(): void {
    this.raw = ''
    this.query = ''
    this.cursor = -1
    this.inSelection = false
  }
}
