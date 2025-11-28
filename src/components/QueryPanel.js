import { Storage } from '../utils/storage.js';

const MAX_HISTORY = 20;

// Helper function to read file
function readFileContent(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

const CHEATSHEET_CATEGORIES = {
  basic: {
    title: 'Basic',
    items: [
      { query: '.', desc: 'Identity - returns input unchanged' },
      { query: '.field', desc: 'Field access' },
      { query: '.[]', desc: 'Array/object iterator' },
      { query: '.[0]', desc: 'Array index access' },
      { query: '.field?', desc: 'Optional field (no error if missing)' },
      { query: '..', desc: 'Recursive descent (all values)' },
      { query: '.field.nested', desc: 'Nested field access' },
      { query: '.["field name"]', desc: 'Field with special chars' }
    ]
  },
  filters: {
    title: 'Filters & Selection',
    items: [
      { query: 'select(.age > 25)', desc: 'Filter by condition' },
      { query: 'select(.city == "Seoul")', desc: 'Filter by equality' },
      { query: 'select(.name | test("^A"))', desc: 'Filter by regex' },
      { query: 'select(has("field"))', desc: 'Filter if key exists' },
      { query: 'select(.tags | contains(["jq"]))', desc: 'Filter by array content' },
      { query: 'map(select(.active))', desc: 'Filter within map' },
      { query: '.[] | select(.price < 100)', desc: 'Iterate and filter' },
      { query: 'limit(5; .[])', desc: 'Limit results' }
    ]
  },
  arrays: {
    title: 'Arrays',
    items: [
      { query: 'map(.name)', desc: 'Transform each element' },
      { query: 'sort_by(.age)', desc: 'Sort by field' },
      { query: 'reverse', desc: 'Reverse array' },
      { query: 'unique', desc: 'Remove duplicates' },
      { query: 'unique_by(.id)', desc: 'Unique by field' },
      { query: 'group_by(.category)', desc: 'Group by field' },
      { query: 'flatten', desc: 'Flatten nested arrays' },
      { query: 'add', desc: 'Sum array elements' },
      { query: 'min / max', desc: 'Min/max value' },
      { query: 'min_by(.age) / max_by(.age)', desc: 'Min/max by field' },
      { query: 'first / last', desc: 'First/last element' },
      { query: '[.[] | .value * 2]', desc: 'Build new array' }
    ]
  },
  objects: {
    title: 'Objects',
    items: [
      { query: 'keys', desc: 'Object keys (sorted)' },
      { query: 'values', desc: 'Object values' },
      { query: 'to_entries', desc: 'Convert to [{key,value}]' },
      { query: 'from_entries', desc: 'Convert from [{key,value}]' },
      { query: 'with_entries(.value |= . * 2)', desc: 'Transform entries' },
      { query: 'has("key")', desc: 'Check if key exists' },
      { query: 'del(.field)', desc: 'Delete field' },
      { query: '{name, age}', desc: 'Pick specific fields' },
      { query: '{name: .fullName, age}', desc: 'Rename and pick fields' },
      { query: '. + {new: "field"}', desc: 'Add/update fields' }
    ]
  },
  strings: {
    title: 'Strings',
    items: [
      { query: 'split(",")', desc: 'Split string' },
      { query: 'join(", ")', desc: 'Join array to string' },
      { query: 'test("pattern")', desc: 'Test regex match' },
      { query: 'match("pattern")', desc: 'Get regex matches' },
      { query: 'sub("old"; "new")', desc: 'Replace first match' },
      { query: 'gsub("old"; "new")', desc: 'Replace all matches' },
      { query: 'ascii_downcase', desc: 'Convert to lowercase' },
      { query: 'ascii_upcase', desc: 'Convert to uppercase' },
      { query: 'startswith("prefix")', desc: 'Check prefix' },
      { query: 'ltrimstr("prefix")', desc: 'Remove prefix' },
      { query: '@base64', desc: 'Base64 encode' },
      { query: '@uri', desc: 'URL encode' }
    ]
  },
  aggregation: {
    title: 'Aggregation',
    items: [
      { query: 'length', desc: 'Length of array/object/string' },
      { query: 'add', desc: 'Sum array of numbers' },
      { query: '[.[] | .price] | add', desc: 'Sum specific field' },
      { query: 'group_by(.type) | map({type: .[0].type, count: length})', desc: 'Count by group' },
      { query: '[.[] | .amount] | add / length', desc: 'Calculate average' },
      { query: 'map(.quantity) | add', desc: 'Total quantity' },
      { query: 'any', desc: 'True if any value is true' },
      { query: 'all', desc: 'True if all values are true' }
    ]
  },
  conditionals: {
    title: 'Conditionals',
    items: [
      { query: 'if .age >= 18 then "adult" else "minor" end', desc: 'If-then-else' },
      { query: 'if .score > 90 then "A" elif .score > 80 then "B" else "C" end', desc: 'Multiple conditions' },
      { query: '.name // "unknown"', desc: 'Alternative operator (default)' },
      { query: 'select(.value != null)', desc: 'Filter null values' },
      { query: '.field // empty', desc: 'Skip if null/false' },
      { query: 'if . then "yes" else "no" end', desc: 'Boolean check' }
    ]
  },
  conversion: {
    title: 'Type & Format',
    items: [
      { query: 'type', desc: 'Get value type' },
      { query: 'tonumber', desc: 'Convert to number' },
      { query: 'tostring', desc: 'Convert to string' },
      { query: '@json', desc: 'Format as JSON string' },
      { query: '@csv', desc: 'Format as CSV' },
      { query: '@tsv', desc: 'Format as TSV' },
      { query: '@html', desc: 'HTML escape' },
      { query: '@text', desc: 'Plain text output' },
      { query: 'map(tonumber)', desc: 'Convert array to numbers' }
    ]
  },
  advanced: {
    title: 'Advanced',
    items: [
      { query: 'reduce .[] as $item (0; . + $item)', desc: 'Reduce with accumulator' },
      { query: 'recurse(.children[]?)', desc: 'Recursive traversal' },
      { query: 'walk(if type == "string" then ascii_upcase else . end)', desc: 'Walk and transform' },
      { query: '[paths(scalars)]', desc: 'All paths to leaf values' },
      { query: 'getpath(["a", "b"])', desc: 'Get value by path' },
      { query: 'setpath(["a", "b"]; 123)', desc: 'Set value by path' },
      { query: 'path(.a.b)', desc: 'Get path to field' }
    ]
  },
  practical: {
    title: 'Practical Patterns',
    items: [
      { query: '[.users[] | {name, email}]', desc: 'Extract specific fields' },
      { query: '.users | map(select(.active)) | sort_by(.name)', desc: 'Filter, sort pipeline' },
      { query: 'group_by(.category) | map({category: .[0].category, items: .})', desc: 'Group and reshape' },
      { query: '[.[] | select(.tags | contains(["featured"]))]', desc: 'Filter by array contains' },
      { query: '.data | to_entries | map(select(.value > 10)) | from_entries', desc: 'Filter object entries' },
      { query: '.[] | select(.date | test("2024"))', desc: 'Filter by string pattern' },
      { query: '[.[] | .total = (.price * .quantity)]', desc: 'Add calculated field' },
      { query: '{users: [.users[] | {name, age}], count: (.users | length)}', desc: 'Build new structure' }
    ]
  }
};

export function createQueryPanel(onQueryChange, onShowSaveModal, onExecute) {
  const panel = document.createElement('div');
  panel.className = 'panel';

  // Generate tabs HTML
  const categoryKeys = Object.keys(CHEATSHEET_CATEGORIES);
  const tabsHTML = categoryKeys.map((key, index) =>
    `<button class="cheatsheet-tab ${index === 0 ? 'active' : ''}" data-category="${key}">
      ${CHEATSHEET_CATEGORIES[key].title}
    </button>`
  ).join('');

  // Generate category content HTML
  const categoriesHTML = categoryKeys.map((key, index) => {
    const items = CHEATSHEET_CATEGORIES[key].items;
    const itemsHTML = items.map(item =>
      `<div class="cheatsheet-item" data-query="${escapeHtml(item.query)}">
        <code>${escapeHtml(item.query)}</code>
        <span class="cheatsheet-desc">${item.desc}</span>
      </div>`
    ).join('');

    return `<div class="cheatsheet-category ${index === 0 ? 'active' : ''}" data-category="${key}">
      ${itemsHTML}
    </div>`;
  }).join('');

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
        <div class="history-list" id="historyList"></div>
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
    <div class="cheatsheet" id="cheatsheet">
      <div class="cheatsheet-tabs">
        ${tabsHTML}
      </div>
      <div class="cheatsheet-content">
        ${categoriesHTML}
      </div>
    </div>
    <div class="panel-content">
      <textarea id="query" placeholder="Enter jq query...">.users[] | select(.age > 25)</textarea>
    </div>
  `;

  const textarea = panel.querySelector('#query');
  const cheatsheet = panel.querySelector('#cheatsheet');
  const historyList = panel.querySelector('#historyList');
  const savedQueriesList = panel.querySelector('#savedQueriesList');
  const savedQueriesContent = panel.querySelector('#savedQueriesContent');

  // State
  let queryHistory = Storage.getHistory();
  let savedQueries = Storage.getSavedQueries();

  // Event listeners
  textarea.addEventListener('input', onQueryChange);
  textarea.addEventListener('keydown', (e) => {
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

  // Cheatsheet tab switching
  panel.querySelectorAll('.cheatsheet-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const category = tab.dataset.category;

      // Update active tab
      panel.querySelectorAll('.cheatsheet-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Update active category
      panel.querySelectorAll('.cheatsheet-category').forEach(c => c.classList.remove('active'));
      panel.querySelector(`.cheatsheet-category[data-category="${category}"]`).classList.add('active');
    });
  });

  // Cheatsheet items
  panel.querySelectorAll('.cheatsheet-item').forEach(item => {
    item.addEventListener('click', () => {
      const query = item.dataset.query;
      const current = textarea.value;
      textarea.value = current.trim() === '' ? query : current + ' | ' + query;
      textarea.focus();
      onQueryChange();
    });
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

    toggleCheatsheet: () => {
      cheatsheet.classList.toggle('open');
    },

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

  function renderHistory() {
    if (queryHistory.length === 0) {
      historyList.innerHTML = '<div class="history-item" style="cursor: default; color: #999;">No history</div>';
      return;
    }

    historyList.innerHTML = queryHistory.map(q =>
      `<div class="history-item" data-query="${escapeHtml(q)}">${escapeHtml(q)}</div>`
    ).join('');

    historyList.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', () => {
        const query = item.dataset.query;
        if (query) {
          textarea.value = query;
          historyList.classList.remove('show');
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
