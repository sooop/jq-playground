import type { ComponentElement, PanelToggleApi } from '../types';

interface Snippet {
  id: string;
  title: string;
  desc: string;
  category: 'search' | 'filter' | 'transform' | 'aggregate';
  query: string;
}

const SNIPPETS: Snippet[] = [
  {
    id: 'universal-pattern-search',
    title: '범용 패턴 검색',
    desc: '구조를 모르는 JSON에서 키/값이 패턴과 매치되는 모든 {경로: 값}을 추출합니다.',
    category: 'search',
    query: `"qsp" as $pattern |
[ paths(scalars) as $p |
  select(
    (getpath($p) | tostring | (. != "") and test($pattern; "i")) or
    ($p | last | tostring | test($pattern; "i")) // false
  ) |
  { ($p | map(tostring) | join(".")): getpath($p) }
] | add`,
  },
  {
    id: 'flatten-paths',
    title: '모든 경로 평탄화',
    desc: '중첩된 JSON을 {경로: 값} 형태의 한 단계 객체로 펼칩니다.',
    category: 'search',
    query: `[paths(scalars) as $p | {($p | map(tostring) | join(".")): getpath($p)}] | add`,
  },
  {
    id: 'filter-array-by-key',
    title: '배열 필터: 키 매치',
    desc: '배열 요소 중 특정 키 이름이 패턴과 매치되는 항목만 반환합니다.',
    category: 'filter',
    query: `"qsp" as $pattern |
map(select([keys_unsorted[] | test($pattern; "i")] | any))`,
  },
  {
    id: 'filter-array-by-value',
    title: '배열 필터: 값 매치',
    desc: '배열 요소 중 어떤 스칼라 값이라도 패턴과 매치되는 항목만 반환합니다.',
    category: 'filter',
    query: `"qsp" as $pattern |
map(select([.. | scalars | tostring | test($pattern; "i")] | any))`,
  },
  {
    id: 'filter-by-condition',
    title: '배열 필터: 조건식',
    desc: '특정 필드가 조건에 맞는 항목만 골라냅니다. .field를 실제 키로 변경하세요.',
    category: 'filter',
    query: `map(select(.field != null and .field != ""))`,
  },
  {
    id: 'group-by-field',
    title: '필드로 그룹화',
    desc: '배열을 특정 필드 값으로 그룹화하고 카운트와 함께 반환합니다.',
    category: 'aggregate',
    query: `group_by(.field) |
map({ key: .[0].field, count: length, items: . })`,
  },
  {
    id: 'unique-values',
    title: '고유 값 추출',
    desc: '배열의 특정 필드에서 고유한 값만 추출합니다.',
    category: 'aggregate',
    query: `[.[] | .field] | unique`,
  },
  {
    id: 'count-by-field',
    title: '필드 값 빈도 집계',
    desc: '특정 필드의 값별 등장 횟수를 내림차순으로 정렬합니다.',
    category: 'aggregate',
    query: `group_by(.field) |
map({value: .[0].field, count: length}) |
sort_by(-.count)`,
  },
  {
    id: 'pick-fields',
    title: '특정 필드만 선택',
    desc: '배열의 각 요소에서 지정한 필드들만 남깁니다.',
    category: 'transform',
    query: `map({id, name, value})`,
  },
  {
    id: 'rename-field',
    title: '필드명 변환',
    desc: '키 이름을 변경하거나 구조를 재구성합니다.',
    category: 'transform',
    query: `map({
  newName: .oldName,
  label:   .title,
  count:   (.items | length)
})`,
  },
];

const CATEGORY_META: Record<Snippet['category'], { label: string; colorVar: string }> = {
  search:    { label: 'Search',    colorVar: 'var(--accent-input)'  },
  filter:    { label: 'Filter',    colorVar: 'var(--accent-query)'  },
  aggregate: { label: 'Aggregate', colorVar: 'var(--accent-output)' },
  transform: { label: 'Transform', colorVar: 'var(--text-muted)'    },
};

const CATEGORY_ORDER: Snippet['category'][] = ['search', 'filter', 'aggregate', 'transform'];

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 스니펫 쿼리를 쿼리 패널에 삽입하고, "qsp" 플레이스홀더를 selection 처리.
 */
function insertSnippetQuery(query: string, onQuerySelect: (q: string) => void) {
  onQuerySelect(query);
  // "qsp" 텍스트를 자동 선택
  requestAnimationFrame(() => {
    const queryTa = document.querySelector<HTMLTextAreaElement>('#query');
    if (!queryTa) return;
    const idx = queryTa.value.indexOf('"qsp"');
    if (idx !== -1) {
      queryTa.setSelectionRange(idx + 1, idx + 4); // "qsp" 내의 qsp 부분
      queryTa.focus();
    }
  });
}

export function createSnippets(onQuerySelect: (query: string) => void): ComponentElement<PanelToggleApi> {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'snippetsModal';

  // 카테고리별로 그룹화
  const grouped = CATEGORY_ORDER.map(cat => ({
    category: cat,
    meta: CATEGORY_META[cat],
    items: SNIPPETS.filter(s => s.category === cat),
  })).filter(g => g.items.length > 0);

  const sectionsHTML = grouped.map(group => {
    const cardsHTML = group.items.map(snippet => `
      <div class="snippet-card" data-id="${snippet.id}" tabindex="0" role="button" aria-label="${escapeHtml(snippet.title)} 스니펫 삽입">
        <div class="snippet-card-badge" style="--badge-color: ${group.meta.colorVar}">${escapeHtml(group.meta.label)}</div>
        <div class="snippet-card-title">${escapeHtml(snippet.title)}</div>
        <div class="snippet-card-desc">${escapeHtml(snippet.desc)}</div>
        <pre class="snippet-card-preview"><code>${escapeHtml(snippet.query)}</code></pre>
      </div>
    `).join('');

    return `
      <section class="snippets-section">
        <h3 class="snippets-section-title" style="--section-color: ${group.meta.colorVar}">${escapeHtml(group.meta.label)}</h3>
        <div class="snippets-grid">
          ${cardsHTML}
        </div>
      </section>
    `;
  }).join('');

  overlay.innerHTML = `
    <div class="modal snippets-modal">
      <div class="modal-header">
        <div class="modal-title">Snippets</div>
        <button class="modal-close-btn" id="snippetsCloseBtn" aria-label="닫기">✕</button>
      </div>
      <div class="snippets-body">
        ${sectionsHTML}
      </div>
    </div>
  `;

  const closeBtn = overlay.querySelector<HTMLButtonElement>('#snippetsCloseBtn')!;

  const api: PanelToggleApi = {
    toggle: () => overlay.classList.toggle('show'),
    open:   () => overlay.classList.add('show'),
    close:  () => overlay.classList.remove('show'),
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

  overlay.querySelectorAll<HTMLElement>('.snippet-card').forEach(card => {
    const activate = () => {
      const id = card.dataset.id;
      const snippet = SNIPPETS.find(s => s.id === id);
      if (snippet) {
        insertSnippetQuery(snippet.query, onQuerySelect);
        api.close();
      }
    };
    card.addEventListener('click', activate);
    card.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });
  });

  const el = overlay as unknown as ComponentElement<PanelToggleApi>;
  el.api = api;
  return el;
}
