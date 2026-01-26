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
   * @returns {Promise<{type: string, keys: string[]}>}
   */
  async executeForContext(input, partialQuery) {
    if (!this.instance) {
      throw new Error('jq engine not initialized');
    }

    try {
      const data = JSON.parse(input);
      const result = await this.instance.json(data, partialQuery);

      // Infer type and extract keys
      if (Array.isArray(result)) {
        if (result.length > 0 && typeof result[0] === 'object') {
          // Array of objects - extract keys from first few items
          const keySets = result.slice(0, 3).map(item =>
            typeof item === 'object' && item !== null ? Object.keys(item) : []
          );
          const allKeys = [...new Set(keySets.flat())];
          return { type: 'array', keys: allKeys };
        }
        return { type: 'array', keys: [] };
      } else if (typeof result === 'object' && result !== null) {
        return { type: 'object', keys: Object.keys(result) };
      }

      return { type: typeof result, keys: [] };
    } catch (error) {
      // Fallback to 'any' on error
      return { type: 'any', keys: [] };
    }
  }
}

export const jqEngine = new JqEngine();
