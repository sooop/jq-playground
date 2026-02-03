import { readFile } from '../core/file-handler.js';
import { handleTabKey } from '../utils/keyboard.js';
import { Storage } from '../utils/storage.js';
import { csvToJson, detectDelimiter } from '../core/csv-parser.js';
import { extractJson, needsJsonExtraction, tryFormatJson } from '../utils/json-extractor.js';

export function createInputPanel(onInputChange, onExecuteQuery) {
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
        <button id="inputHistoryBtn">History</button>
        <input type="file" id="fileInput" accept=".json,.txt,.csv,.tsv" style="display: none;">
      </div>
    </div>
    <div class="panel-content">
      <textarea id="input" placeholder="Paste JSON here or drag & drop a file..."></textarea>
      <div class="drag-overlay" id="dragOverlay">Drop file here</div>
    </div>
  `;

  const textarea = panel.querySelector('#input');
  const fileInput = panel.querySelector('#fileInput');
  const panelContent = panel.querySelector('.panel-content');
  const dragOverlay = panel.querySelector('#dragOverlay');
  const formatLabel = panel.querySelector('#inputFormat');
  const parseCsvBtn = panel.querySelector('#parseCsvBtn');

  // Track current file name
  let currentFileName = null;

  // Debounce timer for auto-save
  let saveDebounceTimer = null;

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

  const historyBtn = panel.querySelector('#inputHistoryBtn');
  const sortToggleBtn = historyDropdown.querySelector('#sortToggleBtn');
  const sortLabel = sortToggleBtn.querySelector('.sort-label');
  const searchInput = historyDropdown.querySelector('#inputHistorySearch');
  const historyList = historyDropdown.querySelector('#inputHistoryList');
  const clearAllBtn = historyDropdown.querySelector('#clearAllInputHistory');

  // Sort state (default: timestamp)
  let currentSortBy = localStorage.getItem('jq-input-sort') || 'timestamp';
  sortLabel.textContent = currentSortBy === 'timestamp' ? '등록순' : '사용순';

  // Auto-save input (20 second debounce)
  const autoSaveInput = () => {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(async () => {
      const content = textarea.value.trim();
      if (content) {
        await Storage.saveInputHistory(content, currentFileName);
      }
    }, 20000);
  };

  // Format detailed timestamp (YYYY-MM-DD HH:MM:SS)
  const formatDetailedTimestamp = (iso) => {
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
      items.sort((a, b) => new Date(b[currentSortBy]) - new Date(a[currentSortBy]));
    } else {
      items = await Storage.getInputHistory(50, currentSortBy);
    }

    if (items.length === 0) {
      historyList.innerHTML = '<div class="dropdown-item">No history found</div>';
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
    historyList.querySelectorAll('.input-history-item').forEach(item => {
      const id = parseInt(item.dataset.id);
      item.addEventListener('click', async (e) => {
        if (e.target.classList.contains('delete-input-history')) {
          return; // Handled by delete button
        }

        const historyItem = items.find(h => h.id === id);
        if (historyItem) {
          // 자동 포맷팅 적용
          const formattedContent = tryFormatJson(historyItem.content);
          textarea.value = formattedContent;
          currentFileName = historyItem.fileName;
          onInputChange();
          historyDropdown.style.display = 'none';

          // Content가 변경되었으면 DB 업데이트 (timestamp 유지)
          if (formattedContent !== historyItem.content) {
            await Storage.updateInputHistoryContent(id, formattedContent);
          } else {
            // 변경 없으면 lastUsed만 업데이트
            await Storage.saveInputHistory(formattedContent, historyItem.fileName);
          }
        }
      });
    });

    // Delete buttons
    historyList.querySelectorAll('.delete-input-history').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(e.target.dataset.id);
        await Storage.deleteInputHistory(id);
        loadHistory(searchInput.value);
      });
    });
  };

  // Format file size
  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Update format label
  const updateFormatLabel = (fileName) => {
    if (!fileName) {
      formatLabel.textContent = '';
      return;
    }
    const ext = fileName.split('.').pop().toUpperCase();
    if (['CSV', 'TSV'].includes(ext)) {
      formatLabel.textContent = `(${ext} → JSON)`;
    } else {
      formatLabel.textContent = '';
    }
  };

  // Detect if text looks like CSV
  const isCsvLike = (text) => {
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
  const convertCsvToJson = async (text, fileName) => {
    try {
      const jsonData = csvToJson(text, {
        hasHeader: true,
        inferTypes: false
      });
      return JSON.stringify(jsonData, null, 2);
    } catch (error) {
      throw new Error('CSV parsing failed: ' + error.message);
    }
  };

  // Format JSON function
  const formatJson = () => {
    const value = textarea.value.trim();
    if (!value) return;

    try {
      const parsed = JSON.parse(value);
      textarea.value = JSON.stringify(parsed, null, 4);
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
        alert('Invalid JSON: ' + error.message);
      }
    }
  };

  // Event listeners
  textarea.addEventListener('input', () => {
    onInputChange();
    autoSaveInput();

    // Show size warning
    const size = new Blob([textarea.value]).size;
    if (size > 2.5 * 1024 * 1024) {  // 2.5MB warning
      formatLabel.textContent = `(${(size / 1024 / 1024).toFixed(1)}MB - 자동실행 제한 임박)`;
      formatLabel.style.color = 'var(--error-color)';
    } else if (size > 500 * 1024) {
      formatLabel.textContent = `(${(size / 1024).toFixed(0)}KB)`;
      formatLabel.style.color = 'var(--text-tertiary)';
    } else if (formatLabel.textContent.includes('KB') || formatLabel.textContent.includes('MB')) {
      // Clear size label if it was showing size info
      formatLabel.textContent = '';
      formatLabel.style.color = '';
    }
  });

  textarea.addEventListener('paste', (e) => {
    setTimeout(() => {
      const text = textarea.value;
      const size = new Blob([text]).size;
      const AUTO_EXTRACT_SIZE = 100 * 1024; // 100KB

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

  textarea.addEventListener('keydown', (e) => {
    // Ctrl+Enter: Execute query
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      if (onExecuteQuery) {
        onExecuteQuery();
      }
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

  panel.querySelector('#formatJsonBtn').addEventListener('click', formatJson);

  panel.querySelector('#clearInputBtn').addEventListener('click', () => {
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
      alert(error.message);
    }
  });

  panel.querySelector('#loadFileBtn').addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      let content = await readFile(file);
      const ext = file.name.split('.').pop().toLowerCase();
      const size = new Blob([content]).size;
      const AUTO_EXTRACT_SIZE = 100 * 1024; // 100KB

      // Auto-convert CSV/TSV to JSON
      if (ext === 'csv' || ext === 'tsv') {
        try {
          content = await convertCsvToJson(content, file.name);
          currentFileName = file.name;
          updateFormatLabel(file.name);
        } catch (error) {
          alert(error.message + '\n\nShowing original content.');
          currentFileName = file.name;
          updateFormatLabel(null);
        }
      } else {
        currentFileName = file.name;
        updateFormatLabel(null);

        // JSON 추출 시도
        if (needsJsonExtraction(content)) {
          const shouldExtract = size <= AUTO_EXTRACT_SIZE ||
            confirm('유효하지 않은 JSON이 감지되었습니다. JSON 객체를 추출하시겠습니까?');

          if (shouldExtract) {
            const extracted = extractJson(content);
            if (extracted) {
              content = extracted;
            } else if (size > AUTO_EXTRACT_SIZE) {
              alert('유효한 JSON 객체를 찾을 수 없습니다.');
            }
          }
        } else {
          // 유효한 JSON이면 자동 포맷팅
          content = tryFormatJson(content);
        }
      }

      textarea.value = content;
      onInputChange();

      // Immediately save file loads (포맷팅된 데이터 저장)
      await Storage.saveInputHistory(content, currentFileName);
    } catch (error) {
      alert(error.message);
    }
    e.target.value = '';
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
  let searchDebounce = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
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

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!historyDropdown.contains(e.target) && e.target !== historyBtn) {
      historyDropdown.style.display = 'none';
    }
  });

  // ESC key to close dropdown
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && historyDropdown.style.display !== 'none') {
      historyDropdown.style.display = 'none';
    }
  });

  // Drag and drop
  panelContent.addEventListener('dragover', (e) => {
    e.preventDefault();
    dragOverlay.classList.add('active');
  });

  panelContent.addEventListener('dragleave', (e) => {
    if (e.target === panelContent) {
      dragOverlay.classList.remove('active');
    }
  });

  panelContent.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragOverlay.classList.remove('active');

    const file = e.dataTransfer.files[0];
    if (!file) return;

    try {
      let content = await readFile(file);
      const ext = file.name.split('.').pop().toLowerCase();
      const size = new Blob([content]).size;
      const AUTO_EXTRACT_SIZE = 100 * 1024; // 100KB

      // Auto-convert CSV/TSV to JSON
      if (ext === 'csv' || ext === 'tsv') {
        try {
          content = await convertCsvToJson(content, file.name);
          currentFileName = file.name;
          updateFormatLabel(file.name);
        } catch (error) {
          alert(error.message + '\n\nShowing original content.');
          currentFileName = file.name;
          updateFormatLabel(null);
        }
      } else {
        currentFileName = file.name;
        updateFormatLabel(null);

        // JSON 추출 시도
        if (needsJsonExtraction(content)) {
          const shouldExtract = size <= AUTO_EXTRACT_SIZE ||
            confirm('유효하지 않은 JSON이 감지되었습니다. JSON 객체를 추출하시겠습니까?');

          if (shouldExtract) {
            const extracted = extractJson(content);
            if (extracted) {
              content = extracted;
            } else if (size > AUTO_EXTRACT_SIZE) {
              alert('유효한 JSON 객체를 찾을 수 없습니다.');
            }
          }
        } else {
          // 유효한 JSON이면 자동 포맷팅
          content = tryFormatJson(content);
        }
      }

      textarea.value = content;
      onInputChange();

      // Immediately save file drops (포맷팅된 데이터 저장)
      await Storage.saveInputHistory(content, currentFileName);
    } catch (error) {
      alert(error.message);
    }
  });

  // API
  panel.api = {
    getCurrentFileName: () => currentFileName,
    restoreInput: (content, fileName) => {
      textarea.value = content;
      currentFileName = fileName;
    },
    setAutoPlayIndicator: (enabled) => {
      const chip = panel.querySelector('#autoPlayChip');
      chip.style.display = enabled ? 'inline-block' : 'none';
    }
  };

  return panel;
}
