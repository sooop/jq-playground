import { describe, expect, it } from 'vitest'
import { Dataset } from '../src/lib/data/dataset.svelte'
import { runExport } from '../src/lib/data/export'
import { SelectionStore } from '../src/lib/data/selection.svelte'
import type { ExportOptions } from '../src/lib/data/types'
import { View } from '../src/lib/data/view.svelte'
import { finalize } from '../src/lib/parse/detect'

describe('runExport 결과 구분', () => {
  it('내보낼 데이터가 없으면 ok:false(경고)로 돌려준다', async () => {
    const ds = new Dataset()
    ds.loadParsed(finalize([['a', 'b']], ',', true, false))
    const opts: ExportOptions = {
      scope: 'all',
      format: 'csv',
      target: 'clipboard',
      includeHeader: false,
      applyColOrder: false,
      quoting: 'minimal',
      newline: '\n',
      bom: false,
    }
    const res = await runExport(ds, new View(ds), new SelectionStore(), opts)
    expect(res).toEqual({ ok: false, message: '내보낼 데이터가 없습니다' })
  })
})
