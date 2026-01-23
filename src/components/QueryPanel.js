import { Storage } from '../utils/storage.js';
import { filterFunctions, INPUT_TYPE_INFO } from '../core/jq-functions.js';
import { handleTabKey } from '../utils/keyboard.js';

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

export function createQueryPanel(onQueryChange, onShowSaveModal, onExecute, getInputKeys = null) {
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
      </div>
    </div>
    <div class="panel-content autocomplete-container">
      <textarea id="query" placeholder="Enter jq query..."></textarea>
      <div class="autocomplete-list" id="autocompleteList"></div>
    </div>
  `;

  // Create dropdown elements and append to body
  const historyList = document.createElement('div');
  historyList.className = 'history-list';
  historyList.id = 'historyList';
  historyList.innerHTML = `
    <div class="history-header">
      <input type="text" class="history-search" id="historySearch" placeholder="Search history..." />
      <div class="history-actions">
        <button id="clearAllHistoryBtn" class="clear-all-btn" title="Clear all history">Clear All</button>
        <button id="importHistoryBtn" title="Import history">Import</button>
        <button id="exportHistoryBtn" title="Export history">Export</button>
      </div>
    </div>
    <div class="history-content" id="historyContent"></div>
  `;
  document.body.appendChild(historyList);

  const savedQueriesList = document.createElement('div');
  savedQueriesList.className = 'history-list saved-queries-list';
  savedQueriesList.id = 'savedQueriesList';
  savedQueriesList.innerHTML = `
    <div class="saved-queries-header">
      <input type="text" class="history-search" id="savedQueriesSearch" placeholder="Search saved queries..." />
      <div class="saved-queries-actions">
        <button id="importQueriesBtn" title="Import saved queries">Import</button>
        <button id="exportQueriesBtn" title="Export saved queries">Export</button>
      </div>
    </div>
    <div class="saved-queries-content" id="savedQueriesContent"></div>
  `;
  document.body.appendChild(savedQueriesList);

  const textarea = panel.querySelector('#query');
  const historySearch = historyList.querySelector('#historySearch');
  const historyContent = historyList.querySelector('#historyContent');
  const savedQueriesSearch = savedQueriesList.querySelector('#savedQueriesSearch');
  const savedQueriesContent = savedQueriesList.querySelector('#savedQueriesContent');
  const autocompleteList = panel.querySelector('#autocompleteList');

  // State
  let queryHistory = [];
  let savedQueries = Storage.getSavedQueries();
  let autocompleteItems = [];
  let selectedAutocompleteIndex = -1;

  // Load query history asynchronously
  (async () => {
    queryHistory = await Storage.getQueryHistory(MAX_HISTORY);
    renderHistory();
  })();

  // Event delegation for history items (prevents memory leaks)
  historyContent.addEventListener('click', async (e) => {
    const deleteBtn = e.target.closest('.delete-history-item');
    if (deleteBtn) {
      e.stopPropagation();
      const id = parseInt(deleteBtn.dataset.id);
      await Storage.deleteQueryHistory(id);
      queryHistory = await Storage.getQueryHistory(MAX_HISTORY);
      renderHistory(historySearch.value);
      return;
    }

    const item = e.target.closest('.history-item');
    if (!item) return;

    const query = item.dataset.query;
    if (query) {
      textarea.value = query;
      historyList.classList.remove('show');
      historySearch.value = '';
      onQueryChange();
    }
  });

  // Event delegation for saved queries (prevents memory leaks)
  savedQueriesContent.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.delete-saved-query');
    if (deleteBtn) {
      e.stopPropagation();
      if (!confirm('Delete this saved query?')) return;

      const id = parseFloat(deleteBtn.dataset.id);
      savedQueries = savedQueries.filter(q => q.id !== id);
      Storage.saveSavedQueries(savedQueries);
      renderSavedQueries(savedQueriesSearch.value);
      return;
    }

    const item = e.target.closest('.saved-query-item[data-id]');
    if (item) {
      const id = parseFloat(item.dataset.id);
      const queryIndex = savedQueries.findIndex(q => q.id === id);
      if (queryIndex !== -1) {
        const query = savedQueries[queryIndex];
        textarea.value = query.query;

        // Move to top and update timestamp
        savedQueries.splice(queryIndex, 1);
        query.timestamp = new Date().toISOString();
        savedQueries.unshift(query);
        Storage.saveSavedQueries(savedQueries);
        renderSavedQueries(savedQueriesSearch.value);

        savedQueriesList.classList.remove('show');
        savedQueriesSearch.value = '';
        onQueryChange();
      }
    }
  });

  // Position dropdown relative to button
  function positionDropdown(button, dropdown) {
    const rect = button.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const dropdownMaxHeight = Math.min(300, viewportHeight - rect.bottom - 20);

    dropdown.style.top = rect.bottom + 4 + 'px';
    dropdown.style.right = (window.innerWidth - rect.right) + 'px';

    // Update max-height for content
    const content = dropdown.querySelector('.history-content, .saved-queries-content');
    if (content) {
      content.style.maxHeight = dropdownMaxHeight + 'px';
    }
  }

  // Format query with proper spacing
  const formatQuery = () => {
    const value = textarea.value.trim();
    if (!value) return;

    // Simple formatting: add spaces after pipes and around operators
    let formatted = value
      .replace(/\|/g, ' | ')
      .replace(/\s+\|\s+/g, ' | ')
      .replace(/\s+/g, ' ');

    textarea.value = formatted;
    onQueryChange();
  };

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
        selectedAutocompleteIndex = Math.max(selectedAutocompleteIndex - 1, -1);
        renderAutocomplete();
        return;
      } else if (e.key === 'Tab' && autocompleteItems.length > 0) {
        // Tab: Apply first item or selected item
        e.preventDefault();
        const indexToApply = selectedAutocompleteIndex >= 0 ? selectedAutocompleteIndex : 0;
        applyAutocomplete(autocompleteItems[indexToApply]);
        return;
      } else if (e.key === 'Enter' && selectedAutocompleteIndex >= 0) {
        // Enter: Only apply if explicitly selected via arrow keys AND cursor is at word end
        const { isCursorAtWordEnd } = getCurrentWord();
        if (isCursorAtWordEnd) {
          e.preventDefault();
          applyAutocomplete(autocompleteItems[selectedAutocompleteIndex]);
          return;
        }
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

    // Ctrl+Shift+F: Format query
    if (e.ctrlKey && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      formatQuery();
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

  const historyBtn = panel.querySelector('#historyBtn');
  historyBtn.addEventListener('click', () => {
    savedQueriesList.classList.remove('show');
    historyList.classList.toggle('show');
    if (historyList.classList.contains('show')) {
      positionDropdown(historyBtn, historyList);
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

  // Clear all history
  historyList.querySelector('#clearAllHistoryBtn').addEventListener('click', async () => {
    if (confirm('Clear all query history?')) {
      await Storage.clearAllQueryHistory();
      queryHistory = [];
      renderHistory();
    }
  });

  // Export history
  historyList.querySelector('#exportHistoryBtn').addEventListener('click', () => {
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

  historyList.querySelector('#importHistoryBtn').addEventListener('click', () => {
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

  const savedQueriesBtn = panel.querySelector('#savedQueriesBtn');
  savedQueriesBtn.addEventListener('click', () => {
    historyList.classList.remove('show');
    savedQueriesList.classList.toggle('show');
    if (savedQueriesList.classList.contains('show')) {
      positionDropdown(savedQueriesBtn, savedQueriesList);
      savedQueriesSearch.focus();
    }
  });

  // Saved queries search
  savedQueriesSearch.addEventListener('input', (e) => {
    renderSavedQueries(e.target.value);
  });

  // Saved queries search - prevent closing dropdown on click
  savedQueriesSearch.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  savedQueriesList.querySelector('#exportQueriesBtn').addEventListener('click', () => {
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

  savedQueriesList.querySelector('#importQueriesBtn').addEventListener('click', () => {
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
    if (!dropdown.contains(e.target) &&
        !historyList.contains(e.target) &&
        !savedQueriesList.contains(e.target)) {
      historyList.classList.remove('show');
      savedQueriesList.classList.remove('show');
    }
  });

  // ESC key to close dropdowns
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (historyList.classList.contains('show')) {
        historyList.classList.remove('show');
      }
      if (savedQueriesList.classList.contains('show')) {
        savedQueriesList.classList.remove('show');
      }
    }
  });

  // Public methods
  const api = {
    getQuery: () => textarea.value.trim(),

    addToHistory: async (query) => {
      if (!query) return;

      await Storage.saveQueryHistory(query);
      queryHistory = await Storage.getQueryHistory(MAX_HISTORY);
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
        .map(item => ({ ...item, ...fuzzyMatch(searchTerm, item.query) }))
        .filter(item => item.match)
        .sort((a, b) => b.score - a.score);
    }

    if (filteredHistory.length === 0) {
      historyContent.innerHTML = '<div class="history-item" style="cursor: default; color: #999;">No matching history</div>';
      return;
    }

    historyContent.innerHTML = filteredHistory.map(item =>
      `<div class="history-item history-query" data-query="${escapeHtml(item.query)}">
        <span>${escapeHtml(item.query)}</span>
        <button class="delete-history-item" data-id="${item.id}" title="Delete">×</button>
      </div>`
    ).join('');
    // Event delegation handles clicks (see line 121)
  }

  function renderSavedQueries(searchTerm = '') {
    if (savedQueries.length === 0) {
      savedQueriesContent.innerHTML = '<div class="saved-query-item" style="cursor: default; color: #999; padding: 12px;">No saved queries</div>';
      return;
    }

    // Filter and sort by fuzzy match score
    let filteredQueries = savedQueries;
    if (searchTerm) {
      filteredQueries = savedQueries
        .map(sq => {
          const nameMatch = fuzzyMatch(searchTerm, sq.name);
          const queryMatch = fuzzyMatch(searchTerm, sq.query);
          const bestMatch = nameMatch.score > queryMatch.score ? nameMatch : queryMatch;
          return { ...sq, ...bestMatch };
        })
        .filter(item => item.match)
        .sort((a, b) => b.score - a.score);
    }

    if (filteredQueries.length === 0) {
      savedQueriesContent.innerHTML = '<div class="saved-query-item" style="cursor: default; color: #999; padding: 12px;">No matching queries</div>';
      return;
    }

    savedQueriesContent.innerHTML = filteredQueries.map(sq => {
      const date = new Date(sq.timestamp);
      const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
      const preview = sq.query.length > 50 ? sq.query.substring(0, 50) + '...' : sq.query;

      return `
        <div class="saved-query-item" data-id="${sq.id}">
          <div class="saved-query-name">
            <span>${escapeHtml(sq.name)}</span>
            <button class="delete-saved-query" data-id="${sq.id}">Delete</button>
          </div>
          <div class="saved-query-meta">${dateStr}</div>
          <div class="saved-query-preview">${escapeHtml(preview)}</div>
        </div>
      `;
    }).join('');
    // Event delegation handles clicks (see line 129)
  }

  // Autocomplete functions
  function getCurrentWord() {
    const text = textarea.value;
    const cursor = textarea.selectionStart;

    // Find the start of the current word
    let start = cursor - 1;
    while (start >= 0 && /[a-zA-Z0-9_@]/.test(text[start])) {
      start--;
    }
    start++;

    // Find the end of the current word
    let end = cursor;
    while (end < text.length && /[a-zA-Z0-9_@]/.test(text[end])) {
      end++;
    }

    // Check if there's a '.' immediately before the word (field access)
    const charBeforeWord = start > 0 ? text[start - 1] : '';
    const isFieldAccess = charBeforeWord === '.';

    // Check if cursor is at the end of the word
    const isCursorAtWordEnd = cursor === end;

    return {
      word: text.substring(start, end),
      start: start,
      end: end,
      isFieldAccess: isFieldAccess,
      isCursorAtWordEnd: isCursorAtWordEnd
    };
  }

  function updateAutocomplete() {
    const { word, isFieldAccess } = getCurrentWord();

    // Field access autocomplete (e.g., .foo, .bar)
    if (isFieldAccess && getInputKeys) {
      const inputKeys = getInputKeys();
      if (inputKeys && inputKeys.length > 0) {
        const lower = word.toLowerCase();
        const matches = inputKeys
          .filter(key => key.toLowerCase().startsWith(lower))
          .slice(0, 10)
          .map(key => ({
            name: key,
            desc: 'Input field',
            inputType: 'field'
          }));

        if (matches.length > 0) {
          // Hide if exact match
          const exactMatch = matches.find(m => m.name.toLowerCase() === word.toLowerCase());
          if (exactMatch && matches.length === 1) {
            hideAutocomplete();
            return;
          }

          autocompleteItems = matches;
          selectedAutocompleteIndex = -1;
          renderAutocomplete();
          autocompleteList.classList.add('show');
          return;
        }
      }
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

    // Hide if user has typed past a complete exact match
    // e.g., typing "selectx" when "select" was a match
    const exactMatch = matches.find(m => m.name.toLowerCase() === word.toLowerCase());
    if (exactMatch && matches.length === 1) {
      hideAutocomplete();
      return;
    }

    autocompleteItems = matches;
    selectedAutocompleteIndex = -1; // Reset to -1, user must explicitly select
    renderAutocomplete();
    autocompleteList.classList.add('show');
  }

  function renderAutocomplete() {
    if (autocompleteItems.length === 0) {
      hideAutocomplete();
      return;
    }

    autocompleteList.innerHTML = autocompleteItems.map((item, index) => {
      const inputType = item.inputType || 'any';
      const typeInfo = INPUT_TYPE_INFO[inputType] || INPUT_TYPE_INFO['any'];
      return `
        <div class="autocomplete-item ${index === selectedAutocompleteIndex ? 'selected' : ''}" data-index="${index}">
          <span class="autocomplete-name">${escapeHtml(item.name)}</span>
          <span class="autocomplete-type" style="color: ${typeInfo.color}">${typeInfo.label}</span>
          <span class="autocomplete-desc">${escapeHtml(item.desc)}</span>
        </div>
      `;
    }).join('');

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
