import { invert, type Dataset } from './dataset.svelte'
import type { Op, Selection } from './types'

/** 스택에 쌓는 항목 — 연산과 그 직전 선택 상태. */
interface Entry {
  op: Op
  /** op 적용 직전의 선택 — undo 후 사용자가 있던 자리로 되돌린다 */
  selBefore: Selection | null
  /** op 적용 직후의 선택 — redo 후 복원 */
  selAfter: Selection | null
  /** 대략적인 메모리 비용(문자 수) — 스택 용량 관리에 쓴다 */
  cost: number
}

const MAX_ENTRIES = 200
/** 스택 전체가 보관할 문자 수 상한. 대량 붙여넣기가 메모리를 잡아먹는 것을 막는다. */
const MAX_COST = 40_000_000

/**
 * Undo/Redo 스택.
 *
 * 모든 데이터 변경은 {@link push}를 통과하고, 되돌리기는 {@link invert}로 만든 역연산을
 * 다시 `dataset.apply()`에 넣는 식으로 처리한다 — 스냅샷을 뜨지 않으므로 10만 행에서도
 * 메모리·시간 비용이 변경량에 비례한다.
 */
export class History {
  #undo: Entry[] = $state.raw([])
  #redo: Entry[] = $state.raw([])
  #cost = 0

  constructor(private readonly ds: Dataset) {}

  get canUndo(): boolean {
    return this.#undo.length > 0
  }
  get canRedo(): boolean {
    return this.#redo.length > 0
  }
  get undoDepth(): number {
    return this.#undo.length
  }

  clear(): void {
    this.#undo = []
    this.#redo = []
    this.#cost = 0
  }

  /**
   * 연산을 적용하고 스택에 기록한다.
   * @returns 구조 변경 여부 — 호출부가 선택 해제/파생 재계산을 결정한다
   */
  push(op: Op, selBefore: Selection | null, selAfter: Selection | null): { structural: boolean } {
    const res = this.ds.apply(op)
    const cost = opCost(op)
    this.#undo = [...this.#undo, { op, selBefore, selAfter, cost }]
    this.#cost += cost
    this.#redo = [] // 새 편집이 들어오면 redo 분기는 버린다
    this.#trim()
    return res
  }

  /** @returns 복원할 선택 상태 (없으면 null) */
  undo(): { selection: Selection | null; structural: boolean } | null {
    const entry = this.#undo.at(-1)
    if (!entry) return null
    this.#undo = this.#undo.slice(0, -1)
    this.#cost -= entry.cost
    const res = this.ds.apply(invert(entry.op))
    this.#redo = [...this.#redo, entry]
    return { selection: entry.selBefore, structural: res.structural }
  }

  redo(): { selection: Selection | null; structural: boolean } | null {
    const entry = this.#redo.at(-1)
    if (!entry) return null
    this.#redo = this.#redo.slice(0, -1)
    const res = this.ds.apply(entry.op)
    this.#undo = [...this.#undo, entry]
    this.#cost += entry.cost
    this.#trim()
    return { selection: entry.selAfter, structural: res.structural }
  }

  /** 오래된 항목부터 버려 개수·메모리 상한을 지킨다. */
  #trim(): void {
    let drop = 0
    while (
      (this.#undo.length - drop > MAX_ENTRIES || this.#cost > MAX_COST) &&
      this.#undo.length - drop > 1
    ) {
      this.#cost -= this.#undo[drop].cost
      drop++
    }
    if (drop > 0) this.#undo = this.#undo.slice(drop)
  }
}

/** 연산이 보관하는 문자 수 대략치. */
function opCost(op: Op): number {
  switch (op.t) {
    case 'cells': {
      let n = 0
      for (const c of op.changes) n += c.before.length + c.after.length + 8
      return n
    }
    case 'insertRows':
    case 'deleteRows': {
      let n = 0
      for (const r of op.rows) for (const v of r) n += v.length + 2
      return n
    }
    case 'replaceRows': {
      let n = 0
      for (const r of op.before) for (const v of r) n += v.length + 2
      for (const r of op.after) for (const v of r) n += v.length + 2
      return n
    }
    case 'insertCols':
    case 'deleteCols': {
      let n = 0
      for (const r of op.values) for (const v of r) n += v.length + 2
      return n + op.orderBefore.length * 8 + op.orderAfter.length * 8
    }
    case 'placeRows':
      return (op.picks.length + op.dests.length) * 8
    case 'setColOrder':
      return (op.before.length + op.after.length) * 8
    case 'renameCol':
      return op.before.length + op.after.length + 8
  }
}
