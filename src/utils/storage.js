const STORAGE_KEYS = {
  HISTORY: 'jq-history',
  SAVED_QUERIES: 'jq-saved-queries'
};

// Debounce utility
function debounce(fn, delay) {
  let timer = null;
  return function(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// Pending save operations (in-memory cache)
const pendingSaves = {
  history: null,
  queries: null
};

export class Storage {
  static getHistory() {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.HISTORY);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Failed to load history:', e);
      return [];
    }
  }

  static saveHistory(history) {
    // Immediate in-memory update
    pendingSaves.history = history;

    // Debounced localStorage write
    this._debouncedSaveHistory();
  }

  static _debouncedSaveHistory = debounce(function() {
    try {
      if (pendingSaves.history !== null) {
        localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(pendingSaves.history));
        pendingSaves.history = null;
      }
    } catch (e) {
      console.error('Failed to save history:', e);
    }
  }, 500);

  static getSavedQueries() {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SAVED_QUERIES);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Failed to load saved queries:', e);
      return [];
    }
  }

  static saveSavedQueries(queries) {
    // Immediate in-memory update
    pendingSaves.queries = queries;

    // Debounced localStorage write
    this._debouncedSaveQueries();
  }

  static _debouncedSaveQueries = debounce(function() {
    try {
      if (pendingSaves.queries !== null) {
        localStorage.setItem(STORAGE_KEYS.SAVED_QUERIES, JSON.stringify(pendingSaves.queries));
        pendingSaves.queries = null;
      }
    } catch (e) {
      console.error('Failed to save queries:', e);
    }
  }, 500);

  // Flush all pending saves (for app unload)
  static flushAll() {
    // Immediately save any pending data
    if (pendingSaves.history !== null) {
      try {
        localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(pendingSaves.history));
        pendingSaves.history = null;
      } catch (e) {
        console.error('Failed to flush history:', e);
      }
    }
    if (pendingSaves.queries !== null) {
      try {
        localStorage.setItem(STORAGE_KEYS.SAVED_QUERIES, JSON.stringify(pendingSaves.queries));
        pendingSaves.queries = null;
      } catch (e) {
        console.error('Failed to flush queries:', e);
      }
    }
  }
}
