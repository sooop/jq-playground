import { Storage } from '../utils/storage.js';
import { filterFunctions } from '../core/jq-functions.js';

const MAX_HISTORY = 100;

// Helper function to read file
function readFileContent(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

// Fuzzy matching algorithm
function fuzzyMatch(pattern, text) {
  if (!pattern) return true;

  pattern = pattern.toLowerCase();
  text = text.toLowerCase();

  let patternIdx = 0;
  let textIdx = 0;
  let score = 0;
  let consecutiveMatch = 0;

  while (patternIdx < pattern.length && textIdx < text.length) {
    if (pattern[patternIdx] === text[textIdx]) {
      score += 1 + consecutiveMatch;
      consecutiveMatch++;
      patternIdx++;
    } else {
      consecutiveMatch = 0;
    }
    textIdx++;
  }

  if (patternIdx === pattern.length) {
    return { match: true, score };
  }

  return { match: false, score: 0 };
}

export function createQueryPanel(onQueryChange, onShowSaveModal, onExecute) {
  const panel = document.createElement('div');
  panel.className = 'panel';

  panel.innerHTML = `
    <div class="panel-header">
      <span class="panel-title">Query</span>
      <div class="panel-actions history-dropdown">
        <button id="executeQueryBtn" class="primary" title="Execute query (Ctrl+Enter)">Execute</button>
        <button id="saveQueryBtn">Save</button>
        <button id="savedQueriesBtn">Saved</button>
        <button id="historyBtn">History</button>
        <button id="clearQueryBtn">Clear</button>
        <input type="file" id="importQueriesFile" accept=".json" style="display: none;">
        <input type="file" id="importHistoryFile" accept=".json" style="display: none;">
        <div class="history-list" id="historyList">
          <div class="history-header">
            <input type="text" class="history-search" id="historySearch" placeholder="Search history..." />
            <div class="history-actions">
              <button id="importHistoryBtn" title="Import history">Import</button>
              <button id="exportHistoryBtn" title="Export history">Export</button>
            </div>
          </div>
          <div class="history-content" id="historyContent"></div>
        </div>
        <div class="history-list saved-queries-list" id="savedQueriesList">
          <div class="saved-queries-header">
            <span class="saved-queries-title">Saved Queries</span>
            <div class="saved-queries-actions">
              <button id="importQueriesBtn" title="Import saved queries">Import</button>
              <button id="exportQueriesBtn" title="Export saved queries">Export</button>
            </div>
          </div>
          <div class="saved-queries-content" id="savedQueriesContent"></div>
        </div>
      </div>
    </div>
    <div class="panel-content autocomplete-container">
      <textarea id="query" placeholder="Enter jq query...">.users[] | select(.age > 25)</textarea>
      <div class="autocomplete-list" id="autocompleteList"></div>
    </div>
  `;

  const textarea = panel.querySelector('#query');
  const historyList = panel.querySelector('#historyList');
  const historySearch = panel.querySelector('#historySearch');
  const historyContent = panel.querySelector('#historyContent');
  const savedQueriesList = panel.querySelector('#savedQueriesList');
  const savedQueriesContent = panel.querySelector('#savedQueriesContent');
  const autocompleteList = panel.querySelector('#autocompleteList');

  // State
  let queryHistory = Storage.getHistory();
  let savedQueries = Storage.getSavedQueries();
  let autocompleteItems = [];
  let selectedAutocompleteIndex = -1;

  // Event listeners
  textarea.addEventListener('input', (e) => {
    onQueryChange();
    updateAutocomplete();
  });

  textarea.addEventListener('keydown', (e) => {
    // Handle autocomplete navigation
    if (autocompleteList.classList.contains('show')) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedAutocompleteIndex = Math.min(selectedAutocompleteIndex + 1, autocompleteItems.length - 1);
        renderAutocomplete();
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedAutocompleteIndex = Math.max(selectedAutocompleteIndex - 1, 0);
        renderAutocomplete();
        return;
      } else if (e.key === 'Enter' && selectedAutocompleteIndex >= 0) {
        e.preventDefault();
        applyAutocomplete(autocompleteItems[selectedAutocompleteIndex]);
        return;
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hideAutocomplete();
        return;
      }
    }

    // Ctrl+Enter: Execute query immediately
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      if (onExecute) {
        onExecute();
      }
      return;
    }
    handleTabKey(e);
  });

  panel.querySelector('#executeQueryBtn').addEventListener('click', () => {
    if (onExecute) {
      onExecute();
    }
  });

  panel.querySelector('#clearQueryBtn').addEventListener('click', () => {
    textarea.value = '';
    onQueryChange();
  });

  panel.querySelector('#saveQueryBtn').addEventListener('click', () => {
    const query = textarea.value.trim();
    if (!query) {
      alert('Please enter a query to save');
      return;
    }
    onShowSaveModal(query);
  });

  panel.querySelector('#historyBtn').addEventListener('click', () => {
    savedQueriesList.classList.remove('show');
    historyList.classList.toggle('show');
    if (historyList.classList.contains('show')) {
      historySearch.focus();
    }
  });

  // History search
  historySearch.addEventListener('input', (e) => {
    renderHistory(e.target.value);
  });

  // History search - prevent closing dropdown on click
  historySearch.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // Export history
  panel.querySelector('#exportHistoryBtn').addEventListener('click', () => {
    if (queryHistory.length === 0) {
      alert('No history to export');
      return;
    }

    const exportData = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      history: queryHistory
    };

    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jq-history-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Import history
  const importHistoryFile = panel.querySelector('#importHistoryFile');

  panel.querySelector('#importHistoryBtn').addEventListener('click', () => {
    importHistoryFile.click();
  });

  importHistoryFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const content = await readFileContent(file);
      const importData = JSON.parse(content);

      if (!importData.history || !Array.isArray(importData.history)) {
        alert('Invalid file format');
        return;
      }

      // Validate history items
      const validHistory = importData.history.filter(q => typeof q === 'string' && q.trim());

      if (validHistory.length === 0) {
        alert('No valid history found in file');
        return;
      }

      // Ask user about merge strategy
      const shouldMerge = confirm(
        `Found ${validHistory.length} history items.\n\n` +
        `OK: Merge with existing history\n` +
        `Cancel: Replace all existing history`
      );

      if (shouldMerge) {
        // Merge: Add new items (avoiding duplicates)
        const existingSet = new Set(queryHistory);
        const newItems = validHistory.filter(q => !existingSet.has(q));
        queryHistory = [...newItems, ...queryHistory];
      } else {
        // Replace
        queryHistory = validHistory;
      }

      // Keep within MAX_HISTORY limit
      if (queryHistory.length > MAX_HISTORY) {
        queryHistory = queryHistory.slice(0, MAX_HISTORY);
      }

      Storage.saveHistory(queryHistory);
      renderHistory(historySearch.value);

      alert(`Successfully imported ${validHistory.length} history items`);
    } catch (error) {
      alert('Failed to import history: ' + error.message);
    }

    e.target.value = '';
  });

  panel.querySelector('#savedQueriesBtn').addEventListener('click', () => {
    historyList.classList.remove('show');
    savedQueriesList.classList.toggle('show');
  });

  panel.querySelector('#exportQueriesBtn').addEventListener('click', () => {
    if (savedQueries.length === 0) {
      alert('No saved queries to export');
      return;
    }

    const exportData = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      queries: savedQueries
    };

    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jq-queries-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const importFileInput = panel.querySelector('#importQueriesFile');

  panel.querySelector('#importQueriesBtn').addEventListener('click', () => {
    importFileInput.click();
  });

  importFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const content = await readFileContent(file);
      const importData = JSON.parse(content);

      if (!importData.queries || !Array.isArray(importData.queries)) {
        alert('Invalid file format');
        return;
      }

      // Validate and merge queries
      const validQueries = importData.queries.filter(q =>
        q.name && q.query && typeof q.name === 'string' && typeof q.query === 'string'
      );

      if (validQueries.length === 0) {
        alert('No valid queries found in file');
        return;
      }

      // Ask user about merge strategy
      const shouldMerge = confirm(
        `Found ${validQueries.length} queries.\n\n` +
        `OK: Merge with existing queries\n` +
        `Cancel: Replace all existing queries`
      );

      if (shouldMerge) {
        // Merge: Add new queries with updated IDs and timestamps
        const newQueries = validQueries.map(q => ({
          ...q,
          id: Date.now() + Math.random(),
          timestamp: new Date().toISOString()
        }));
        savedQueries = [...newQueries, ...savedQueries];
      } else {
        // Replace: Use imported queries with new IDs
        savedQueries = validQueries.map(q => ({
          ...q,
          id: Date.now() + Math.random(),
          timestamp: q.timestamp || new Date().toISOString()
        }));
      }

      Storage.saveSavedQueries(savedQueries);
      renderSavedQueries();

      alert(`Successfully imported ${validQueries.length} queries`);
    } catch (error) {
      alert('Failed to import queries: ' + error.message);
    }

    e.target.value = '';
  });

  // Close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    const dropdown = panel.querySelector('.history-dropdown');
    if (!dropdown.contains(e.target)) {
      historyList.classList.remove('show');
      savedQueriesList.classList.remove('show');
    }
  });

  // Public methods
  const api = {
    getQuery: () => textarea.value.trim(),

    addToHistory: (query) => {
      if (!query || query === queryHistory[0]) return;

      queryHistory = queryHistory.filter(q => q !== query);
      queryHistory.unshift(query);

      if (queryHistory.length > MAX_HISTORY) {
        queryHistory = queryHistory.slice(0, MAX_HISTORY);
      }

      Storage.saveHistory(queryHistory);
      renderHistory();
    },

    saveQuery: (name, query) => {
      const savedQuery = {
        id: Date.now(),
        name: name,
        query: query,
        timestamp: new Date().toISOString()
      };

      savedQueries.unshift(savedQuery);
      Storage.saveSavedQueries(savedQueries);
      renderSavedQueries();
    }
  };

  function renderHistory(searchTerm = '') {
    if (queryHistory.length === 0) {
      historyContent.innerHTML = '<div class="history-item" style="cursor: default; color: #999;">No history</div>';
      return;
    }

    // Filter and sort by fuzzy match score
    let filteredHistory = queryHistory;
    if (searchTerm) {
      filteredHistory = queryHistory
        .map(q => ({ query: q, ...fuzzyMatch(searchTerm, q) }))
        .filter(item => item.match)
        .sort((a, b) => b.score - a.score)
        .map(item => item.query);
    }

    if (filteredHistory.length === 0) {
      historyContent.innerHTML = '<div class="history-item" style="cursor: default; color: #999;">No matching history</div>';
      return;
    }

    historyContent.innerHTML = filteredHistory.map(q =>
      `<div class="history-item" data-query="${escapeHtml(q)}">${escapeHtml(q)}</div>`
    ).join('');

    historyContent.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', () => {
        const query = item.dataset.query;
        if (query) {
          textarea.value = query;
          historyList.classList.remove('show');
          historySearch.value = '';
          onQueryChange();
        }
      });
    });
  }

  function renderSavedQueries() {
    if (savedQueries.length === 0) {
      savedQueriesContent.innerHTML = '<div class="saved-query-item" style="cursor: default; color: #999; padding: 12px;">No saved queries</div>';
      return;
    }

    savedQueriesContent.innerHTML = savedQueries.map(sq => {
      const date = new Date(sq.timestamp);
      const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
      const preview = sq.query.length > 50 ? sq.query.substring(0, 50) + '...' : sq.query;

      return `
        <div class="saved-query-item">
          <div class="saved-query-name">
            <span class="load-query" data-id="${sq.id}">${escapeHtml(sq.name)}</span>
            <button class="delete-saved-query" data-id="${sq.id}">Delete</button>
          </div>
          <div class="saved-query-meta">${dateStr}</div>
          <div class="saved-query-preview load-query" data-id="${sq.id}">${escapeHtml(preview)}</div>
        </div>
      `;
    }).join('');

    savedQueriesContent.querySelectorAll('.load-query').forEach(el => {
      el.addEventListener('click', () => {
        const id = parseInt(el.dataset.id);
        const query = savedQueries.find(q => q.id === id);
        if (query) {
          textarea.value = query.query;
          savedQueriesList.classList.remove('show');
          onQueryChange();
        }
      });
    });

    savedQueriesContent.querySelectorAll('.delete-saved-query').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm('Delete this saved query?')) return;

        const id = parseInt(btn.dataset.id);
        savedQueries = savedQueries.filter(q => q.id !== id);
        Storage.saveSavedQueries(savedQueries);
        renderSavedQueries();
      });
    });
  }

  // Autocomplete functions
  function getCurrentWord() {
    const text = textarea.value;
    const cursor = textarea.selectionStart;

    // Find the start of the current word
    let start = cursor - 1;
    while (start >= 0 && /[a-zA-Z0-9_]/.test(text[start])) {
      start--;
    }
    start++;

    // Find the end of the current word
    let end = cursor;
    while (end < text.length && /[a-zA-Z0-9_]/.test(text[end])) {
      end++;
    }

    // Check if there's a '.' immediately before the word (field access)
    const charBeforeWord = start > 0 ? text[start - 1] : '';
    const isFieldAccess = charBeforeWord === '.';

    return {
      word: text.substring(start, end),
      start: start,
      end: end,
      isFieldAccess: isFieldAccess
    };
  }

  function updateAutocomplete() {
    const { word, isFieldAccess } = getCurrentWord();

    // Don't show autocomplete for field access (e.g., .foo, .bar)
    if (isFieldAccess) {
      hideAutocomplete();
      return;
    }

    if (word.length < 1) {
      hideAutocomplete();
      return;
    }

    const matches = filterFunctions(word);

    if (matches.length === 0) {
      hideAutocomplete();
      return;
    }

    autocompleteItems = matches;
    selectedAutocompleteIndex = 0;
    renderAutocomplete();
    autocompleteList.classList.add('show');
  }

  function renderAutocomplete() {
    if (autocompleteItems.length === 0) {
      hideAutocomplete();
      return;
    }

    autocompleteList.innerHTML = autocompleteItems.map((item, index) => `
      <div class="autocomplete-item ${index === selectedAutocompleteIndex ? 'selected' : ''}" data-index="${index}">
        <span class="autocomplete-name">${escapeHtml(item.name)}</span>
        <span class="autocomplete-desc">${escapeHtml(item.desc)}</span>
      </div>
    `).join('');

    // Add click listeners
    autocompleteList.querySelectorAll('.autocomplete-item').forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.index);
        applyAutocomplete(autocompleteItems[index]);
      });
    });

    // Scroll selected item into view
    const selectedItem = autocompleteList.querySelector('.autocomplete-item.selected');
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest' });
    }
  }

  function applyAutocomplete(item) {
    const { start, end } = getCurrentWord();
    const text = textarea.value;
    const newText = text.substring(0, start) + item.name + text.substring(end);
    textarea.value = newText;
    textarea.selectionStart = textarea.selectionEnd = start + item.name.length;
    hideAutocomplete();
    onQueryChange();
  }

  function hideAutocomplete() {
    autocompleteList.classList.remove('show');
    autocompleteItems = [];
    selectedAutocompleteIndex = -1;
  }

  renderHistory();
  renderSavedQueries();

  panel.api = api;
  return panel;
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

