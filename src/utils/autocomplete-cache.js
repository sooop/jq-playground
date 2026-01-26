/**
 * Enhanced cache system for autocomplete
 * Manages both input-based keys and context-based keys with TTL and LRU eviction
 */
export class AutocompleteCache {
  constructor(options = {}) {
    this.maxContextEntries = options.maxContextEntries || 100;
    this.contextTTL = options.contextTTL || 60000; // 1 minute default

    // Input keys cache (single entry, invalidated on input change)
    this.inputKeysCache = null;
    this.inputHash = null;

    // Context cache: Map<queryHash, {keys, timestamp, incomplete}>
    this.contextCache = new Map();
  }

  /**
   * Generate a simple hash for input data
   * @param {string} input - Input JSON string
   * @returns {string} Hash string
   */
  static hashInput(input) {
    // Simple hash based on length and sample characters
    const len = input.length;
    const sample = input.substring(0, 100) + input.substring(Math.max(0, len - 100));
    let hash = 0;
    for (let i = 0; i < sample.length; i++) {
      const char = sample.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return `${len}_${hash}`;
  }

  /**
   * Set input keys cache
   * @param {string[]} keys - Extracted keys
   * @param {string} inputHash - Hash of input data
   * @param {boolean} incomplete - Whether extraction is still in progress
   */
  setInputKeys(keys, inputHash, incomplete = false) {
    this.inputKeysCache = {
      keys: keys,
      incomplete: incomplete,
      timestamp: Date.now()
    };
    this.inputHash = inputHash;
  }

  /**
   * Get cached input keys
   * @param {string} inputHash - Hash of current input
   * @returns {Object|null} {keys, incomplete} or null if not cached or hash mismatch
   */
  getInputKeys(inputHash) {
    if (this.inputHash !== inputHash || !this.inputKeysCache) {
      return null;
    }
    return this.inputKeysCache;
  }

  /**
   * Update input keys (merge new keys)
   * @param {string[]} newKeys - New keys to merge
   * @param {string} inputHash - Hash of input data
   * @param {boolean} incomplete - Whether extraction is still in progress
   */
  updateInputKeys(newKeys, inputHash, incomplete = false) {
    if (this.inputHash !== inputHash) {
      // Hash mismatch, replace
      this.setInputKeys(newKeys, inputHash, incomplete);
      return;
    }

    if (!this.inputKeysCache) {
      this.setInputKeys(newKeys, inputHash, incomplete);
      return;
    }

    // Merge keys
    const existingSet = new Set(this.inputKeysCache.keys);
    for (const key of newKeys) {
      existingSet.add(key);
    }

    this.inputKeysCache = {
      keys: Array.from(existingSet),
      incomplete: incomplete,
      timestamp: Date.now()
    };
  }

  /**
   * Set context keys for a specific query
   * @param {string} query - Query before pipe
   * @param {string[]} keys - Keys from context execution
   * @param {string} type - Result type (array, object, etc.)
   */
  setContextKeys(query, keys, type = 'any') {
    // LRU eviction
    if (this.contextCache.size >= this.maxContextEntries) {
      // Remove oldest entry
      let oldestKey = null;
      let oldestTime = Infinity;
      for (const [key, value] of this.contextCache) {
        if (value.timestamp < oldestTime) {
          oldestTime = value.timestamp;
          oldestKey = key;
        }
      }
      if (oldestKey) {
        this.contextCache.delete(oldestKey);
      }
    }

    this.contextCache.set(query, {
      keys: keys,
      type: type,
      timestamp: Date.now()
    });
  }

  /**
   * Get cached context keys
   * @param {string} query - Query before pipe
   * @returns {Object|null} {keys, type} or null if not cached or expired
   */
  getContextKeys(query) {
    const cached = this.contextCache.get(query);
    if (!cached) {
      return null;
    }

    // Check TTL
    if (Date.now() - cached.timestamp > this.contextTTL) {
      this.contextCache.delete(query);
      return null;
    }

    // Update timestamp (LRU)
    cached.timestamp = Date.now();
    return { keys: cached.keys, type: cached.type };
  }

  /**
   * Invalidate all caches (on input change)
   */
  invalidate() {
    this.inputKeysCache = null;
    this.inputHash = null;
    this.contextCache.clear();
  }

  /**
   * Invalidate only context cache (on query structure change)
   */
  invalidateContext() {
    this.contextCache.clear();
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getStats() {
    return {
      hasInputKeys: !!this.inputKeysCache,
      inputKeysCount: this.inputKeysCache?.keys?.length || 0,
      inputKeysIncomplete: this.inputKeysCache?.incomplete || false,
      contextEntries: this.contextCache.size
    };
  }
}
