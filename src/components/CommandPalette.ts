import { getRegistry, KeymapEntry } from '../utils/keymap';
import { Storage } from '../utils/storage';
import { SearchIcon, CommandIcon, HistoryIcon, SaveIcon, ZapIcon, XIcon } from '../icons';

// ── 타입 ──

type CPItemKind = 'action' | 'snippet' | 'history';

interface CPItem {
  id: string;
  kind: CPItemKind;
  label: string;
  description?: string;
  badge?: string;
  icon: string;
  handler: () => void;
}

// ── Fuzzy 매칭 (subsequence scoring) ──

function fuzzyScore(query: string, target: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  if (t.includes(q)) return 2 + (t.startsWith(q) ? 1 : 0);

  let qi = 0;
  let score = 0;
  let lastMatch = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 1 + (ti - lastMatch === 1 ? 1 : 0); // 연속 매칭 보너스
      lastMatch = ti;
      qi++;
    }
  }

  return qi === q.length ? score / t.length : 0;
}

// ── CommandPalette 컴포넌트 ──

export interface CommandPaletteApi {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
}

export function createCommandPalette(): { element: HTMLElement; api: CommandPaletteApi } {
  // ── DOM 구조 ──
  const overlay = document.createElement('div');
  overlay.className = 'command-palette-overlay hidden';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '커맨드 팔레트');

  const palette = document.createElement('div');
  palette.className = 'command-palette';

  // 검색 영역
  const searchWrapper = document.createElement('div');
  searchWrapper.className = 'cp-search-wrapper';
  searchWrapper.innerHTML = `<span class="cp-search-icon">${SearchIcon}</span>`;

  const searchInput = document.createElement('input');
  searchInput.className = 'cp-search-input';
  searchInput.type = 'text';
  searchInput.placeholder = '명령 또는 쿼리 검색...';
  searchInput.setAttribute('aria-label', '명령 검색');
  searchInput.setAttribute('aria-autocomplete', 'list');
  searchInput.setAttribute('aria-controls', 'cp-results-list');

  const clearBtn = document.createElement('button');
  clearBtn.className = 'cp-clear-btn';
  clearBtn.innerHTML = XIcon;
  clearBtn.setAttribute('aria-label', '검색어 지우기');
  clearBtn.title = '지우기 (Esc)';

  searchWrapper.appendChild(searchInput);
  searchWrapper.appendChild(clearBtn);

  // 결과 목록
  const results = document.createElement('div');
  results.className = 'cp-results';
  results.id = 'cp-results-list';
  results.setAttribute('role', 'listbox');
  results.setAttribute('aria-label', '검색 결과');

  // 푸터
  const footer = document.createElement('div');
  footer.className = 'cp-footer';
  footer.innerHTML = `
    <span class="cp-hint"><kbd>↑↓</kbd> 이동</span>
    <span class="cp-hint"><kbd>Enter</kbd> 실행</span>
    <span class="cp-hint"><kbd>Esc</kbd> 닫기</span>
  `;

  palette.appendChild(searchWrapper);
  palette.appendChild(results);
  palette.appendChild(footer);
  overlay.appendChild(palette);

  // ── 상태 ──
  let allItems: CPItem[] = [];
  let filteredItems: CPItem[] = [];
  let selectedIndex = 0;
  let isVisible = false;

  // ── 데이터 로드 ──
  async function loadItems(): Promise<CPItem[]> {
    const items: CPItem[] = [];

    // 1. keymap 액션
    const keymapEntries: KeymapEntry[] = [...getRegistry()];
    keymapEntries.forEach(entry => {
      items.push({
        id: `action:${entry.id}`,
        kind: 'action',
        label: entry.label,
        description: entry.description,
        badge: entry.keys,
        icon: CommandIcon,
        handler: () => entry.handler(new KeyboardEvent('keydown')),
      });
    });

    // 2. 저장된 쿼리 (Snippets)
    try {
      const savedQueries = Storage.getSavedQueries();
      savedQueries.forEach((sq: { name: string; query: string }) => {
        items.push({
          id: `snippet:${sq.name}`,
          kind: 'snippet',
          label: sq.name,
          description: sq.query,
          icon: SaveIcon,
          handler: () => {
            const queryArea = document.querySelector<HTMLTextAreaElement>('#query');
            if (queryArea) {
              queryArea.value = sq.query;
              queryArea.dispatchEvent(new Event('input', { bubbles: true }));
              queryArea.focus();
            }
          },
        });
      });
    } catch { /* 조용히 실패 */ }

    // 3. 쿼리 히스토리 (최근 10개)
    try {
      const history = await Storage.getQueryHistory(10);
      history.forEach((h: { id: number; query: string }) => {
        items.push({
          id: `history:${h.id}`,
          kind: 'history',
          label: h.query,
          description: '최근 쿼리',
          icon: HistoryIcon,
          handler: () => {
            const queryArea = document.querySelector<HTMLTextAreaElement>('#query');
            if (queryArea) {
              queryArea.value = h.query;
              queryArea.dispatchEvent(new Event('input', { bubbles: true }));
              queryArea.focus();
            }
          },
        });
      });
    } catch { /* 조용히 실패 */ }

    return items;
  }

  // ── 렌더링 ──
  function renderResults(items: CPItem[]) {
    results.innerHTML = '';

    if (items.length === 0) {
      results.innerHTML = `<div class="cp-empty">결과가 없습니다</div>`;
      return;
    }

    // 섹션별로 그루핑
    const sections: { label: string; kind: CPItemKind; icon: string }[] = [
      { label: '액션', kind: 'action',  icon: ZapIcon },
      { label: '저장된 쿼리', kind: 'snippet', icon: SaveIcon },
      { label: '최근 쿼리', kind: 'history', icon: HistoryIcon },
    ];

    sections.forEach(({ label, kind }) => {
      const sectionItems = items.filter(i => i.kind === kind);
      if (sectionItems.length === 0) return;

      const sectionLabel = document.createElement('div');
      sectionLabel.className = 'cp-section-label';
      sectionLabel.textContent = label;
      results.appendChild(sectionLabel);

      sectionItems.forEach(item => {
        const el = document.createElement('div');
        el.className = 'cp-item';
        el.setAttribute('role', 'option');
        el.setAttribute('aria-selected', 'false');
        el.dataset.itemId = item.id;
        el.innerHTML = `
          <span class="cp-item-icon">${item.icon}</span>
          <span class="cp-item-body">
            <div class="cp-item-label">${escapeHtml(item.label)}</div>
            ${item.description ? `<div class="cp-item-desc">${escapeHtml(item.description.slice(0, 80))}</div>` : ''}
          </span>
          ${item.badge ? `<span class="cp-item-badge">${escapeHtml(item.badge)}</span>` : ''}
        `;

        el.addEventListener('click', () => {
          item.handler();
          close();
        });

        el.addEventListener('mouseenter', () => {
          const allEls = getAllItemEls();
          setSelected(allEls.indexOf(el));
        });

        results.appendChild(el);
      });
    });

    // 첫 번째 아이템 선택
    setSelected(0);
  }

  function getAllItemEls(): HTMLElement[] {
    return Array.from(results.querySelectorAll<HTMLElement>('.cp-item'));
  }

  function setSelected(idx: number) {
    const els = getAllItemEls();
    if (els.length === 0) return;

    idx = Math.max(0, Math.min(idx, els.length - 1));
    selectedIndex = idx;

    els.forEach((el, i) => {
      el.setAttribute('aria-selected', String(i === idx));
    });

    els[idx]?.scrollIntoView({ block: 'nearest' });
    searchInput.setAttribute('aria-activedescendant', els[idx]?.id || '');
  }

  function filter(query: string) {
    if (!query.trim()) {
      filteredItems = allItems.slice(0, 30);
    } else {
      filteredItems = allItems
        .map(item => ({ item, score: fuzzyScore(query, item.label) + fuzzyScore(query, item.description ?? '') * 0.5 }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
        .map(({ item }) => item);
    }
    renderResults(filteredItems);
  }

  // ── 개폐 ──
  async function open() {
    isVisible = true;
    overlay.classList.remove('hidden');
    searchInput.value = '';
    clearBtn.classList.remove('visible');

    // 아이템 로드 (캐싱 없음, 항상 최신)
    allItems = await loadItems();
    filteredItems = allItems.slice(0, 30);
    renderResults(filteredItems);

    requestAnimationFrame(() => searchInput.focus());
  }

  function close() {
    isVisible = false;
    overlay.classList.add('hidden');
    // 포커스 복원
    const active = document.activeElement as HTMLElement;
    if (active === searchInput || overlay.contains(active)) {
      (document.querySelector<HTMLElement>('#query') ?? document.body).focus();
    }
  }

  // ── 이벤트 ──
  searchInput.addEventListener('input', () => {
    const q = searchInput.value;
    clearBtn.classList.toggle('visible', q.length > 0);
    filter(q);
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.classList.remove('visible');
    filter('');
    searchInput.focus();
  });

  searchInput.addEventListener('keydown', (e) => {
    const els = getAllItemEls();

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected(selectedIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(selectedIndex - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = els[selectedIndex];
      if (selected) {
        const itemId = selected.dataset.itemId;
        const item = filteredItems.find(i => i.id === itemId);
        if (item) {
          item.handler();
          close();
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });

  // 오버레이 클릭으로 닫기
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  // ── 유틸 ──
  function escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const api: CommandPaletteApi = {
    open,
    close,
    toggle: () => isVisible ? close() : open(),
    isOpen: () => isVisible,
  };

  return { element: overlay, api };
}
