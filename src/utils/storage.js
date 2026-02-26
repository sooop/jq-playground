import { IndexedDBStorage } from './indexeddb-storage.js';

const STORAGE_KEYS = {
  HISTORY: 'jq-history',
  SAVED_QUERIES: 'jq-saved-queries',
  THEME: 'jq-theme',
  INPUT_HISTORY: 'jq-input-history',
  MIGRATION_FLAG: 'jq-migration-done'
};

const LIMITS = {
  INPUT_HISTORY: 300,
  QUERY_HISTORY: 100
};

// FNV-1a hash for fast content deduplication (32-bit, string output)
function fnv1aHash(str) {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0, len = str.length; i < len; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0; // FNV prime, unsigned
  }
  return hash.toString(36);
}

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
  queries: null,
  inputHistory: null
};

// IndexedDB instance
let idb = null;
let useIndexedDB = false;

export class Storage {
  /**
   * Initialize storage system (IndexedDB + migration)
   */
  static async init() {
    if (!IndexedDBStorage.isSupported()) {
      console.warn('IndexedDB not supported, using localStorage only');
      useIndexedDB = false;
      return;
    }

    try {
      idb = new IndexedDBStorage();
      await idb.init('jq-playground', 2, [
        { name: 'input-history', options: { keyPath: 'id', autoIncrement: true } },
        { name: 'query-history', options: { keyPath: 'id', autoIncrement: true } },
        { name: 'saved-queries', options: { keyPath: 'id', autoIncrement: true } },
        { name: 'settings', options: { keyPath: 'key' } }
      ]);

      useIndexedDB = true;

      // Run migration if needed
      await this._migrateFromLocalStorage();

      // Backfill contentHash for existing records that don't have it
      await this._backfillContentHash();
    } catch (error) {
      console.error('IndexedDB initialization failed, falling back to localStorage:', error);
      useIndexedDB = false;
      idb = null;
    }
  }

  /**
   * Backfill contentHash for existing input-history records
   */
  static async _backfillContentHash() {
    try {
      const items = await idb.getAll('input-history');
      for (const item of items) {
        if (!item.contentHash && item.content) {
          await idb.update('input-history', item.id, {
            contentHash: fnv1aHash(item.content)
          });
        }
      }
    } catch (error) {
      console.warn('contentHash backfill failed (non-critical):', error);
    }
  }

  /**
   * Migrate data from localStorage to IndexedDB
   */
  static async _migrateFromLocalStorage() {
    const migrationDone = localStorage.getItem(STORAGE_KEYS.MIGRATION_FLAG);
    if (migrationDone === 'true') {
      return;
    }

    try {
      // Migrate query history
      const oldHistory = localStorage.getItem(STORAGE_KEYS.HISTORY);
      if (oldHistory) {
        const queries = JSON.parse(oldHistory);
        for (const query of queries) {
          await idb.add('query-history', {
            query,
            timestamp: new Date().toISOString()
          });
        }
      }

      // Migrate saved queries
      const oldSaved = localStorage.getItem(STORAGE_KEYS.SAVED_QUERIES);
      if (oldSaved) {
        const saved = JSON.parse(oldSaved);
        for (const item of saved) {
          await idb.add('saved-queries', {
            name: item.name,
            query: item.query,
            timestamp: new Date().toISOString()
          });
        }
      }

      localStorage.setItem(STORAGE_KEYS.MIGRATION_FLAG, 'true');
      console.log('Migration to IndexedDB completed');
    } catch (error) {
      console.error('Migration failed:', error);
    }
  }

  // ==================== INPUT HISTORY ====================

  /**
   * Format content for storage (format JSON with indentation, trim text)
   * @param {string} content - Raw content
   * @returns {string} Formatted content
   */
  static _formatContent(content) {
    const LARGE_THRESHOLD = 1 * 1024 * 1024; // 1MB
    // content.length is a fast approximation of byte size for ASCII/JSON
    if (content.length > LARGE_THRESHOLD) {
      return content.trim();
    }
    try {
      const parsed = JSON.parse(content);
      return JSON.stringify(parsed, null, 2); // Formatted JSON with 2-space indentation
    } catch {
      return content.trim(); // Plain text: trim only
    }
  }

