class JqEngine {
  constructor() {
    this.instance = null;
    this.worker = null;
  }

  async init() {
    try {
      // 메인 스레드에서 jq 로드 (global window.jq)
      if (typeof window.jq === 'undefined') {
        throw new Error('jq is not loaded');
      }
      this.instance = await window.jq.promised;

      // Web Worker 생성
      const workerCode = `
        self.onmessage = async function(event) {
          const { input, query, format } = event.data;

          try {
            const parsedInput = JSON.parse(input);
            self.postMessage({
              type: 'process',
              input: parsedInput,
              query: query,
              format: format
            });
          } catch (error) {
            self.postMessage({
              type: 'error',
              message: error.message
            });
          }
        };
      `;

      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      this.worker = new Worker(workerUrl);

      return true;
    } catch (error) {
      throw new Error('Failed to initialize jq engine: ' + error.message);
    }
  }

  async execute(input, query) {
    if (!this.instance) {
      throw new Error('jq engine not initialized');
    }

    try {
      const parsedInput = JSON.parse(input);
      const result = await this.instance.json(parsedInput, query);
      return result;
    } catch (error) {
      throw error;
    }
  }

  onWorkerMessage(handler) {
    if (this.worker) {
      this.worker.onmessage = handler;
    }
  }

  postToWorker(data) {
    if (this.worker) {
      this.worker.postMessage(data);
    }
  }
}

export const jqEngine = new JqEngine();
