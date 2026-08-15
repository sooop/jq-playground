import { openPopover } from '../utils/popover';

export interface ColumnManagerColumn {
  srcCol: number;
  name: string;
  hidden: boolean;
  empty: boolean;
}

export interface ColumnManagerOptions {
  anchor: HTMLElement;
  columns: ColumnManagerColumn[]; // colOrder 순
  onToggle: (srcCol: number, hidden: boolean) => void;
  onShowAll: () => void;
  onHideEmpty: () => void;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export interface ColumnManagerHandle {
  close: () => void;
  refresh: (columns: ColumnManagerColumn[]) => void;
}

export function openColumnManager(opts: ColumnManagerOptions): ColumnManagerHandle {
  const popover = openPopover(opts.anchor, 'dgrid-colmenu');
  const { el } = popover;
  let columns = opts.columns;

  el.innerHTML = `
    <div class="dgrid-colmenu-search">
      <input type="text" placeholder="열 검색..." />
    </div>
    <div class="dgrid-colmenu-list"></div>
    <div class="dgrid-colmenu-actions">
      <button data-action="show-all">전체 표시</button>
      <button data-action="hide-empty">빈 열 숨기기</button>
    </div>
  `;

  const searchInput = el.querySelector<HTMLInputElement>('input')!;
  const list = el.querySelector<HTMLElement>('.dgrid-colmenu-list')!;

  function renderList(filter: string) {
    const q = filter.trim().toLowerCase();
    list.innerHTML = columns
      .filter(c => q === '' || c.name.toLowerCase().includes(q))
      .map(
        c => `
        <label class="dgrid-colmenu-item">
          <input type="checkbox" data-col="${c.srcCol}" ${c.hidden ? '' : 'checked'} />
          <span>${escapeHtml(c.name)}</span>
        </label>`
      )
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
    if (target.matches('input[type="checkbox"]')) {
      const srcCol = Number(target.dataset.col);
      opts.onToggle(srcCol, !target.checked);
    }
  });

  el.querySelector('[data-action="show-all"]')!.addEventListener('click', () => {
    opts.onShowAll();
    for (const cb of list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      cb.checked = true;
    }
  });

  el.querySelector('[data-action="hide-empty"]')!.addEventListener('click', () => {
    opts.onHideEmpty();
  });

  searchInput.focus();

  return {
    close: popover.close,
    refresh: (next: ColumnManagerColumn[]) => {
      columns = next;
      renderList(searchInput.value);
      popover.reposition();
    },
  };
}
