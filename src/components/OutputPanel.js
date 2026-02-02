import { jsonToHTML, jsonToCSV } from '../core/csv-converter.js';
import { downloadText } from '../core/file-handler.js';

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
  let lastCsvCache = null;
  let errorTimeout = null;
  let autoPlayEnabled = true;
  let searchMatches = [];
  let currentMatchIndex = -1;
  let originalOutputHTML = '';
  let isInErrorState = false;

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
    // Restore original content
    if (originalOutputHTML && formatSelect.value === 'json') {
      output.innerHTML = '';
      output.textContent = originalOutputHTML;
    }
  }

  function performSearch() {
    const query = searchInput.value;
    if (!query || !lastResultData) {
      clearSearch();
      return;
    }

    // Store original text content for JSON mode
    if (formatSelect.value === 'json') {
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
    } else {
      // For CSV/table view, simple text search
      searchInfo.textContent = 'Search works in JSON view';
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
    if (searchMatches.length === 0) return;
    currentMatchIndex = (currentMatchIndex + 1) % searchMatches.length;
    highlightMatches();
    updateSearchInfo();
  }

  function goToPrevMatch() {
    if (searchMatches.length === 0) return;
    currentMatchIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    highlightMatches();
    updateSearchInfo();
  }

  // Search event listeners
  searchInput.addEventListener('input', () => {
    performSearch();
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

    showResult: (data, format, executionTime) => {
      lastResultData = data;
      lastCsvCache = null; // Invalidate cache on new data
      originalOutputHTML = ''; // Reset for new results
      clearSearch();

      // 에러 상태 및 stale 스타일 제거
      isInErrorState = false;
      output.classList.remove('stale-result-subtle');

      const isArray = Array.isArray(data);

      if (format === 'json') {
        output.textContent = JSON.stringify(data, null, 2);
      } else if (format === 'csv') {
        output.innerHTML = jsonToHTML(data, isArray);
        // Pre-cache CSV conversion when in CSV view
        lastCsvCache = jsonToCSV(data);
      }

      // Flash effect
      output.classList.remove('flash');
      void output.offsetWidth; // reflow trigger
      output.classList.add('flash');

      // Update last run time
      const now = new Date();
      lastRunTime.textContent = now.toLocaleTimeString();

      // Update stats bar
      statsBar.innerHTML = generateStats(data, executionTime);
      statsBar.style.display = 'flex';

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
      if (lastResultData !== null) {
        // 현재 format으로 이전 결과를 다시 렌더링
        const currentFormat = formatSelect.value;
        const isArray = Array.isArray(lastResultData);

        if (currentFormat === 'json') {
          output.textContent = JSON.stringify(lastResultData, null, 2);
        } else if (currentFormat === 'csv') {
          output.innerHTML = jsonToHTML(lastResultData, isArray);
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
      lastCsvCache = null;
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

    if (format === 'csv' && lastResultData) {
      // Use cache if available
      if (!lastCsvCache) {
        lastCsvCache = jsonToCSV(lastResultData);
      }
      text = lastCsvCache;
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

  downloadBtn.addEventListener('click', () => {
    const format = formatSelect.value;
    let text;

    if (format === 'json') {
      text = output.textContent;
    } else if (format === 'csv') {
      if (lastResultData) {
        // Use cache if available
        if (!lastCsvCache) {
          lastCsvCache = jsonToCSV(lastResultData);
        }
        text = lastCsvCache;
      } else {
        api.showError('데이터가 없습니다.');
        return;
      }
    }

    const filename = `output.${format === 'json' ? 'json' : 'csv'}`;
    downloadText(text, filename);
  });

  panel.api = api;
  return panel;
}
