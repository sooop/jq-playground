import { jsonToMatrix } from '../core/csv-converter';
import { downloadText } from '../core/file-handler';
import { VirtualScroller } from '../utils/virtual-scroller';
import { createDataGrid } from './DataGrid';
import type { Matrix } from '../core/grid/view';
import type { OutputPanelElement } from '../types';

export function createOutputPanel() {
  const panel = document.createElement('div');
  panel.className = 'panel output-panel';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', '출력 결과');
  panel.innerHTML = `
    <div class="panel-header">
      <span class="panel-title">Output <span id="lastRunTime" style="font-weight:normal;color:var(--text-tertiary);font-size:11px;margin-left:8px;"></span></span>
      <div class="panel-actions">
        <button id="autoPlayBtn" class="auto-play-btn active" title="Pause auto-execute (Ctrl+Shift+E)">⏸</button>
        <select id="formatSelect">
          <option value="json">JSON</option>
          <option value="csv">CSV</option>
        </select>
        <button id="columnsBtn" title="열 관리" style="display:none">열</button>
        <button id="maximizeBtn" title="출력 패널 최대화 (Ctrl+Shift+M)">⤢</button>
        <button id="copyBtn">Copy</button>
        <button id="downloadBtn">Download</button>
      </div>
    </div>
    <div class="stats-bar" id="statsBar"></div>
    <div class="search-bar" id="searchBar">
      <input type="text" id="searchInput" placeholder="Search..." />
      <span class="search-info" id="searchInfo"></span>
      <button id="searchPrevBtn" title="Previous (Shift+Enter)">↑</button>
      <button id="searchNextBtn" title="Next (Enter)">↓</button>
      <button id="searchCloseBtn" title="Close (Escape)">×</button>
    </div>
    <div class="error-banner" id="errorBanner"></div>
    <div class="panel-content">
      <div class="output-content" id="output"></div>
      <div class="grid-content" id="gridOutput"></div>
    </div>
    <div class="error-toast" id="errorToast"></div>
  `;

  const output = panel.querySelector<HTMLElement>('#output')!;
  const gridOutput = panel.querySelector<HTMLElement>('#gridOutput')!;
  const errorBanner = panel.querySelector<HTMLElement>('#errorBanner')!;
  const autoPlayBtn = panel.querySelector<HTMLButtonElement>('#autoPlayBtn')!;
  const formatSelect = panel.querySelector<HTMLSelectElement>('#formatSelect')!;
  const columnsBtn = panel.querySelector<HTMLButtonElement>('#columnsBtn')!;
  const copyBtn = panel.querySelector<HTMLButtonElement>('#copyBtn')!;
  const downloadBtn = panel.querySelector<HTMLButtonElement>('#downloadBtn')!;
  const lastRunTime = panel.querySelector<HTMLElement>('#lastRunTime')!;
  const statsBar = panel.querySelector<HTMLElement>('#statsBar')!;
  const searchBar = panel.querySelector<HTMLElement>('#searchBar')!;
  const searchInput = panel.querySelector<HTMLInputElement>('#searchInput')!;
  const searchInfo = panel.querySelector<HTMLElement>('#searchInfo')!;
  const searchPrevBtn = panel.querySelector<HTMLButtonElement>('#searchPrevBtn')!;
  const searchNextBtn = panel.querySelector<HTMLButtonElement>('#searchNextBtn')!;
  const searchCloseBtn = panel.querySelector<HTMLButtonElement>('#searchCloseBtn')!;

  const dataGrid = createDataGrid();
  gridOutput.appendChild(dataGrid);

  let lastResultData: unknown = null;
  let lastResultText: string | null = null;  // Worker에서 받은 JSON.stringify 결과 (텍스트)
  let errorTimeout: ReturnType<typeof setTimeout> | null = null;
  let autoPlayEnabled = true;
  let searchMatches: Array<{ start: number; end: number; text: string }> = [];
  let currentMatchIndex = -1;
  let originalOutputHTML = '';
  let isInErrorState = false;
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Virtual scroller for large JSON output
  const virtualScroller = new VirtualScroller(output);
  let isVirtualScrollActive = false;

  /** JSON/CSV 뷰 전환. csv일 때만 그리드와 열 관리 버튼을 노출한다. */
  function setActiveView(format: string) {
    if (format === 'csv') {
      output.style.display = 'none';
      gridOutput.style.display = 'block';
      columnsBtn.style.display = '';
      dataGrid.api.relayout();
    } else {
      output.style.display = '';
      gridOutput.style.display = 'none';
      columnsBtn.style.display = 'none';
    }
  }

  // Helper function to generate stats
  function generateStats(data: unknown, executionTime: number | undefined) {
    const stats: string[] = [];

    // Execution time
    if (executionTime !== undefined) {
      const timeStr = executionTime < 1 ? '<1ms' : `${executionTime.toFixed(1)}ms`;
      stats.push(`<span class="stat-item stat-time">${timeStr}</span>`);
    }

    // Type
    const type = Array.isArray(data) ? 'array' : typeof data;
    stats.push(`<span class="stat-item stat-type">${type}</span>`);

    // Additional info based on type
    if (Array.isArray(data)) {
      stats.push(`<span class="stat-item">${data.length} items</span>`);
    } else if (data && typeof data === 'object') {
      const keys = Object.keys(data as object);
      stats.push(`<span class="stat-item">${keys.length} keys</span>`);
    } else if (typeof data === 'string') {
      stats.push(`<span class="stat-item">${(data as string).length} chars</span>`);
    } else if (typeof data === 'number') {
      stats.push(`<span class="stat-item">${data}</span>`);
    }

    return stats.join('');
  }

  function generateGridStats(executionTime: number | undefined) {
    const stats: string[] = [];
    if (executionTime !== undefined) {
      const timeStr = executionTime < 1 ? '<1ms' : `${executionTime.toFixed(1)}ms`;
      stats.push(`<span class="stat-item stat-time">${timeStr}</span>`);
    }
    const s = dataGrid.api.getStats();
    const rowsLabel = s.rows === s.totalRows ? `${s.rows.toLocaleString()} rows` : `${s.rows.toLocaleString()} / ${s.totalRows.toLocaleString()} rows`;
    stats.push(`<span class="stat-item">${rowsLabel}</span>`);
    stats.push(`<span class="stat-item">${s.cols.toLocaleString()} cols</span>`);
    if (s.hidden > 0) stats.push(`<span class="stat-item">${s.hidden} hidden</span>`);
    if (s.filtered > 0) stats.push(`<span class="stat-item">${s.filtered} filtered</span>`);
    return stats.join('');
  }

  let lastGridExecutionTime: number | undefined;

  function refreshGridStats() {
    if (formatSelect.value !== 'csv') return;
    statsBar.innerHTML = generateGridStats(lastGridExecutionTime);
    statsBar.style.display = 'flex';
  }
  // 그리드 내부에서 정렬/숨김/필터가 바뀔 때마다 stats bar를 다시 그린다
  dataGrid.api.setOnStatsChange(refreshGridStats);

  function applyGridResult(matrix: Matrix, executionTime?: number) {
    lastGridExecutionTime = executionTime;
    dataGrid.api.setData(matrix);
    setActiveView('csv');

    const now = new Date();
    lastRunTime.textContent = now.toLocaleTimeString();
    refreshGridStats();
  }

  // Flash effect cleanup
  output.addEventListener('animationend', () => {
    output.classList.remove('flash');
  });

  // Search functions
  function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function toggleSearch(show: boolean) {
    if (show) {
      searchBar.classList.add('show');
      searchInput.focus();
      searchInput.select();
    } else {
      searchBar.classList.remove('show');
      clearSearch();
    }
  }

  function clearSearch() {
    searchMatches = [];
    currentMatchIndex = -1;
    searchInfo.textContent = '';

    if (formatSelect.value === 'csv') {
      dataGrid.api.find('');
      return;
    }

    if (isVirtualScrollActive) {
      // 가상 스크롤러 검색 초기화 + 하이라이트 제거
      virtualScroller.search('');
      return;
    }
    // Restore original content
    if (originalOutputHTML && formatSelect.value === 'json') {
      output.innerHTML = '';
      output.textContent = originalOutputHTML;
    }
  }

  function performSearch() {
    const query = searchInput.value;

    if (formatSelect.value === 'csv') {
      if (!query) {
        clearSearch();
        return;
      }
      const { total, truncated } = dataGrid.api.find(query);
      if (total > 0) {
        const info = dataGrid.api.getMatchInfo();
        searchInfo.textContent = `${info.current} of ${info.total}${truncated ? '+' : ''}`;
      } else {
        searchInfo.textContent = 'No matches';
      }
      return;
    }

    if (!query || (!lastResultData && !lastResultText)) {
      clearSearch();
      return;
    }

    // 일반 모드: 기존 검색 로직
    if (!originalOutputHTML) {
      originalOutputHTML = output.textContent!;
    }

    const text = originalOutputHTML;
    const regex = new RegExp(escapeRegExp(query), 'gi');
    searchMatches = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      searchMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0]
      });
    }

    if (searchMatches.length > 0) {
      currentMatchIndex = 0;
      highlightMatches();
      updateSearchInfo();
    } else {
      searchInfo.textContent = 'No matches';
      output.innerHTML = '';
      output.textContent = originalOutputHTML;
    }
  }

  function highlightMatches() {
    if (searchMatches.length === 0 || formatSelect.value !== 'json') return;

    const text = originalOutputHTML;
    let result = '';
    let lastIndex = 0;

    searchMatches.forEach((match, index) => {
      // Add text before match
      result += escapeHtmlText(text.substring(lastIndex, match.start));
      // Add highlighted match
      const highlightClass = index === currentMatchIndex ? 'search-highlight current' : 'search-highlight';
      result += `<span class="${highlightClass}">${escapeHtmlText(match.text)}</span>`;
      lastIndex = match.end;
    });

    // Add remaining text
    result += escapeHtmlText(text.substring(lastIndex));
    output.innerHTML = result;

    // Scroll current match into view
    const currentHighlight = output.querySelector('.search-highlight.current');
    if (currentHighlight) {
      currentHighlight.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function escapeHtmlText(text: string) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function updateSearchInfo() {
    if (searchMatches.length > 0) {
      searchInfo.textContent = `${currentMatchIndex + 1} of ${searchMatches.length}`;
    } else {
      searchInfo.textContent = 'No matches';
    }
  }

  function goToNextMatch() {
    if (formatSelect.value === 'csv') {
      dataGrid.api.nextMatch();
      const info = dataGrid.api.getMatchInfo();
      searchInfo.textContent = info.total ? `${info.current} of ${info.total}` : 'No matches';
      return;
    }
    if (isVirtualScrollActive) {
      virtualScroller.nextMatch();
      const info = virtualScroller.getMatchInfo();
      if (info) searchInfo.textContent = `${info.current} of ${info.total}`;
      return;
    }
    if (searchMatches.length === 0) return;
    currentMatchIndex = (currentMatchIndex + 1) % searchMatches.length;
    highlightMatches();
    updateSearchInfo();
  }

  function goToPrevMatch() {
    if (formatSelect.value === 'csv') {
      dataGrid.api.prevMatch();
      const info = dataGrid.api.getMatchInfo();
      searchInfo.textContent = info.total ? `${info.current} of ${info.total}` : 'No matches';
      return;
    }
    if (isVirtualScrollActive) {
      virtualScroller.prevMatch();
      const info = virtualScroller.getMatchInfo();
      if (info) searchInfo.textContent = `${info.current} of ${info.total}`;
      return;
    }
    if (searchMatches.length === 0) return;
    currentMatchIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    highlightMatches();
    updateSearchInfo();
  }

  // Search event listeners (200ms 디바운스)
  searchInput.addEventListener('input', () => {
    if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      performSearch();
    }, 200);
  });

  searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        goToPrevMatch();
      } else {
        goToNextMatch();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      toggleSearch(false);
    }
  });

  searchPrevBtn.addEventListener('click', goToPrevMatch);
  searchNextBtn.addEventListener('click', goToNextMatch);
  searchCloseBtn.addEventListener('click', () => toggleSearch(false));

  // Ctrl+F to open search
  panel.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'f') {
      e.preventDefault();
      toggleSearch(true);
    }
  });

  // Also allow Ctrl+F when focus is in the panel content area
  output.setAttribute('tabindex', '0');

  columnsBtn.addEventListener('click', () => {
    dataGrid.api.openColumnManager(columnsBtn);
  });

  // Public methods
  const api = {
    showLoading: () => {
      output.innerHTML = '<span class="loading">Processing...</span>';
    },

    /**
     * 기존 호환 API: raw 객체를 받아서 메인스레드에서 stringify
     * (폴백 전용 — Worker가 실패했을 때만 사용)
     */
    showResult: (data: unknown, format: string, executionTime?: number) => {
      lastResultData = data;
      lastResultText = null;
      originalOutputHTML = '';
      clearSearch();

      isInErrorState = false;
      output.classList.remove('stale-result-subtle');
      gridOutput.classList.remove('stale-result-subtle');

      if (format === 'json') {
        const text = JSON.stringify(data, null, 2);
        lastResultText = text;
        setActiveView('json');
        virtualScroller.setText(text);
        isVirtualScrollActive = virtualScroller.active;

        output.classList.remove('flash');
        void output.offsetWidth;
        output.classList.add('flash');

        const now = new Date();
        lastRunTime.textContent = now.toLocaleTimeString();
        statsBar.innerHTML = generateStats(data, executionTime);
        statsBar.style.display = 'flex';
      } else if (format === 'csv') {
        applyGridResult(jsonToMatrix(data), executionTime);
      }
      api.hideError();
    },

    /**
     * Worker에서 받은 stringify된 텍스트로 결과 표시 (메인스레드 stringify 제거)
     */
    showResultText: (resultText: string, format: string, executionTime?: number) => {
      lastResultData = null;
      lastResultText = resultText;
      originalOutputHTML = '';
      clearSearch();

      isInErrorState = false;
      output.classList.remove('stale-result-subtle');
      setActiveView('json');

      // 가상 스크롤링: 줄 수에 따라 자동 활성화
      virtualScroller.setText(resultText);
      isVirtualScrollActive = virtualScroller.active;

      output.classList.remove('flash');
      void output.offsetWidth;
      output.classList.add('flash');

      const now = new Date();
      lastRunTime.textContent = now.toLocaleTimeString();

      // resultText에서 간단한 stats 추출
      let statsHtml = '';
      if (executionTime !== undefined) {
        const timeStr = executionTime < 1 ? '<1ms' : `${executionTime.toFixed(1)}ms`;
        statsHtml += `<span class="stat-item stat-time">${timeStr}</span>`;
      }
      statsHtml += `<span class="stat-item stat-type">${format}</span>`;
      if (isVirtualScrollActive) {
        statsHtml += `<span class="stat-item">${virtualScroller.totalLines.toLocaleString()} lines</span>`;
      }
      statsBar.innerHTML = statsHtml;
      statsBar.style.display = 'flex';
      api.hideError();
    },

    /**
     * Worker에서 포맷 변환된 JSON 결과 표시 (formatResult 응답, format==='json' 전용)
     */
    showFormattedResult: (content: string, format: string, executionTime?: number) => {
      originalOutputHTML = '';
      clearSearch();

      isInErrorState = false;
      output.classList.remove('stale-result-subtle');

      lastResultText = content;
      setActiveView('json');
      virtualScroller.setText(content);
      isVirtualScrollActive = virtualScroller.active;

      output.classList.remove('flash');
      void output.offsetWidth;
      output.classList.add('flash');

      const now = new Date();
      lastRunTime.textContent = now.toLocaleTimeString();

      if (executionTime !== undefined) {
        const timeStr = executionTime < 1 ? '<1ms' : `${executionTime.toFixed(1)}ms`;
        statsBar.innerHTML = `<span class="stat-item stat-time">${timeStr}</span><span class="stat-item stat-type">${format}</span>`;
        statsBar.style.display = 'flex';
      }

      api.hideError();
    },

    /**
     * Worker/메인스레드에서 만든 CSV 매트릭스를 DataGrid로 표시
     */
    showGridResult: (matrix: Matrix, executionTime?: number) => {
      originalOutputHTML = '';
      clearSearch();

      isInErrorState = false;
      output.classList.remove('stale-result-subtle');
      gridOutput.classList.remove('stale-result-subtle');

      applyGridResult(matrix, executionTime);
    },

    showError: (message: string, autoHideDuration: number | false = 5000) => {
      const errorToast = panel.querySelector<HTMLElement>('#errorToast')!;
      errorToast.textContent = message;
      errorToast.classList.add('show');
      isInErrorState = true;

      if (errorTimeout) clearTimeout(errorTimeout);

      if (autoHideDuration !== false) {
        errorTimeout = setTimeout(() => {
          api.hideError();
        }, autoHideDuration);
      }

      // 이전 결과가 있으면 유지된 상태로 흐리게 표시
      const currentFormat = formatSelect.value;
      if (currentFormat === 'json' && (lastResultText !== null || lastResultData !== null)) {
        if (lastResultText) {
          isVirtualScrollActive = false;
          output.textContent = lastResultText;
        } else if (lastResultData) {
          isVirtualScrollActive = false;
          output.textContent = JSON.stringify(lastResultData, null, 2);
        }
        output.classList.add('stale-result-subtle');
      } else if (currentFormat === 'csv' && dataGrid.api.getStats().totalRows > 0) {
        gridOutput.classList.add('stale-result-subtle');
      } else if (currentFormat === 'json') {
        output.textContent = '';
      }

      // stats bar에 "이전 결과" 표시 추가 (중복 방지)
      if (!statsBar.querySelector('.prev-result-label')) {
        const prevLabel = '<span class="prev-result-label">이전 결과</span>';
        statsBar.innerHTML = prevLabel + statsBar.innerHTML;
      }
    },

    hideError: () => {
      if (errorTimeout) clearTimeout(errorTimeout);
      const errorToast = panel.querySelector<HTMLElement>('#errorToast')!;
      errorToast.classList.remove('show');
      errorBanner.classList.remove('show');
      isInErrorState = false;
      output.classList.remove('stale-result-subtle');
      gridOutput.classList.remove('stale-result-subtle');

      // Remove prev-result-label from statsBar
      const prevLabel = statsBar.querySelector('.prev-result-label');
      if (prevLabel) {
        prevLabel.remove();
      }
    },

    getFormat: () => formatSelect.value,

    getLastResultText: () => lastResultText,

    clear: () => {
      output.textContent = '';
      lastResultData = null;
      lastResultText = null;
      isVirtualScrollActive = false;
      virtualScroller.setLines([]);
      dataGrid.api.clear();
      statsBar.innerHTML = '';
      statsBar.style.display = 'none';
      isInErrorState = false;
      output.classList.remove('stale-result-subtle');
      gridOutput.classList.remove('stale-result-subtle');
      api.hideError();
    },

    isAutoPlayEnabled: () => autoPlayEnabled,

    toggleAutoPlay: () => {
      autoPlayEnabled = !autoPlayEnabled;
      if (autoPlayEnabled) {
        autoPlayBtn.classList.add('active');
        autoPlayBtn.textContent = '⏸';
        autoPlayBtn.title = 'Pause auto-execute (Ctrl+Shift+E)';
      } else {
        autoPlayBtn.classList.remove('active');
        autoPlayBtn.textContent = '▶';
        autoPlayBtn.title = 'Resume auto-execute (Ctrl+Shift+E)';
      }

      // Trigger callback when auto-play is enabled
      const el = panel as unknown as OutputPanelElement;
      if (autoPlayEnabled && el.onAutoPlayToggle) {
        el.onAutoPlayToggle(autoPlayEnabled);
      }

      return autoPlayEnabled;
    },

    relayoutGrid: () => {
      dataGrid.api.relayout();
    },
  };

  // Event listeners
  autoPlayBtn.addEventListener('click', () => {
    api.toggleAutoPlay();
  });

  copyBtn.addEventListener('click', () => {
    const format = formatSelect.value;

    if (format === 'csv') {
      dataGrid.api.copySelection().then(() => {
        const originalText = copyBtn.textContent!;
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.textContent = originalText;
        }, 1500);
      });
      return;
    }

    let text: string;
    if (isVirtualScrollActive) {
      text = virtualScroller.getFullText();
    } else if (lastResultText) {
      text = lastResultText;
    } else {
      text = output.textContent!;
    }

    navigator.clipboard.writeText(text).then(() => {
      const originalText = copyBtn.textContent!;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = originalText;
      }, 1500);
    });
  });

  downloadBtn.addEventListener('click', () => {
    const format = formatSelect.value;
    let text: string | undefined;

    if (format === 'json') {
      text = lastResultText || output.textContent || undefined;
    } else if (format === 'csv') {
      text = dataGrid.api.getCSV('all') || undefined;
    }

    if (!text) {
      api.showError('데이터가 없습니다.');
      return;
    }

    const filename = `output.${format === 'json' ? 'json' : 'csv'}`;
    downloadText(text, filename);
  });

  const el = panel as unknown as OutputPanelElement;
  el.api = api;
  return el;
}