  /**
   * Save input history entry (debounce handled by caller)
   * @param {string} content - Input content
   * @param {string} fileName - File name (optional)
   */
  static async saveInputHistory(content, fileName = null) {
    if (!content || !content.trim()) {
      return;
    }

    const formattedContent = this._formatContent(content);
    const hash = fnv1aHash(formattedContent);

    try {
      if (useIndexedDB && idb) {
        // O(1) 해시 인덱스 조회 (전체 테이블 스캔 대신)
        let existing = await idb.findByIndex('input-history', 'contentHash', hash);

        // 해시 충돌 확인: 해시가 같아도 content가 다를 수 있음
        if (existing && existing.content !== formattedContent) {
          existing = null;
        }

        if (existing) {
          // Update lastUsed only
          await idb.update('input-history', existing.id, {
            lastUsed: new Date().toISOString()
          });
        } else {
          // Create new entry
          // content.length is a fast approximation of byte size for ASCII/JSON
          const entry = {
            content: formattedContent,
            contentHash: hash,
            fileName,
            size: formattedContent.length,
            timestamp: new Date().toISOString(),
            lastUsed: new Date().toISOString()
          };
          await idb.add('input-history', entry);
          await idb.enforceLimit('input-history', LIMITS.INPUT_HISTORY, 'timestamp');
        }
      } else {
        // Fallback: localStorage (limited)
        const history = Storage._getInputHistoryFromLocalStorage();

        // Check for duplicate
        const existingIndex = history.findIndex(item => item.content === formattedContent);

        if (existingIndex !== -1) {
          // Update lastUsed and move to front
          history[existingIndex].lastUsed = new Date().toISOString();
          const [item] = history.splice(existingIndex, 1);
          history.unshift(item);
        } else {
          // Create new entry
          const entry = {
            content: formattedContent,
            fileName,
            size: formattedContent.length,
            timestamp: new Date().toISOString(),
            lastUsed: new Date().toISOString()
          };
          history.unshift(entry);
        }

        if (history.length > 50) {
          history.splice(50);
        }
        localStorage.setItem(STORAGE_KEYS.INPUT_HISTORY, JSON.stringify(history));
      }
    } catch (error) {
      console.error('Failed to save input history:', error);
    }
  }

  /**
   * Get input history
   * @param {number} limit - Maximum number of items
   * @param {string} sortBy - Sort by 'timestamp' or 'lastUsed' (default: 'timestamp')
   */
  static async getInputHistory(limit = 50, sortBy = 'timestamp') {
    try {
      if (useIndexedDB && idb) {
        return await idb.getAll('input-history', sortBy, limit);
      } else {
        const history = Storage._getInputHistoryFromLocalStorage();
        // Sort by specified field
        history.sort((a, b) => new Date(b[sortBy]) - new Date(a[sortBy]));
        return history.slice(0, limit);
      }
    } catch (error) {
      console.error('Failed to load input history:', error);
      return [];
    }
  }

  /**
   * Get the last input (for session restoration)
   */
  static async getLastInput() {
    try {
      const history = await this.getInputHistory(1);
      return history[0] || null;
    } catch (error) {
      console.error('Failed to load last input:', error);
      return null;
    }
  }

  /**
   * Update input history content (preserves timestamp)
   * @param {number} id - Entry ID
   * @param {string} newContent - New content
   */
  static async updateInputHistoryContent(id, newContent) {
    const formattedContent = this._formatContent(newContent);

    try {
      if (useIndexedDB && idb) {
        await idb.update('input-history', id, {
          content: formattedContent,
          contentHash: fnv1aHash(formattedContent),
          size: formattedContent.length,
          lastUsed: new Date().toISOString()
        });
      } else {
        const history = Storage._getInputHistoryFromLocalStorage();
        const item = history.find(h => h.id === id);
        if (item) {
          item.content = formattedContent;
          item.size = formattedContent.length;
          item.lastUsed = new Date().toISOString();
          localStorage.setItem(STORAGE_KEYS.INPUT_HISTORY, JSON.stringify(history));
        }
      }
    } catch (error) {
      console.error('Failed to update input history content:', error);
    }
  }

