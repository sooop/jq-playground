import type { ComponentElement, PanelToggleApi } from '../types';

const SNIPPETS = [
  {
    id: 'find-by-key',
    title: '키 패턴으로 찾기',
    desc: '키 이름이 패턴과 일치하는 모든 경로와 값을 반환합니다',
    query: `"pattern" as $pattern |
[ paths as $p |
  select($p | last | tostring | test($pattern; "i")) |
  { path: ($p | join(".")), value: getpath($p) }
]`
  },
  {
    id: 'find-by-value',
    title: '값 패턴으로 찾기',
    desc: '값이 패턴과 일치하는 모든 경로와 값을 반환합니다',
    query: `"pattern" as $pattern |
[ paths(scalars) as $p |
  select(getpath($p) | tostring | test($pattern; "i")) |
  { path: ($p | join(".")), value: getpath($p) }
]`
  },
  {
    id: 'find-by-key-or-value',
    title: '키/값 패턴으로 찾기',
    desc: '키 또는 값이 패턴과 일치하는 모든 항목을 경로·키·값·매칭유형과 함께 반환합니다',
    query: `"pattern" as $pattern |
[ paths(scalars) as $p |
  select(
    ($p | last | tostring | test($pattern; "i"))
    or (getpath($p) | tostring | test($pattern; "i"))
  ) |
  {
    path: ($p | join(".")),
    key: ($p | last | tostring),
    value: getpath($p),
    matched: (if ($p | last | tostring | test($pattern; "i")) then "key" else "value" end)
  }
]`
  },
  {
    id: 'filter-by-key',
    title: '키 패턴으로 필터',
    desc: '스트림에서 패턴과 일치하는 키를 하나라도 가진 항목만 통과시킵니다',
    query: `"pattern" as $pattern |
select(
  any(paths as $p |
    $p | last | tostring | test($pattern; "i")
  )
)`
  },
  {
    id: 'filter-by-value',
    title: '값 패턴으로 필터',
    desc: '스트림에서 패턴과 일치하는 값을 하나라도 가진 항목만 통과시킵니다',
    query: `"pattern" as $pattern |
select(
  any(paths(scalars) as $p |
    getpath($p) | tostring | test($pattern; "i")
  )
)`
  },
  {
    id: 'filter-by-key-or-value',
    title: '키/값 패턴으로 필터',
    desc: '스트림에서 키 또는 값이 패턴과 일치하는 항목만 통과시킵니다',
    query: `"pattern" as $pattern |
select(
  any(paths(scalars) as $p |
    ($p | last | tostring | test($pattern; "i"))
    or (getpath($p) | tostring | test($pattern; "i"))
  )
)`
  }
];

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function createSnippets(onQuerySelect) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'snippetsModal';

  const itemsHTML = SNIPPETS.map(snippet => `
    <div class="snippet-item" data-id="${snippet.id}">
      <div class="snippet-header">
        <span class="snippet-title">${escapeHtml(snippet.title)}</span>
        <span class="snippet-desc">${escapeHtml(snippet.desc)}</span>
      </div>
      <pre class="snippet-code"><code>${escapeHtml(snippet.query)}</code></pre>
    </div>
  `).join('');

  overlay.innerHTML = `
    <div class="modal snippets-modal">
      <div class="modal-header">
        <div class="modal-title">Snippets</div>
        <button class="modal-close-btn" id="snippetsCloseBtn">✕</button>
      </div>
      <div class="snippets-content">
        ${itemsHTML}
      </div>
    </div>
  `;

  const closeBtn = overlay.querySelector<HTMLButtonElement>('#snippetsCloseBtn')!;

  const api: PanelToggleApi = {
    toggle: () => overlay.classList.toggle('show'),
    open: () => overlay.classList.add('show'),
    close: () => overlay.classList.remove('show'),
  };

  closeBtn.addEventListener('click', () => api.close());

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) api.close();
  });

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && overlay.classList.contains('show')) {
      api.close();
    }
  });

  overlay.querySelectorAll<HTMLElement>('.snippet-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.id;
      const snippet = SNIPPETS.find(s => s.id === id);
      if (snippet) {
        onQuerySelect(snippet.query);
        api.close();
      }
    });
  });

  const el = overlay as unknown as ComponentElement<PanelToggleApi>;
  el.api = api;
  return el;
}
