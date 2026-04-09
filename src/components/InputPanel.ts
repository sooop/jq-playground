import { readFile } from '../core/file-handler';
import { handleTabKey } from '../utils/keyboard';
import { Storage } from '../utils/storage';
import { csvToJson, detectDelimiter } from '../core/csv-parser';
import { extractJson, needsJsonExtraction, tryFormatJson } from '../utils/json-extractor';
import { scanJson, filterEntries, type JsonEntry } from '../utils/json-position-scanner';
import type { ComponentElement, InputPanelApi } from '../types';

export function createInputPanel(onInputChange: () => void, onExecuteQuery: (() => void) | null) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="panel-header">
      <span class="panel-title">
        Input <span id="inputFormat" class="input-format-label"></span>
        <span id="autoPlayChip" class="auto-play-chip" style="display: none;">자동실행 중</span>
      </span>
      <div class="panel-actions">
        <button id="parseCsvBtn" style="display: none;">Parse as CSV</button>
        <button id="formatJsonBtn" title="Format JSON (Ctrl+Shift+F)">Format</button>
        <button id="clearInputBtn">Clear</button>
        <button id="loadFileBtn">Load File</button>
        <button id="findJsonBtn" title="Find in JSON (Ctrl+F)">Find</button>
        <button id="inputHistoryBtn">History</button>
        <input type="file" id="fileInput" accept=".json,.txt,.csv,.tsv" style="display: none;">
      </div>
    </div>
    <div class="panel-content">
      <textarea id="input" placeholder="Paste JSON here or drag & drop a file..."></textarea>
      <div class="drag-overlay" id="dragOverlay">Drop file here</div>
    </div>
  `;

  const textarea = panel.querySelector<HTMLTextAreaElement>('#input')!;
  const fileInput = panel.querySelector<HTMLInputElement>('#fileInput')!;
  const panelContent = panel.querySelector<HTMLElement>('.panel-content')!;
  const dragOverlay = panel.querySelector<HTMLElement>('#dragOverlay')!;
  const formatLabel = panel.querySelector<HTMLElement>('#inputFormat')!;
  const parseCsvBtn = panel.querySelector<HTMLButtonElement>('#parseCsvBtn')!;

  // Track current file name
  let currentFileName: string | null = null;

  // Debounce timer for auto-save
  let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Auto-format state (disabled automatically for large pastes)
  let autoFormatEnabled = true;

  // Find state
  let findEntriesCache: JsonEntry[] | null = null;
  let findDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Create history dropdown
  const historyDropdown = document.createElement('div');
  historyDropdown.className = 'dropdown input-history-dropdown';
  historyDropdown.style.display = 'none';
  historyDropdown.innerHTML = `
    <div class="dropdown-header">
      <input type="text" id="inputHistorySearch" placeholder="Search history...">
      <button id="sortToggleBtn" class="sort-toggle" title="Toggle sort: Register time ↔ Last used time">
        <span class="sort-label">등록순</span>
      </button>
      <button id="clearAllInputHistory" class="clear-all-btn">Clear All</button>
    </div>
    <div class="dropdown-list" id="inputHistoryList"></div>
  `;
  document.body.appendChild(historyDropdown);

  const historyBtn = panel.querySelector<HTMLButtonElement>('#inputHistoryBtn')!;
  const sortToggleBtn = historyDropdown.querySelector<HTMLButtonElement>('#sortToggleBtn')!;
  const sortLabel = sortToggleBtn.querySelector<HTMLElement>('.sort-label')!;
  const searchInput = historyDropdown.querySelector<HTMLInputElement>('#inputHistorySearch')!;
  const historyList = historyDropdown.querySelector<HTMLElement>('#inputHistoryList')!;
  const clearAllBtn = historyDropdown.querySelector<HTMLButtonElement>('#clearAllInputHistory')!;

  // Create find dropdown
  const findDropdown = document.createElement('div');
  findDropdown.className = 'dropdown input-find-dropdown';
  findDropdown.style.display = 'none';
  findDropdown.innerHTML = `
    <div class="dropdown-header">
      <input type="text" id="inputFindSearch" placeholder="Search keys & values..." autocomplete="off">
      <label class="find-filter"><input type="checkbox" id="findKeysToggle" checked> Keys</label>
      <label class="find-filter"><input type="checkbox" id="findValuesToggle" checked> Values</label>
      <label class="find-filter find-filter-regex"><input type="checkbox" id="findRegexToggle"> <span title="Use regular expression">.*</span></label>
      <span class="search-info" id="findMatchInfo"></span>
      <button id="findCloseBtn" title="Close (Escape)">×</button>
    </div>
    <div class="dropdown-list" id="findResultList"></div>
  `;
  document.body.appendChild(findDropdown);

  const findOverlay = document.createElement('div');
  findOverlay.className = 'input-find-overlay';
  document.body.appendChild(findOverlay);

  const findBtn = panel.querySelector<HTMLButtonElement>('#findJsonBtn')!;
  const findSearchInput = findDropdown.querySelector<HTMLInputElement>('#inputFindSearch')!;
  const findResultList = findDropdown.querySelector<HTMLElement>('#findResultList')!;
  const findMatchInfo = findDropdown.querySelector<HTMLElement>('#findMatchInfo')!;
  const findKeysToggle = findDropdown.querySelector<HTMLInputElement>('#findKeysToggle')!;
  const findValuesToggle = findDropdown.querySelector<HTMLInputElement>('#findValuesToggle')!;
  const findRegexToggle = findDropdown.querySelector<HTMLInputElement>('#findRegexToggle')!;
  const findCloseBtn = findDropdown.querySelector<HTMLButtonElement>('#findCloseBtn')!;

  // Sort state (default: timestamp)
  let currentSortBy = localStorage.getItem('jq-input-sort') || 'timestamp';
  sortLabel.textContent = currentSortBy === 'timestamp' ? '등록순' : '사용순';

  // Auto-save input (20 second debounce)
  const autoSaveInput = () => {
    if (saveDebounceTimer !== null) clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(async () => {
      const content = textarea.value.trim();
      if (content) {
        await Storage.saveInputHistory(content, currentFileName);
      }
    }, 20000);
  };

  // Format detailed timestamp (YYYY-MM-DD HH:MM:SS)
  const formatDetailedTimestamp = (iso: string) => {
    const date = new Date(iso);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  // Load and display history
  const loadHistory = async (searchTerm = '') => {
    let items;
    if (searchTerm) {
      items = await Storage.searchInputHistory(searchTerm);
      // Sort search results by current sort preference
      items.sort((a, b) => new Date(b[currentSortBy as keyof typeof b] as string).getTime() - new Date(a[currentSortBy as keyof typeof a] as string).getTime());
    } else {
      items = await Storage.getInputHistory(50, currentSortBy);
    }

    if (items.length === 0) {
      const isSearch = !!searchTerm;
      historyList.innerHTML = `<div class="history-empty-state">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          ${isSearch
            ? '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M8 11h6"/>'
            : '<path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/>'}
        </svg>
        <span>${isSearch ? '검색 결과가 없습니다' : '히스토리가 없습니다'}</span>
        <small>${isSearch ? `"${searchTerm}"에 맞는 히스토리가 없습니다` : 'JSON 데이터를 입력하면 여기에 기록됩니다'}</small>
      </div>`;
      return;
    }

    historyList.innerHTML = items.map(item => {
      const size = formatFileSize(item.size);
      const preview = item.content.substring(0, 80).replace(/\n/g, ' ');
      const registeredTime = formatDetailedTimestamp(item.timestamp);
      const lastUsedTime = item.lastUsed !== item.timestamp
        ? formatDetailedTimestamp(item.lastUsed)
        : null;

      return `
        <div class="dropdown-item input-history-item" data-id="${item.id}">
          <div class="input-history-content">
            <div class="input-history-preview">${preview}...</div>
            <div class="input-history-meta">
              <div class="input-history-time">
                <span>${item.fileName || 'Untitled'}</span> • <span>${size}</span>
              </div>
              <div class="input-history-time">
                <span>등록: ${registeredTime}</span>
                ${lastUsedTime ? `<span> • 사용: ${lastUsedTime}</span>` : ''}
              </div>
            </div>
          </div>
          <button class="delete-input-history" data-id="${item.id}" title="Delete">×</button>
        </div>
      `;
    }).join('');

    // Add click handlers
    historyList.querySelectorAll<HTMLElement>('.input-history-item').forEach(item => {
      const id = parseInt(item.dataset['id']!);
      item.addEventListener('click', async (e) => {
        if ((e.target as HTMLElement).classList.contains('delete-input-history')) {
          return; // Handled by delete button
        }

        const historyItem = items.find(h => h.id === id);
        if (historyItem) {
          // raw content 먼저 표시 (즉시 반응)
          textarea.value = historyItem.content;
          currentFileName = historyItem.fileName;
          onInputChange();
          historyDropdown.style.display = 'none';

          // 비동기 포맷팅 (Worker에서 수행, 메인스레드 블로킹 없음)
          if (autoFormatEnabled) {
            try {
              const formatted = await formatJsonInWorker(historyItem.content);
              if (formatted !== historyItem.content) {
                textarea.value = formatted;
                onInputChange();
                await Storage.updateInputHistoryContent(id, formatted);
              } else {
                await Storage.saveInputHistory(historyItem.content, historyItem.fileName);
              }
            } catch {
              // 포맷 실패 시 원본 유지, lastUsed만 업데이트
              await Storage.saveInputHistory(historyItem.content, historyItem.fileName);
            }
          } else {
            await Storage.saveInputHistory(historyItem.content, historyItem.fileName);
          }
        }
      });
    });

    // Delete buttons
    historyList.querySelectorAll<HTMLElement>('.delete-input-history').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt((e.target as HTMLElement).dataset['id']!);
        await Storage.deleteInputHistory(id);
        loadHistory(searchInput.value);
      });
    });
  };

  // Format file size
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Update format label
  const updateFormatLabel = (fileName: string | null) => {
    if (!fileName) {
      formatLabel.textContent = '';
      return;
    }
    const ext = fileName.split('.').pop()!.toUpperCase();
    if (['CSV', 'TSV'].includes(ext)) {
      formatLabel.textContent = `(${ext} → JSON)`;
    } else {
      formatLabel.textContent = '';
    }
  };

  // Find: escape HTML entities
  const escapeHtml = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Find: highlight matching substring in text
  const highlightMatch = (text: string, query: string, useRegex = false): string => {
    if (!query) return escapeHtml(text);
    let regex: RegExp;
    if (useRegex) {
      try {
        regex = new RegExp(query, 'gi');
      } catch {
        return escapeHtml(text);
      }
    } else {
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      regex = new RegExp(escapedQuery, 'gi');
    }
    const parts: string[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      parts.push(escapeHtml(text.slice(lastIndex, match.index)));
      parts.push(`<mark>${escapeHtml(match[0])}</mark>`);
      lastIndex = match.index + match[0].length;
      if (match[0].length === 0) { regex.lastIndex++; }
    }
    parts.push(escapeHtml(text.slice(lastIndex)));
    return parts.join('');
  };

  // Find: navigate textarea to position
  const navigateToPosition = (start: number, end: number): void => {
    const computedStyle = getComputedStyle(textarea);
    const lineHeight = parseFloat(computedStyle.lineHeight) || 18;
    const lineNum = textarea.value.substring(0, start).split('\n').length - 1;
    const scrollTarget = lineNum * lineHeight - textarea.clientHeight / 2;
    textarea.focus();
    textarea.setSelectionRange(start, end);
    textarea.scrollTop = Math.max(0, scrollTarget);
  };

  // Find: render result items in the dropdown
  const renderFindResults = (results: ReturnType<typeof filterEntries>, query: string, useRegex = false): void => {
    const MAX_DISPLAY = 200;
    const val = textarea.value.trim();

    if (!val) {
      findResultList.innerHTML = '<div class="find-empty-state">JSON을 입력하면 검색할 수 있습니다</div>';
      findMatchInfo.textContent = '';
      return;
    }

    if (!query.trim()) {
      const total = findEntriesCache?.length ?? 0;
      findResultList.innerHTML = `<div class="find-empty-state">${total > 0 ? `${total}개 항목 발견. 검색어를 입력하세요.` : 'JSON 항목이 없습니다'}</div>`;
      findMatchInfo.textContent = '';
      return;
    }

    if (useRegex) {
      try { new RegExp(query); } catch {
        findResultList.innerHTML = '<div class="find-empty-state find-regex-error">정규식 오류: 올바른 패턴을 입력하세요</div>';
        findMatchInfo.textContent = '';
        return;
      }
    }

    if (results.length === 0) {
      findResultList.innerHTML = '<div class="find-empty-state">일치하는 항목 없음</div>';
      findMatchInfo.textContent = '0개';
      return;
    }

    const overflow = results.length > MAX_DISPLAY;
    findMatchInfo.textContent = overflow ? `${MAX_DISPLAY}+개` : `${results.length}개`;

    findResultList.innerHTML = results.slice(0, MAX_DISPLAY).map((e, i) => {
      const pathHtml = query ? highlightMatch(e.path, query, useRegex) : escapeHtml(e.path);
      const valueHtml = query ? highlightMatch(e.value, query, useRegex) : escapeHtml(e.value);
      return `<div class="find-result-item" tabindex="-1"
        data-ks="${e.keyStart}" data-ke="${e.keyEnd}"
        data-vs="${e.valueStart}" data-ve="${e.valueEnd}"
        data-has-key="${e.key !== null}"
        data-index="${i}">
        <span class="find-path">${pathHtml}</span>
        <span class="find-value">${valueHtml}</span>
      </div>`;
    }).join('') + (overflow ? '<div class="find-overflow">결과가 200개로 제한되었습니다. 검색어를 구체화하세요.</div>' : '');

    // Add click and keyboard handlers
    findResultList.querySelectorAll<HTMLElement>('.find-result-item').forEach(item => {
      item.addEventListener('click', () => {
        const ks = parseInt(item.dataset['ks']!);
        const ke = parseInt(item.dataset['ke']!);
        const vs = parseInt(item.dataset['vs']!);
        const ve = parseInt(item.dataset['ve']!);
        const hasKey = item.dataset['hasKey'] === 'true';
        const selectStart = hasKey && ks < ke ? ks : vs;
        const selectEnd = hasKey && ks < ke ? ke : ve;
        navigateToPosition(selectStart, selectEnd);
        findResultList.querySelectorAll('.find-result-item.active').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
      });

      item.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          item.click();
        } else if (e.key === 'Escape') {
          closeFindDropdown();
          textarea.focus();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          const next = item.nextElementSibling as HTMLElement | null;
          if (next?.classList.contains('find-result-item')) next.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prev = item.previousElementSibling as HTMLElement | null;
          if (prev?.classList.contains('find-result-item')) prev.focus();
          else findSearchInput.focus();
        }
      });
    });
  };

  // Find: run search and render
  const performFindSearch = (): void => {
    if (textarea.value.length > 2 * 1024 * 1024) {
      findResultList.innerHTML = '<div class="find-empty-state">JSON이 너무 큽니다 (2MB 초과)</div>';
      findMatchInfo.textContent = '';
      return;
    }
    if (!findEntriesCache) {
      findEntriesCache = scanJson(textarea.value);
    }
    const query = findSearchInput.value;
    const useRegex = findRegexToggle.checked;
    const filtered = filterEntries(findEntriesCache, query, findKeysToggle.checked, findValuesToggle.checked, useRegex);
    renderFindResults(filtered, query, useRegex);
  };

  // Find: open/close
  const openFindDropdown = (): void => {
    if (findDropdown.style.display !== 'none') {
      findSearchInput.focus();
      return;
    }
    findDropdown.style.display = 'flex';
    findOverlay.style.display = 'block';
    findEntriesCache = null;
    performFindSearch();
    findSearchInput.focus();
  };

  const closeFindDropdown = (): void => {
    findDropdown.style.display = 'none';
    findOverlay.style.display = 'none';
  };

  // Update auto-format indicator in the format label
  const updateAutoFormatIndicator = () => {
    if (!autoFormatEnabled) {
      formatLabel.textContent = '자동 포맷 꺼짐';
      formatLabel.style.color = '#aaa';
    } else {
      if (formatLabel.textContent === '자동 포맷 꺼짐') {
        formatLabel.textContent = '';
        formatLabel.style.color = '';
      }
    }
  };

  // Detect if text looks like CSV
  const isCsvLike = (text: string) => {
    // Check if valid JSON first
    try {
      JSON.parse(text);
      return false;
    } catch {
      // Need at least 2 lines
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) return false;

      // Use detectDelimiter from csv-parser
      const delimiter = detectDelimiter(text);
      return delimiter !== null;
    }
  };

  // Convert CSV/TSV to JSON
  const convertCsvToJson = async (text: string, _fileName: string | null) => {
    try {
      const jsonData = csvToJson(text, {
        hasHeader: true,
        inferTypes: false
      });
      return JSON.stringify(jsonData, null, 2);
    } catch (error) {
      throw new Error('CSV parsing failed: ' + (error as Error).message);
    }
  };

  // Persistent format worker (재사용, idle 30초 후 자동 종료)
  let _formatWorker: Worker | null = null;
  let _formatWorkerUrl: string | null = null;
  let _formatWorkerIdleTimer: ReturnType<typeof setTimeout> | null = null;
  const FORMAT_WORKER_IDLE_MS = 30000;

  const _getFormatWorker = () => {
    if (_formatWorkerIdleTimer !== null) clearTimeout(_formatWorkerIdleTimer);
    if (!_formatWorker) {
      const code = `self.onmessage=function(e){try{self.postMessage({ok:JSON.stringify(JSON.parse(e.data),null,4)})}catch(err){self.postMessage({err:err.message})}};`;
      _formatWorkerUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      _formatWorker = new Worker(_formatWorkerUrl);
    }
    // idle 타이머 리셋
    _formatWorkerIdleTimer = setTimeout(() => {
      if (_formatWorker) {
        _formatWorker.terminate();
        if (_formatWorkerUrl) URL.revokeObjectURL(_formatWorkerUrl);
        _formatWorker = null;
        _formatWorkerUrl = null;
      }
    }, FORMAT_WORKER_IDLE_MS);
    return _formatWorker;
  };

  // Run JSON.parse + JSON.stringify in a Worker so the main thread stays responsive
  const formatJsonInWorker = (jsonString: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const worker = _getFormatWorker();
      worker.onmessage = (e: MessageEvent<{ ok?: string; err?: string }>) => {
        e.data.err ? reject(new Error(e.data.err)) : resolve(e.data.ok!);
      };
      worker.postMessage(jsonString);
    });
  };

  // Format JSON function (async — parse+stringify run off the main thread)
  const formatJson = async () => {
    const value = textarea.value.trim();
    if (!value) return;

    try {
      const formatted = await formatJsonInWorker(value);
      textarea.value = formatted;
      onInputChange();
      autoSaveInput();
    } catch (error) {
      // JSON 파싱 실패 시 추출 시도
      if (needsJsonExtraction(value)) {
        if (confirm('유효하지 않은 JSON입니다. JSON 객체를 추출하시겠습니까?')) {
          const extracted = extractJson(value);
          if (extracted) {
            textarea.value = extracted;
            onInputChange();
            autoSaveInput();
          } else {
            alert('유효한 JSON 객체를 찾을 수 없습니다.');
          }
        }
      } else {
        alert('Invalid JSON: ' + (error as Error).message);
      }
    }
  };

  // Event listeners
  textarea.addEventListener('input', () => {
    findEntriesCache = null;
    onInputChange();
    autoSaveInput();

    // Show size warning — use .length (O(1)) to avoid Blob allocation on every keystroke
    const size = textarea.value.length;
    if (size > 2.5 * 1024 * 1024) {  // 2.5MB warning
      formatLabel.textContent = `(${(size / 1024 / 1024).toFixed(1)}MB - 자동실행 제한 임박)`;
      formatLabel.style.color = 'var(--error-color)';
    } else if (size > 500 * 1024) {
      formatLabel.textContent = `(${(size / 1024).toFixed(0)}KB)`;
      formatLabel.style.color = 'var(--text-tertiary)';
    } else if (formatLabel.textContent!.includes('KB') || formatLabel.textContent!.includes('MB')) {
      // Clear size label if it was showing size info
      formatLabel.textContent = '';
      formatLabel.style.color = '';
    }
  });

  textarea.addEventListener('paste', (_e: ClipboardEvent) => {
    autoFormatEnabled = false; // 붙여넣기 시작 시 항상 비활성화
    setTimeout(() => {
      const text = textarea.value;
      const size = text.length; // .length is O(1); avoids Blob allocation on main thread
      const AUTO_EXTRACT_SIZE = 100 * 1024; // 100KB
      const LARGE_INPUT_THRESHOLD = 1 * 1024 * 1024; // 1MB

      if (size <= LARGE_INPUT_THRESHOLD) {
        autoFormatEnabled = true; // 소용량이면 복구
      }
      updateAutoFormatIndicator();

      // 대용량 입력: CSV 검사, JSON 추출, 자동 포맷 모두 스킵 (UI 블로킹 방지)
      if (size > LARGE_INPUT_THRESHOLD) {
        parseCsvBtn.style.display = 'none';
        onInputChange();
        return;
      }

      if (isCsvLike(text)) {
        parseCsvBtn.style.display = 'inline-block';
      } else if (needsJsonExtraction(text)) {
        parseCsvBtn.style.display = 'none';

        // 크기가 작으면 자동 실행, 크면 확인
        const shouldExtract = size <= AUTO_EXTRACT_SIZE ||
          confirm('유효하지 않은 JSON이 감지되었습니다. JSON 객체를 추출하시겠습니까?');

        if (shouldExtract) {
          const extracted = extractJson(text);
          if (extracted) {
            textarea.value = extracted;
            onInputChange();
          } else if (size > AUTO_EXTRACT_SIZE) {
            alert('유효한 JSON 객체를 찾을 수 없습니다.');
          }
        }
      } else {
        parseCsvBtn.style.display = 'none';
        // 유효한 JSON이면 자동 포맷팅
        const formatted = tryFormatJson(text);
        if (formatted !== text) {
          textarea.value = formatted;
          onInputChange();
        }
      }
    }, 10);
  });

  textarea.addEventListener('keydown', (e: KeyboardEvent) => {
    // Ctrl+Enter: Execute query
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      if (onExecuteQuery) {
        onExecuteQuery();
      }
      return;
    }

    // Ctrl+F: Find in JSON
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openFindDropdown();
      return;
    }

    // Ctrl+Shift+F: Format JSON
    if (e.ctrlKey && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      formatJson();
      return;
    }
    handleTabKey(e);
  });

  // Find button
  findBtn.addEventListener('click', () => {
    if (findDropdown.style.display !== 'none') {
      closeFindDropdown();
    } else {
      openFindDropdown();
    }
  });

  // Find search input
  findSearchInput.addEventListener('input', () => {
    if (findDebounceTimer !== null) clearTimeout(findDebounceTimer);
    findDebounceTimer = setTimeout(performFindSearch, 200);
  });

  findSearchInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeFindDropdown();
      textarea.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const firstItem = findResultList.querySelector<HTMLElement>('.find-result-item');
      firstItem?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const firstItem = findResultList.querySelector<HTMLElement>('.find-result-item');
      firstItem?.click();
    }
  });

  // Find close button
  findCloseBtn.addEventListener('click', () => {
    closeFindDropdown();
    textarea.focus();
  });

  // Find toggles
  findKeysToggle.addEventListener('change', performFindSearch);
  findValuesToggle.addEventListener('change', performFindSearch);
  findRegexToggle.addEventListener('change', () => {
    findSearchInput.placeholder = findRegexToggle.checked ? 'Regex pattern...' : 'Search keys & values...';
    performFindSearch();
  });

  panel.querySelector<HTMLButtonElement>('#formatJsonBtn')!.addEventListener('click', async () => {
    autoFormatEnabled = true; // 수동 포맷 클릭 시 자동 포맷 복구
    updateAutoFormatIndicator();
    await formatJson();
  });

  panel.querySelector<HTMLButtonElement>('#clearInputBtn')!.addEventListener('click', () => {
    textarea.value = '';
    currentFileName = null;
    updateFormatLabel(null);
    parseCsvBtn.style.display = 'none';
    onInputChange();
  });

  parseCsvBtn.addEventListener('click', async () => {
    const content = textarea.value;
    try {
      const jsonContent = await convertCsvToJson(content, null);
      textarea.value = jsonContent;
      currentFileName = null;
      updateFormatLabel(null);
      parseCsvBtn.style.display = 'none';
      onInputChange();
    } catch (error) {
      alert((error as Error).message);
    }
  });

  panel.querySelector<HTMLButtonElement>('#loadFileBtn')!.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      let content = await readFile(file);
      const ext = file.name.split('.').pop()!.toLowerCase();
      const size = (content as string).length;
      const AUTO_EXTRACT_SIZE = 100 * 1024; // 100KB

      // Auto-convert CSV/TSV to JSON
      if (ext === 'csv' || ext === 'tsv') {
        try {
          content = await convertCsvToJson(content as string, file.name);
          currentFileName = file.name;
          updateFormatLabel(file.name);
        } catch (error) {
          alert((error as Error).message + '\n\nShowing original content.');
          currentFileName = file.name;
          updateFormatLabel(null);
        }
      } else {
        currentFileName = file.name;
        updateFormatLabel(null);

        // JSON 추출 시도
        if (needsJsonExtraction(content as string)) {
          const shouldExtract = size <= AUTO_EXTRACT_SIZE ||
            confirm('유효하지 않은 JSON이 감지되었습니다. JSON 객체를 추출하시겠습니까?');

          if (shouldExtract) {
            const extracted = extractJson(content as string);
            if (extracted) {
              content = extracted;
            } else if (size > AUTO_EXTRACT_SIZE) {
              alert('유효한 JSON 객체를 찾을 수 없습니다.');
            }
          }
        } else {
          // 유효한 JSON이면 자동 포맷팅
          content = tryFormatJson(content as string);
        }
      }

      textarea.value = content as string;
      onInputChange();

      // Immediately save file loads (포맷팅된 데이터 저장)
      await Storage.saveInputHistory(content as string, currentFileName);
    } catch (error) {
      alert((error as Error).message);
    }
    (e.target as HTMLInputElement).value = '';
  });

  // Sort toggle button
  sortToggleBtn.addEventListener('click', async () => {
    currentSortBy = currentSortBy === 'timestamp' ? 'lastUsed' : 'timestamp';
    sortLabel.textContent = currentSortBy === 'timestamp' ? '등록순' : '사용순';
    localStorage.setItem('jq-input-sort', currentSortBy);

    // Reload history if dropdown is open
    if (historyDropdown.style.display !== 'none') {
      await loadHistory(searchInput.value);
    }
  });

  // History button
  historyBtn.addEventListener('click', async () => {
    if (historyDropdown.style.display === 'none') {
      const rect = historyBtn.getBoundingClientRect();
      historyDropdown.style.top = rect.bottom + 5 + 'px';
      historyDropdown.style.right = window.innerWidth - rect.right + 'px';
      historyDropdown.style.display = 'block';
      searchInput.value = '';
      await loadHistory();
      searchInput.focus();
    } else {
      historyDropdown.style.display = 'none';
    }
  });

  // Search input
  let searchDebounce: ReturnType<typeof setTimeout> | null = null;
  searchInput.addEventListener('input', () => {
    if (searchDebounce !== null) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      loadHistory(searchInput.value);
    }, 300);
  });

  // Clear all button
  clearAllBtn.addEventListener('click', async () => {
    if (confirm('Clear all input history?')) {
      await Storage.clearAllInputHistory();
      historyDropdown.style.display = 'none';
    }
  });

  // Overlay click closes find dropdown
  findOverlay.addEventListener('click', () => closeFindDropdown());

  // Close history dropdown when clicking outside
  document.addEventListener('click', (e: MouseEvent) => {
    if (!historyDropdown.contains(e.target as Node) && e.target !== historyBtn) {
      historyDropdown.style.display = 'none';
    }
  });

  // ESC key to close dropdowns
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (historyDropdown.style.display !== 'none') historyDropdown.style.display = 'none';
      if (findDropdown.style.display !== 'none') findDropdown.style.display = 'none';
    }
  });

  // Drag and drop
  panelContent.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    dragOverlay.classList.add('active');
  });

  panelContent.addEventListener('dragleave', (e: DragEvent) => {
    if (e.target === panelContent) {
      dragOverlay.classList.remove('active');
    }
  });

  panelContent.addEventListener('drop', async (e: DragEvent) => {
    e.preventDefault();
    dragOverlay.classList.remove('active');

    const file = e.dataTransfer!.files[0];
    if (!file) return;

    try {
      let content = await readFile(file);
      const ext = file.name.split('.').pop()!.toLowerCase();
      const size = (content as string).length;
      const AUTO_EXTRACT_SIZE = 100 * 1024; // 100KB

      // Auto-convert CSV/TSV to JSON
      if (ext === 'csv' || ext === 'tsv') {
        try {
          content = await convertCsvToJson(content as string, file.name);
          currentFileName = file.name;
          updateFormatLabel(file.name);
        } catch (error) {
          alert((error as Error).message + '\n\nShowing original content.');
          currentFileName = file.name;
          updateFormatLabel(null);
        }
      } else {
        currentFileName = file.name;
        updateFormatLabel(null);

        // JSON 추출 시도
        if (needsJsonExtraction(content as string)) {
          const shouldExtract = size <= AUTO_EXTRACT_SIZE ||
            confirm('유효하지 않은 JSON이 감지되었습니다. JSON 객체를 추출하시겠습니까?');

          if (shouldExtract) {
            const extracted = extractJson(content as string);
            if (extracted) {
              content = extracted;
            } else if (size > AUTO_EXTRACT_SIZE) {
              alert('유효한 JSON 객체를 찾을 수 없습니다.');
            }
          }
        } else {
          // 유효한 JSON이면 자동 포맷팅
          content = tryFormatJson(content as string);
        }
      }

      textarea.value = content as string;
      onInputChange();

      // Immediately save file drops (포맷팅된 데이터 저장)
      await Storage.saveInputHistory(content as string, currentFileName);
    } catch (error) {
      alert((error as Error).message);
    }
  });

  // API
  const el = panel as unknown as ComponentElement<InputPanelApi>;
  el.api = {
    getCurrentFileName: () => currentFileName,
    restoreInput: (content: string, fileName: string | null) => {
      textarea.value = content;
      currentFileName = fileName;
    },
    setAutoPlayIndicator: (enabled: boolean) => {
      const chip = panel.querySelector<HTMLElement>('#autoPlayChip')!;
      chip.style.display = enabled ? 'inline-block' : 'none';
    }
  };

  return el;
}
