class JqEngine {
  constructor() {
    this.instance = null;
  }

  async init() {
    try {
      // Load jq in main thread (Worker has WASM path issues)
      if (typeof window.jq === 'undefined') {
        throw new Error('jq is not loaded');
      }

      // jq-web 0.5.x: window.jq.promised
      // jq-web 0.6.x: window.jq is a Promise itself
      if (window.jq.promised) {
        this.instance = await window.jq.promised;
      } else {
        this.instance = await window.jq;
      }

      return true;
    } catch (error) {
      throw new Error('Failed to initialize jq engine: ' + error.message);
    }
  }

  async execute(input, query) {
    if (!this.instance) {
      throw new Error('jq engine not initialized');
    }

    const startTime = performance.now();

    try {
      const parsedInput = JSON.parse(input);
      const result = await this.instance.json(parsedInput, query);
      const executionTime = performance.now() - startTime;
      return { result, executionTime };
    } catch (error) {
      const executionTime = performance.now() - startTime;
      // Handle empty result - jq-web throws "Unexpected end of JSON input" for empty output
      if (error.message && error.message.includes('Unexpected end of JSON input')) {
        return { result: [], executionTime };
      }
      throw error;
    }
  }

  /**
   * Execute partial query to infer context type
   * @param {string} input - JSON input data
   * @param {string} partialQuery - Query before current pipe position
   * @param {number} maxDepth - Maximum depth for key extraction (default 8)
   * @returns {Promise<{type: string, keys: string[]}>}
   */
  async executeForContext(input, partialQuery, maxDepth = 8) {
    if (!this.instance) {
      throw new Error('jq engine not initialized');
    }

    try {
      const data = JSON.parse(input);
      const result = await this.instance.json(data, partialQuery);

      // Infer type and extract keys with deep traversal
      if (Array.isArray(result)) {
        if (result.length > 0 && typeof result[0] === 'object') {
          // Array of objects - extract keys from first few items with depth
          const keys = new Set();
          const sampleSize = Math.min(result.length, 5);

          for (let i = 0; i < sampleSize; i++) {
            this._extractKeysDeep(result[i], '', 0, maxDepth, keys);
          }

          return { type: 'array', keys: Array.from(keys) };
        }
        return { type: 'array', keys: [] };
      } else if (typeof result === 'object' && result !== null) {
        const keys = new Set();
        this._extractKeysDeep(result, '', 0, maxDepth, keys);
        return { type: 'object', keys: Array.from(keys) };
      }

      return { type: typeof result, keys: [] };
    } catch (error) {
      // Fallback to 'any' on error
      return { type: 'any', keys: [] };
    }
  }

  /**
   * Deep key extraction helper
   * @private
   */
  _extractKeysDeep(obj, path, depth, maxDepth, keys) {
    if (depth > maxDepth || obj === null || obj === undefined) return;

    if (Array.isArray(obj)) {
      const sampleSize = Math.min(obj.length, 5);
      for (let i = 0; i < sampleSize; i++) {
        this._extractKeysDeep(obj[i], path + '[]', depth, maxDepth, keys);
      }
    } else if (typeof obj === 'object') {
      for (const key of Object.keys(obj)) {
        const newPath = path ? `${path}.${key}` : key;
        keys.add(newPath);
        this._extractKeysDeep(obj[key], newPath, depth + 1, maxDepth, keys);
      }
    }
  }

  /**
   * Execute partial query with timeout for context inference
   * Prevents long-running queries from blocking autocomplete
   * @param {string} input - JSON input data
   * @param {string} partialQuery - Query before current pipe position
   * @param {number} timeout - Timeout in milliseconds (default 2000)
   * @returns {Promise<{type: string, keys: string[]}>}
   */
  async executeForContextWithTimeout(input, partialQuery, timeout = 2000) {
    return Promise.race([
      this.executeForContext(input, partialQuery),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Context execution timeout')), timeout)
      )
    ]);
  }
}

export const jqEngine = new JqEngine();
