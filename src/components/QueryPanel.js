import { Storage } from '../utils/storage.js';

const MAX_HISTORY = 20;
const CHEATSHEET_ITEMS = [
  { query: '.', desc: 'Identity' },
  { query: '.[]', desc: 'Array iterator' },
  { query: '.key', desc: 'Object field' },
  { query: '.[0]', desc: 'Array index' },
  { query: 'select(.age > 25)', desc: 'Filter' },
  { query: 'map(.name)', desc: 'Transform' },
  { query: 'group_by(.city)', desc: 'Group' },
  { query: 'sort_by(.age)', desc: 'Sort' },
  { query: 'to_entries', desc: 'Convert' },
  { query: 'keys', desc: 'Object keys' },
  { query: 'length', desc: 'Count' },
  { query: 'if .age > 25 then "adult" else "young" end', desc: 'Condition' }
];

export function createQueryPanel(onQueryChange, onShowSaveModal) {
  const panel = document.createElement('div');
  panel.className = 'panel';

  const cheatsheetHTML = CHEATSHEET_ITEMS.map(item =>
    `<div class="cheatsheet-item" data-query="${escapeHtml(item.query)}">
      <code>${escapeHtml(item.query)}</code> - ${item.desc}
    </div>`
  ).join('');

  panel.innerHTML = `
    <div class="panel-header">
      <span class="panel-title">Query</span>
      <div class="panel-actions history-dropdown">
        <button id="saveQueryBtn">Save</button>
        <button id="savedQueriesBtn">Saved</button>
        <button id="historyBtn">History</button>
        <button id="clearQueryBtn">Clear</button>
        <div class="history-list" id="historyList"></div>
        <div class="history-list saved-queries-list" id="savedQueriesList"></div>
      </div>
    </div>
    <div class="cheatsheet" id="cheatsheet">
      <div class="cheatsheet-content">
        ${cheatsheetHTML}
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

  // State
  let queryHistory = Storage.getHistory();
  let savedQueries = Storage.getSavedQueries();

  // Event listeners
  textarea.addEventListener('input', onQueryChange);
  textarea.addEventListener('keydown', handleTabKey);

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
      savedQueriesList.innerHTML = '<div class="saved-query-item" style="cursor: default; color: #999; padding: 12px;">No saved queries</div>';
      return;
    }

    savedQueriesList.innerHTML = savedQueries.map(sq => {
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

    savedQueriesList.querySelectorAll('.load-query').forEach(el => {
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

    savedQueriesList.querySelectorAll('.delete-saved-query').forEach(btn => {
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
