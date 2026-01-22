import { readFile } from '../core/file-handler.js';
import { handleTabKey } from '../utils/keyboard.js';
import { Storage } from '../utils/storage.js';
import { csvToJson, detectDelimiter } from '../core/csv-parser.js';

export function createInputPanel(onInputChange) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="panel-header">
      <span class="panel-title">
        Input <span id="inputFormat" class="input-format-label"></span>
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
      <button id="clearAllInputHistory" class="clear-all-btn">Clear All</button>
    </div>
    <div class="dropdown-list" id="inputHistoryList"></div>
  `;
  document.body.appendChild(historyDropdown);

  const historyBtn = panel.querySelector('#inputHistoryBtn');
  const searchInput = historyDropdown.querySelector('#inputHistorySearch');
  const historyList = historyDropdown.querySelector('#inputHistoryList');
  const clearAllBtn = historyDropdown.querySelector('#clearAllInputHistory');

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

  // Load and display history
  const loadHistory = async (searchTerm = '') => {
    let items;
    if (searchTerm) {
      items = await Storage.searchInputHistory(searchTerm);
    } else {
      items = await Storage.getInputHistory(50);
    }

    if (items.length === 0) {
      historyList.innerHTML = '<div class="dropdown-item">No history found</div>';
      return;
    }

    historyList.innerHTML = items.map(item => {
      const date = new Date(item.timestamp).toLocaleString();
      const size = formatFileSize(item.size);
      const preview = item.content.substring(0, 80).replace(/\n/g, ' ');

      return `
        <div class="dropdown-item input-history-item" data-id="${item.id}">
          <div class="input-history-content">
            <div class="input-history-preview">${preview}...</div>
            <div class="input-history-meta">${size} • ${date}</div>
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
          textarea.value = historyItem.content;
          currentFileName = historyItem.fileName;
          onInputChange();
          historyDropdown.style.display = 'none';

          // Update lastUsed
          await Storage.saveInputHistory(historyItem.content, historyItem.fileName);
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
      alert('Invalid JSON: ' + error.message);
    }
  };

  // Event listeners
  textarea.addEventListener('input', () => {
    onInputChange();
    autoSaveInput();
  });

  textarea.addEventListener('paste', (e) => {
    setTimeout(() => {
      const text = textarea.value;
      if (isCsvLike(text)) {
        parseCsvBtn.style.display = 'inline-block';
      } else {
        parseCsvBtn.style.display = 'none';
      }
    }, 10);
  });

  textarea.addEventListener('keydown', (e) => {
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
      }

      textarea.value = content;
      onInputChange();

      // Immediately save file loads
      await Storage.saveInputHistory(content, currentFileName);
    } catch (error) {
      alert(error.message);
    }
    e.target.value = '';
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
      }

      textarea.value = content;
      onInputChange();

      // Immediately save file drops
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
    }
  };

  return panel;
}