function handleTabKey(e) {
  if (e.key !== 'Tab') return;

  e.preventDefault();
  const TAB_SIZE = 4;
  const INDENT = ' '.repeat(TAB_SIZE);
  const textarea = e.target;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;

  if (start === end) {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const beforeCursor = value.substring(lineStart, start);

    if (e.shiftKey && /^[ \t]*$/.test(beforeCursor)) {
      const match = beforeCursor.match(/^(?:\t|( {1,4}))/);
      if (match) {
        const removed = match[0].length;
        textarea.value = value.substring(0, lineStart) + value.substring(lineStart + removed);
        textarea.selectionStart = textarea.selectionEnd = start - removed;
      }
    } else if (!e.shiftKey) {
      textarea.value = value.substring(0, start) + INDENT + value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + TAB_SIZE;
    }
  } else {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = value.indexOf('\n', end);
    const selectedLines = value.substring(lineStart, lineEnd === -1 ? value.length : lineEnd);

    let newLines;
    let totalOffset = 0;

    if (e.shiftKey) {
      const lines = selectedLines.split('\n');
      newLines = lines.map((line) => {
        const match = line.match(/^( {1,4})/);
        if (match) {
          const removed = match[1].length;
          totalOffset -= removed;
          return line.substring(removed);
        }
        return line;
      }).join('\n');
    } else {
      const lines = selectedLines.split('\n');
      newLines = lines.map(line => INDENT + line).join('\n');
      totalOffset = newLines.length - selectedLines.length;
    }

    textarea.value = value.substring(0, lineStart) + newLines + value.substring(lineEnd === -1 ? value.length : lineEnd);

    if (e.shiftKey) {
      const firstLineRemoved = selectedLines.split('\n')[0].match(/^( {1,4})/) ?
                              selectedLines.split('\n')[0].match(/^( {1,4})/)[1].length : 0;
      textarea.selectionStart = start - (lineStart === start ? firstLineRemoved : 0);
      textarea.selectionEnd = end + totalOffset + (lineStart === start ? firstLineRemoved : 0);
    } else {
      textarea.selectionStart = start + (lineStart === start ? TAB_SIZE : 0);
      textarea.selectionEnd = end + totalOffset;
    }
  }
}
