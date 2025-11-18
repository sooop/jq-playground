const STORAGE_KEYS = {
  HISTORY: 'jq-history',
  SAVED_QUERIES: 'jq-saved-queries'
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
    try {
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
    } catch (e) {
      console.error('Failed to save history:', e);
    }
  }

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
    try {
      localStorage.setItem(STORAGE_KEYS.SAVED_QUERIES, JSON.stringify(queries));
    } catch (e) {
      console.error('Failed to save queries:', e);
    }
  }
}
