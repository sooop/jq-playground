import { jsonToHTML, jsonToCSV } from '../core/csv-converter.js';
import { downloadText } from '../core/file-handler.js';
import { VirtualScroller } from '../utils/virtual-scroller.js';

export function createOutputPanel() {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="panel-header">
      <span class="panel-title">Output <span id="lastRunTime" style="font-weight:normal;color:var(--text-tertiary);font-size:11px;margin-left:8px;"></span></span>
      <div class="panel-actions">
        <button id="autoPlayBtn" class="auto-play-btn active" title="Pause auto-execute (Ctrl+Shift+E)">⏸</button>
        <select id="formatSelect">
          <option value="json">JSON</option>
          <option value="csv">CSV</option>
        </select>
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
    </div>
    <div class="error-toast" id="errorToast"></div>
  `;

  const output = panel.querySelector('#output');
  const errorBanner = panel.querySelector('#errorBanner');
  const autoPlayBtn = panel.querySelector('#autoPlayBtn');
  const formatSelect = panel.querySelector('#formatSelect');
  const copyBtn = panel.querySelector('#copyBtn');
  const downloadBtn = panel.querySelector('#downloadBtn');
  const lastRunTime = panel.querySelector('#lastRunTime');
  const statsBar = panel.querySelector('#statsBar');
  const searchBar = panel.querySelector('#searchBar');
  const searchInput = panel.querySelector('#searchInput');
  const searchInfo = panel.querySelector('#searchInfo');
  const searchPrevBtn = panel.querySelector('#searchPrevBtn');
  const searchNextBtn = panel.querySelector('#searchNextBtn');
  const searchCloseBtn = panel.querySelector('#searchCloseBtn');

  let lastResultData = null;
  let lastResultText = null;  // Worker에서 받은 JSON.stringify 결과 (텍스트)
  let lastCsvCache = null;
  let errorTimeout = null;
  let autoPlayEnabled = true;
  let searchMatches = [];
  let currentMatchIndex = -1;
  let originalOutputHTML = '';
  let isInErrorState = false;
  let searchDebounceTimer = null;

  // Virtual scroller for large JSON output
  const virtualScroller = new VirtualScroller(output);
  let isVirtualScrollActive = false;

  // Helper function to generate stats
  function generateStats(data, executionTime) {
    const stats = [];

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
      const keys = Object.keys(data);
      stats.push(`<span class="stat-item">${keys.length} keys</span>`);
    } else if (typeof data === 'string') {
      stats.push(`<span class="stat-item">${data.length} chars</span>`);
    } else if (typeof data === 'number') {
      stats.push(`<span class="stat-item">${data}</span>`);
    }

    return stats.join('');
  }

  // Flash effect cleanup
  output.addEventListener('animationend', () => {
    output.classList.remove('flash');
  });

  // Search functions
  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function toggleSearch(show) {
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
    if (!query || (!lastResultData && !lastResultText)) {
      clearSearch();
      return;
    }

    if (formatSelect.value !== 'json') {
      searchInfo.textContent = 'Search works in JSON view';
      return;
    }

    // 가상 스크롤 모드: 스크롤러 내부 검색 사용
    if (isVirtualScrollActive) {
      const { total } = virtualScroller.search(query);
      if (total > 0) {
        const info = virtualScroller.getMatchInfo();
        searchInfo.textContent = `${info.current} of ${info.total}`;
      } else {
        searchInfo.textContent = 'No matches';
      }
      return;
    }

    // 일반 모드: 기존 검색 로직
    if (!originalOutputHTML) {
      originalOutputHTML = output.textContent;
    }

    const text = originalOutputHTML;
    const regex = new RegExp(escapeRegExp(query), 'gi');
    searchMatches = [];
    let match;

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

  function escapeHtmlText(text) {
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
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      performSearch();
    }, 200);
  });

  searchInput.addEventListener('keydown', (e) => {
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
  panel.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'f') {
      e.preventDefault();
      toggleSearch(true);
    }
  });

  // Also allow Ctrl+F when focus is in the panel content area
  output.setAttribute('tabindex', '0');

  // Public methods
  const api = {
    showLoading: () => {
      output.innerHTML = '<span class="loading">Processing...</span>';
    },

    /**
     * 기존 호환 API: raw 객체를 받아서 메인스레드에서 stringify
     * (폴백 전용 — Worker가 실패했을 때만 사용)
     */
    showResult: (data, format, executionTime) => {
      lastResultData = data;
      lastResultText = null;
      lastCsvCache = null;
      originalOutputHTML = '';
      clearSearch();

      isInErrorState = false;
      output.classList.remove('stale-result-subtle');

      if (format === 'json') {
        const text = JSON.stringify(data, null, 2);
        lastResultText = text;
        virtualScroller.setText(text);
        isVirtualScrollActive = virtualScroller.active;
      } else if (format === 'csv') {
        isVirtualScrollActive = false;
        output.innerHTML = jsonToHTML(data, Array.isArray(data));
        lastCsvCache = jsonToCSV(data);
      }

      output.classList.remove('flash');
      void output.offsetWidth;
      output.classList.add('flash');

      const now = new Date();
      lastRunTime.textContent = now.toLocaleTimeString();
      statsBar.innerHTML = generateStats(data, executionTime);
      statsBar.style.display = 'flex';
      api.hideError();
    },

    /**
     * Worker에서 받은 stringify된 텍스트로 결과 표시 (메인스레드 stringify 제거)
     */
    showResultText: (resultText, format, executionTime) => {
      lastResultData = null;
      lastResultText = resultText;
      lastCsvCache = null;
      originalOutputHTML = '';
      clearSearch();

      isInErrorState = false;
      output.classList.remove('stale-result-subtle');

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
      statsHtml += `<span class="stat-item stat-type">json</span>`;
      if (isVirtualScrollActive) {
        statsHtml += `<span class="stat-item">${virtualScroller.totalLines.toLocaleString()} lines</span>`;
      }
      statsBar.innerHTML = statsHtml;
      statsBar.style.display = 'flex';
      api.hideError();
    },

    /**
     * Worker에서 포맷 변환된 결과 표시 (formatResult 응답)
     */
    showFormattedResult: (content, format, csvCache, executionTime) => {
      originalOutputHTML = '';
      clearSearch();

      isInErrorState = false;
      output.classList.remove('stale-result-subtle');

      if (format === 'json') {
        lastResultText = content;
        virtualScroller.setText(content);
        isVirtualScrollActive = virtualScroller.active;
      } else if (format === 'csv') {
        isVirtualScrollActive = false;
        output.innerHTML = content; // HTML table
        if (csvCache) lastCsvCache = csvCache;
      }

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

    showError: (message, autoHideDuration = 5000) => {
      const errorToast = panel.querySelector('#errorToast');
      errorToast.textContent = message;
      errorToast.classList.add('show');
      isInErrorState = true;

      if (errorTimeout) clearTimeout(errorTimeout);

      if (autoHideDuration !== false) {
        errorTimeout = setTimeout(() => {
          api.hideError();
        }, autoHideDuration);
      }

      // 이전 결과가 있으면 다시 렌더링하여 유지
      if (lastResultText !== null || lastResultData !== null) {
        const currentFormat = formatSelect.value;

        // 에러 상태에서는 가상 스크롤 비활성화하고 단순 텍스트로 표시
        if (currentFormat === 'json') {
          if (lastResultText) {
            isVirtualScrollActive = false;
            output.textContent = lastResultText;
          } else if (lastResultData) {
            isVirtualScrollActive = false;
            output.textContent = JSON.stringify(lastResultData, null, 2);
          }
        } else if (currentFormat === 'csv') {
          if (lastResultData) {
            output.innerHTML = jsonToHTML(lastResultData, Array.isArray(lastResultData));
          }
        }

        output.classList.add('stale-result-subtle');

        // stats bar에 "이전 결과" 표시 추가 (중복 방지)
        if (!statsBar.querySelector('.prev-result-label')) {
          const prevLabel = '<span class="prev-result-label">이전 결과</span>';
          statsBar.innerHTML = prevLabel + statsBar.innerHTML;
        }
      } else {
        output.textContent = '';
      }
    },

    hideError: () => {
      if (errorTimeout) clearTimeout(errorTimeout);
      const errorToast = panel.querySelector('#errorToast');
      errorToast.classList.remove('show');
      errorBanner.classList.remove('show');
      isInErrorState = false;
      output.classList.remove('stale-result-subtle');

      // Remove prev-result-label from statsBar
      const prevLabel = statsBar.querySelector('.prev-result-label');
      if (prevLabel) {
        prevLabel.remove();
      }
    },

    getFormat: () => formatSelect.value,

    clear: () => {
      output.textContent = '';
      lastResultData = null;
      lastResultText = null;
      lastCsvCache = null;
      isVirtualScrollActive = false;
      virtualScroller.setLines([]);
      statsBar.innerHTML = '';
      statsBar.style.display = 'none';
      isInErrorState = false;
      output.classList.remove('stale-result-subtle');
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
      if (autoPlayEnabled && panel.onAutoPlayToggle) {
        panel.onAutoPlayToggle(autoPlayEnabled);
      }

      return autoPlayEnabled;
    }
  };

  // Event listeners
  autoPlayBtn.addEventListener('click', () => {
    api.toggleAutoPlay();
  });

  copyBtn.addEventListener('click', () => {
    const format = formatSelect.value;
    let text;

    if (format === 'csv' && lastCsvCache) {
      text = lastCsvCache;
    } else if (format === 'csv' && lastResultData) {
      lastCsvCache = jsonToCSV(lastResultData);
      text = lastCsvCache;
    } else if (isVirtualScrollActive) {
      text = virtualScroller.getFullText();
    } else if (lastResultText) {
      text = lastResultText;
    } else {
      text = output.textContent;
    }

    navigator.clipboard.writeText(text).then(() => {
      const originalText = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = originalText;
      }, 1500);
    });
  });

  downloadBtn.addEventListener('click', async () => {
    const format = formatSelect.value;
    let text;

    if (format === 'json') {
      text = lastResultText || output.textContent;
    } else if (format === 'csv') {
      if (lastCsvCache) {
        text = lastCsvCache;
      } else if (lastResultData) {
        lastCsvCache = jsonToCSV(lastResultData);
        text = lastCsvCache;
      } else {
        // Worker에서 CSV 생성 시도
        try {
          downloadBtn.textContent = 'Generating...';
          downloadBtn.disabled = true;
          const { jqEngine } = await import('../core/jq-engine.js');
          const result = await jqEngine.formatResult('csv');
          lastCsvCache = result.csv;
          text = result.csv;
        } catch {
          api.showError('CSV 생성에 실패했습니다.');
          downloadBtn.textContent = 'Download';
          downloadBtn.disabled = false;
          return;
        } finally {
          downloadBtn.textContent = 'Download';
          downloadBtn.disabled = false;
        }
      }
    }

    if (!text) {
      api.showError('데이터가 없습니다.');
      return;
    }

    const filename = `output.${format === 'json' ? 'json' : 'csv'}`;
    downloadText(text, filename);
  });

  panel.api = api;
  return panel;
}
