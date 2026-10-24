import type { InputKeysCache, ContextKeysCache } from '../types';

interface AutocompleteCacheOptions {
  maxContextEntries?: number;
  contextTTL?: number;
}

let lastHashedInput: string | null = null;
let lastHash: string | null = null;

/**
 * Enhanced cache system for autocomplete
 * Manages both input-based keys and context-based keys with TTL and LRU eviction
 */
export class AutocompleteCache {
  private maxContextEntries: number;
  private contextTTL: number;
  private inputKeysCache: InputKeysCache | null;
  private inputHash: string | null;
  private contextCache: Map<string, ContextKeysCache>;

  constructor(options: AutocompleteCacheOptions = {}) {
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
  static hashInput(input: string): string {
    // 앞뒤 100자만 보면 가운데를 같은 길이로 고친 입력이 같은 해시가 되어 옛 키가 남는다 —
    // 전체를 훑는다. 키 입력마다 불리므로 직전과 같은 문자열이면 결과를 재사용한다.
    if (input === lastHashedInput && lastHash !== null) return lastHash;
    let hash = 0x811c9dc5;
    for (let i = 0, len = input.length; i < len; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    lastHashedInput = input;
    lastHash = `${input.length}_${hash >>> 0}`;
    return lastHash;
  }

  /**
   * Set input keys cache
   * @param {string[]} keys - Extracted keys
   * @param {string} inputHash - Hash of input data
   * @param {boolean} incomplete - Whether extraction is still in progress
   */
  setInputKeys(keys: string[], inputHash: string, incomplete = false): void {
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
  getInputKeys(inputHash: string): InputKeysCache | null {
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
  updateInputKeys(newKeys: string[], inputHash: string, incomplete = false): void {
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
  setContextKeys(query: string, keys: string[], type = 'any'): void {
    // LRU eviction
    if (this.contextCache.size >= this.maxContextEntries) {
      // Remove oldest entry
      let oldestKey: string | null = null;
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
  getContextKeys(query: string): { keys: string[]; type: string } | null {
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
