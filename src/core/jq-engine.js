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
}

export const jqEngine = new JqEngine();
