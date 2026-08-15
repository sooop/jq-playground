import { openPopover } from '../utils/popover';
import type { UniqueValue } from '../core/grid/column-filter';

export interface ColumnFilterMenuOptions {
  anchor: HTMLElement;
  columnName: string;
  values: UniqueValue[];
  truncated: boolean;
  /** 현재 제외된 값 집합 (비어 있으면 필터 없음) */
  excluded: Set<string>;
  /** excluded가 비면(전체 선택) 필터 해제로 취급 */
  onApply: (excluded: Set<string>) => void;
  onClear: () => void;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function openColumnFilterMenu(opts: ColumnFilterMenuOptions): void {
  const popover = openPopover(opts.anchor, 'dgrid-filtermenu');
  const { el, close } = popover;
  const excluded = new Set(opts.excluded);

  el.innerHTML = `
    <div class="dgrid-filtermenu-title">${escapeHtml(opts.columnName)}</div>
    <div class="dgrid-filtermenu-search">
      <input type="text" placeholder="값 검색..." />
    </div>
    <div class="dgrid-filtermenu-list"></div>
    ${opts.truncated ? '<div class="dgrid-filtermenu-truncated">값이 많아 일부만 표시됩니다</div>' : ''}
    <div class="dgrid-filtermenu-actions">
      <button data-action="select-all">전체 선택</button>
      <button data-action="clear-all">전체 해제</button>
      <button data-action="apply" class="primary">적용</button>
    </div>
  `;

  const searchInput = el.querySelector<HTMLInputElement>('input')!;
  const list = el.querySelector<HTMLElement>('.dgrid-filtermenu-list')!;

  function renderList(filter: string) {
    const q = filter.trim().toLowerCase();
    list.innerHTML = opts.values
      .filter(v => q === '' || v.value.toLowerCase().includes(q))
      .map(v => {
        const label = v.value === '' ? '(빈 값)' : escapeHtml(v.value);
        return `
        <label class="dgrid-filtermenu-item">
          <input type="checkbox" data-value="${escapeHtml(v.value)}" ${excluded.has(v.value) ? '' : 'checked'} />
          <span>${label}</span>
          <em>${v.count.toLocaleString()}</em>
        </label>`;
      })
      .join('');
  }
  renderList('');
  popover.reposition();

  searchInput.addEventListener('input', () => {
    renderList(searchInput.value);
    popover.reposition();
  });

  list.addEventListener('change', e => {
    const target = e.target as HTMLInputElement;
    if (!target.matches('input[type="checkbox"]')) return;
    const value = target.dataset.value ?? '';
    if (target.checked) excluded.delete(value);
    else excluded.add(value);
  });

  el.querySelector('[data-action="select-all"]')!.addEventListener('click', () => {
    for (const v of opts.values) excluded.delete(v.value);
    renderList(searchInput.value);
  });

  el.querySelector('[data-action="clear-all"]')!.addEventListener('click', () => {
    for (const v of opts.values) excluded.add(v.value);
    renderList(searchInput.value);
  });

  el.querySelector('[data-action="apply"]')!.addEventListener('click', () => {
    if (excluded.size === 0) opts.onClear();
    else opts.onApply(excluded);
    close();
  });

  searchInput.focus();
}