  /**
   * Delete a specific input history entry
   * @param {number} id - Entry ID
   */
  static async deleteInputHistory(id) {
    try {
      if (useIndexedDB && idb) {
        await idb.delete('input-history', id);
      } else {
        const history = Storage._getInputHistoryFromLocalStorage();
        const filtered = history.filter(item => item.id !== id);
        localStorage.setItem(STORAGE_KEYS.INPUT_HISTORY, JSON.stringify(filtered));
      }
    } catch (error) {
      console.error('Failed to delete input history:', error);
    }
  }

  /**
   * Clear all input history
   */
  static async clearAllInputHistory() {
    try {
      if (useIndexedDB && idb) {
        await idb.clear('input-history');
      } else {
        localStorage.removeItem(STORAGE_KEYS.INPUT_HISTORY);
      }
    } catch (error) {
      console.error('Failed to clear input history:', error);
    }
  }

  /**
   * Search input history by filename or content
   * @param {string} searchTerm - Search term
   */
  static async searchInputHistory(searchTerm) {
    try {
      const history = await this.getInputHistory(300); // Get all
      const term = searchTerm.toLowerCase();

      return history.filter(item => {
        const fileNameMatch = item.fileName?.toLowerCase().includes(term);
        const contentMatch = item.content.toLowerCase().includes(term);
        return fileNameMatch || contentMatch;
      });
    } catch (error) {
      console.error('Failed to search input history:', error);
      return [];
    }
  }

  /**
   * Helper: Get input history from localStorage
   */
  static _getInputHistoryFromLocalStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.INPUT_HISTORY);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  }

  // ==================== QUERY HISTORY ====================

  /**
   * Save query to history (IndexedDB)
   */
  static async saveQueryHistory(query) {
    if (!query || !query.trim()) {
      return;
    }

    try {
      if (useIndexedDB && idb) {
        await idb.add('query-history', {
          query,
          timestamp: new Date().toISOString()
        });
        await idb.enforceLimit('query-history', LIMITS.QUERY_HISTORY, 'timestamp');
      } else {
        // Fallback: use old localStorage method
        const history = this.getHistory();
        if (!history.includes(query)) {
          history.unshift(query);
          if (history.length > 20) {
            history.splice(20);
          }
          this.saveHistory(history);
        }
      }
    } catch (error) {
      console.error('Failed to save query history:', error);
    }
  }

  /**
   * Get query history (IndexedDB)
   */
  static async getQueryHistory(limit = 20) {
    try {
      if (useIndexedDB && idb) {
        const items = await idb.getAll('query-history', 'timestamp', limit);
        return items.map(item => ({ id: item.id, query: item.query }));
      } else {
        const history = this.getHistory();
        return history.map((query, index) => ({ id: index, query }));
      }
    } catch (error) {
      console.error('Failed to load query history:', error);
      return [];
    }
  }

  /**
   * Delete a specific query history entry
   */
  static async deleteQueryHistory(id) {
    try {
      if (useIndexedDB && idb) {
        await idb.delete('query-history', id);
      } else {
        const history = this.getHistory();
        history.splice(id, 1);
        this.saveHistory(history);
      }
    } catch (error) {
      console.error('Failed to delete query history:', error);
    }
  }

  /**
   * Clear all query history
   */
  static async clearAllQueryHistory() {
    try {
      if (useIndexedDB && idb) {
        await idb.clear('query-history');
      } else {
        this.saveHistory([]);
      }
    } catch (error) {
      console.error('Failed to clear query history:', error);
    }
  }

  // ==================== LEGACY LOCALSTORAGE METHODS ====================

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

  // ==================== SAVED QUERIES ====================

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

  // ==================== THEME ====================

  static getTheme() {
    try {
      return localStorage.getItem(STORAGE_KEYS.THEME) || 'system';
    } catch (e) {
      console.error('Failed to load theme:', e);
      return 'system';
    }
  }

  static saveTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEYS.THEME, theme);
    } catch (e) {
      console.error('Failed to save theme:', e);
    }
  }

  // ==================== FLUSH ====================

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
    if (pendingSaves.inputHistory !== null && useIndexedDB && idb) {
      // For IndexedDB, we can't flush synchronously in beforeunload
      // The debounced save should have been triggered already
      console.warn('Input history may not be flushed on page unload');
    }
  }
}
