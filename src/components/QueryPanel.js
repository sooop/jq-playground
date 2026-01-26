import { Storage } from '../utils/storage.js';
import { filterFunctions, INPUT_TYPE_INFO } from '../core/jq-functions.js';
import { handleTabKey } from '../utils/keyboard.js';
import { jqEngine } from '../core/jq-engine.js';

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
  // 마우스 이동 감지 변수
  let hoverLocked = false;
  let mouseMovementDetector = null;
  let initialMousePosition = null;
  const MOVEMENT_THRESHOLD = 5; // pixels
  // Context cache for context-aware autocomplete
  let contextCache = new Map(); // {queryHash: {type, keys}}
  const CONTEXT_CACHE_SIZE = 50;

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

    // Invalidate context cache on input (when pipe position changes)
    const pipeContext = getPipeContext();
    if (pipeContext.hasPipe) {
      const currentQuery = pipeContext.queryBeforePipe;
      // Keep only current query's cache
      const currentCache = contextCache.get(currentQuery);
      contextCache.clear();
      if (currentCache) {
        contextCache.set(currentQuery, currentCache);
      }
    }

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

  /**
   * Get field access context - extracts the complete field access path to identify prefix
   * Examples:
   *   ".users" -> {hasPrefix: false, prefix: '', currentSegment: 'users'}
   *   ".users.profile.c" -> {hasPrefix: true, prefix: 'users.profile', currentSegment: 'c'}
   *   ".users[].name" -> {hasPrefix: true, prefix: 'users[]', currentSegment: 'name'}
   */
  function getFieldAccessContext() {
    const text = textarea.value;
    const cursor = textarea.selectionStart;

    // Find the start of field access by scanning backward for delimiters
    // Don't include [] as delimiters since they're part of jq field access
    let start = cursor - 1;
    while (start >= 0 && !/[\s|(){},;]/.test(text[start])) {
      start--;
    }
    start++; // Move to the first character of the field path

    // Extract the path text from start to cursor
    const pathText = text.substring(start, cursor);

    // If doesn't start with '.', no prefix
    if (!pathText.startsWith('.')) {
      return { hasPrefix: false, prefix: '', currentSegment: pathText };
    }

    // Remove leading dot and split by last dot
    const pathWithoutLeadingDot = pathText.substring(1); // Remove the leading '.'
    const lastDotIndex = pathWithoutLeadingDot.lastIndexOf('.');

    if (lastDotIndex === -1) {
      // No dots after the leading one, e.g., ".users"
      return { hasPrefix: false, prefix: '', currentSegment: pathWithoutLeadingDot };
    }

    // Split by last dot
    const prefix = pathWithoutLeadingDot.substring(0, lastDotIndex);
    const currentSegment = pathWithoutLeadingDot.substring(lastDotIndex + 1);

    return { hasPrefix: true, prefix, currentSegment };
  }

  /**
   * Get pipe context - finds the last pipe before cursor and returns previous query
   */
  function getPipeContext() {
    const text = textarea.value;
    const cursor = textarea.selectionStart;

    // Find last pipe before cursor
    const textBeforeCursor = text.substring(0, cursor);
    const lastPipeIndex = textBeforeCursor.lastIndexOf('|');

    if (lastPipeIndex === -1) {
      return { hasPipe: false, queryBeforePipe: '', textAfterPipe: textBeforeCursor };
    }

    return {
      hasPipe: true,
      queryBeforePipe: text.substring(0, lastPipeIndex).trim(),
      textAfterPipe: text.substring(lastPipeIndex + 1, cursor).trim()
    };
  }

  async function updateAutocomplete() {
    const { word, isFieldAccess } = getCurrentWord();

    // Field access autocomplete (e.g., .foo, .bar)
    if (isFieldAccess && getInputKeys) {
      const pipeContext = getPipeContext();
      let contextKeys = [];

      // Check if we're after a pipe - use context-aware autocomplete
      if (pipeContext.hasPipe && pipeContext.queryBeforePipe) {
        const queryHash = pipeContext.queryBeforePipe;

        // Check cache first
        if (!contextCache.has(queryHash)) {
          try {
            const inputData = document.getElementById('input').value.trim();
            if (inputData) {
              const context = await jqEngine.executeForContext(inputData, pipeContext.queryBeforePipe);

              // Cache result
              contextCache.set(queryHash, context);

              // LRU cache cleanup
              if (contextCache.size > CONTEXT_CACHE_SIZE) {
                const firstKey = contextCache.keys().next().value;
                contextCache.delete(firstKey);
              }

              contextKeys = context.keys || [];
            }
          } catch (error) {
            // Fallback to original behavior on error
            console.debug('Context execution failed, using fallback', error);
          }
        } else {
          contextKeys = contextCache.get(queryHash).keys || [];
        }
      }

      // Merge context keys with input keys (prefer context keys)
      const inputKeys = getInputKeys();
      const allKeys = contextKeys.length > 0
        ? [...contextKeys, ...inputKeys]
        : inputKeys;

      if (allKeys && allKeys.length > 0) {
        // Get path context to detect and strip prefixes
        const { hasPrefix, prefix, currentSegment } = getFieldAccessContext();
        const searchTerm = currentSegment || word;
        const lowerSearchTerm = searchTerm.toLowerCase();

        const matches = allKeys
          .filter(key => {
            // If we have a prefix, only show keys that start with it
            if (hasPrefix && prefix) {
              if (!key.startsWith(prefix + '.')) return false;
              const suffix = key.substring(prefix.length + 1);
              const firstSegment = suffix.split('.')[0];
              return firstSegment.toLowerCase().startsWith(lowerSearchTerm);
            }

            // No prefix: match against full path or last segment (existing logic)
            const lowerKey = key.toLowerCase();
            if (lowerKey.startsWith(lowerSearchTerm)) return true;
            const lastSegment = key.split('.').pop().toLowerCase();
            return lastSegment.startsWith(lowerSearchTerm);
          })
          .map(key => {
            // Strip prefix if applicable
            let displayName = key;
            if (hasPrefix && prefix && key.startsWith(prefix + '.')) {
              displayName = key.substring(prefix.length + 1);
            }

            return {
              originalKey: key,      // Full path for reference
              name: displayName,     // What to insert (suffix only)
              fullKey: key,          // For context key detection in sorting
              desc: contextKeys.includes(key) ? 'Context field' : 'Input field',
              inputType: 'field'
            };
          })
          .sort((a, b) => {
            // Sort by display name
            const aStartsWith = a.name.toLowerCase().startsWith(lowerSearchTerm);
            const bStartsWith = b.name.toLowerCase().startsWith(lowerSearchTerm);
            if (aStartsWith && !bStartsWith) return -1;
            if (!aStartsWith && bStartsWith) return 1;

            // Prioritize context keys
            if (contextKeys.includes(a.fullKey) && !contextKeys.includes(b.fullKey)) return -1;
            if (!contextKeys.includes(a.fullKey) && contextKeys.includes(b.fullKey)) return 1;

            return a.name.localeCompare(b.name);
          })
          .slice(0, 10);

        if (matches.length > 0) {
          // Hide if exact match
          const exactMatch = matches.find(m => m.name.toLowerCase() === searchTerm.toLowerCase());
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

  function setupMouseMovementDetection() {
    hoverLocked = true;
    autocompleteList.classList.add('hover-locked');

    // 초기 마우스 위치 캡처
    const captureInitialPosition = (e) => {
      initialMousePosition = { x: e.clientX, y: e.clientY };
      document.removeEventListener('mousemove', captureInitialPosition);
    };
    document.addEventListener('mousemove', captureInitialPosition, { once: true });

    // 이동 감지 핸들러
    mouseMovementDetector = (e) => {
      if (!hoverLocked || !initialMousePosition) return;

      const deltaX = Math.abs(e.clientX - initialMousePosition.x);
      const deltaY = Math.abs(e.clientY - initialMousePosition.y);
      const totalMovement = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

      if (totalMovement > MOVEMENT_THRESHOLD) {
        unlockHover();
      }
    };

    document.addEventListener('mousemove', mouseMovementDetector);
  }

  function unlockHover() {
    hoverLocked = false;
    autocompleteList.classList.remove('hover-locked');

    if (mouseMovementDetector) {
      document.removeEventListener('mousemove', mouseMovementDetector);
      mouseMovementDetector = null;
    }
    initialMousePosition = null;
  }

  function renderAutocomplete() {
    if (autocompleteItems.length === 0) {
      hideAutocomplete();
      return;
    }

    // 이동 감지 설정
    setupMouseMovementDetection();

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

    // Add click and hover listeners
    autocompleteList.querySelectorAll('.autocomplete-item').forEach(item => {
      const index = parseInt(item.dataset.index);

      // 클릭 핸들러
      item.addEventListener('click', () => {
        applyAutocomplete(autocompleteItems[index]);
      });

      // mouseenter: hover 해제된 후 키보드 상태 동기화
      item.addEventListener('mouseenter', () => {
        if (!hoverLocked) {
          selectedAutocompleteIndex = index;
        }
      });

      // mouseleave: 메뉴 밖으로 나갈 때만 선택 초기화
      item.addEventListener('mouseleave', () => {
        if (!hoverLocked) {
          const rect = autocompleteList.getBoundingClientRect();
          const mouseEvent = window.event;
          if (mouseEvent) {
            const isOverList = (
              mouseEvent.clientX >= rect.left &&
              mouseEvent.clientX <= rect.right &&
              mouseEvent.clientY >= rect.top &&
              mouseEvent.clientY <= rect.bottom
            );

            if (!isOverList) {
              selectedAutocompleteIndex = -1;
            }
          }
        }
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

    // 이동 감지 리스너 정리
    if (mouseMovementDetector) {
      document.removeEventListener('mousemove', mouseMovementDetector);
      mouseMovementDetector = null;
    }
    hoverLocked = false;
    initialMousePosition = null;
    autocompleteList.classList.remove('hover-locked');
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
