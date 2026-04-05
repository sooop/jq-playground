import { createJqWorker, terminateJqWorker } from './jq-functions';
import type { BlobWorker } from './jq-functions';
import type { ExecuteResult, FormatResult } from '../types';
import type { JqInstance } from '../jq-web';

/**
 * Manages jq execution via a dedicated Web Worker with a main-thread fallback.
 *
 * Lifecycle:
 * 1. Call `init()` once after `window.jq` is available.
 * 2. Use `execute(input, query)` for normal evaluation.
 * 3. Call `terminate()` on page unload.
 */
class JqEngine {
  private instance: JqInstance | null = null;
  private worker: BlobWorker | null = null;
  private workerReady = false;
  private workerFailed = false;
  private pendingRequests = new Map<number, { resolve: (v: ExecuteResult | FormatResult) => void; reject: (e: Error) => void }>();
  private requestIdCounter = 0;
  private messageQueue: object[] = [];
  private _lastSentInput: string | null = null;

  constructor() {
  }

  /**
   * Initialize the jq engine. Must be called once before `execute()`.
   * @returns {Promise<true>}
   * @throws {Error} if `window.jq` is not available or fails to load
   */
  async init() {
    try {
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

      // 워커 생성 — 실패해도 메인 스레드 폴백이 있으므로 예외 전파 안 함
      this._initWorker();

      return true;
    } catch (error) {
      throw new Error('Failed to initialize jq engine: ' + error.message);
    }
  }

  /** @private */
  _initWorker() {
    try {
      this.worker = createJqWorker();
      this.worker.onmessage = (e) => this._handleWorkerMessage(e);
      this.worker.onerror = (err) => {
        console.warn('jq worker error, falling back to main thread:', err);
        this.workerFailed = true;
        this.workerReady = false;
        for (const [, pending] of this.pendingRequests) {
          pending.reject(new Error('Worker error: ' + (err.message || 'unknown')));
        }
        this.pendingRequests.clear();
        this.messageQueue = [];
      };
    } catch (err) {
      console.warn('Failed to create jq worker, will use main thread:', err);
      this.workerFailed = true;
    }
  }

  /**
   * @private
   * @param {MessageEvent} e
   */
  _handleWorkerMessage(e) {
    const msg = e.data;
    const { type, id, message } = msg;

    if (type === 'ready') {
      this.workerReady = true;
      for (const m of this.messageQueue) this.worker.postMessage(m);
      this.messageQueue = [];
      return;
    }

    if (type === 'init_error') {
      console.warn('jq worker init failed:', message, '— falling back to main thread');
      this.workerFailed = true;
      this.workerReady = false;
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error('Worker init failed: ' + message));
      }
      this.pendingRequests.clear();
      this.messageQueue = [];
      return;
    }

    const pending = this.pendingRequests.get(id);
    if (!pending) return; // 이미 교체된 요청의 응답 → 무시

    this.pendingRequests.delete(id);
    if (type === 'result') {
      // Worker가 Transferable ArrayBuffer로 결과를 반환
      let resultText;
      if (msg.resultBuffer !== undefined) {
        const buf = msg.resultBuffer;
        resultText = buf.byteLength > 0
          ? new TextDecoder().decode(new Uint8Array(buf))
          : '[]';
      } else {
        // 폴백: resultText 직접 수신 (이전 호환)
        resultText = msg.resultText || '[]';
      }
      pending.resolve({ resultText, executionTime: msg.executionTime });
    } else if (type === 'formatted') {
      // formatResult 응답
      if (msg.error) {
        pending.reject(new Error(msg.error));
      } else {
        pending.resolve(msg);
      }
    } else if (type === 'error') {
      pending.reject(new Error(message));
    }
  }

  /**
   * Execute a jq query against a JSON input string.
   * Routes to the Worker when available, otherwise falls back to the main thread.
   * @param {string} input - JSON string to process
   * @param {string} query - jq filter expression
   * @returns {Promise<ExecuteResult>}
   */
  async execute(input, query) {
    if (this.worker && !this.workerFailed) {
      return this._executeInWorker(input, query);
    }
    return this._executeMainThread(input, query);
  }

  /**
   * Worker에 입력이 변경되었을 때만 setInput 전송
   */
  _sendInputIfChanged(input) {
    if (input !== this._lastSentInput) {
      this._lastSentInput = input;
      const msg = { type: 'setInput', input };
      if (this.workerReady) {
        this.worker.postMessage(msg);
      } else {
        this.messageQueue.push(msg);
      }
    }
  }

  /**
   * @private
   * @param {string} input
   * @param {string} query
   * @returns {Promise<ExecuteResult>}
   */
  _executeInWorker(input, query) {
    // 입력 변경 시에만 전송 (2MB+ 데이터 재전송 방지)
    this._sendInputIfChanged(input);

    return new Promise((resolve, reject) => {
      const id = ++this.requestIdCounter;
      this.pendingRequests.set(id, { resolve, reject });
      // execute 메시지에는 input 없이 query만 전송
      const msg = { type: 'execute', id, query };
      if (this.workerReady) {
        this.worker.postMessage(msg);
      } else {
        this.messageQueue.push(msg);
      }
    });
  }

  /**
   * Worker에 포맷 변환 요청 (캐싱된 결과 사용)
   * @param {'json'|'csv'} format
   * @returns {Promise<FormatResult>}
   */
  formatResult(format) {
    if (!this.worker || this.workerFailed) {
      return Promise.reject(new Error('Worker not available'));
    }
    return new Promise((resolve, reject) => {
      const id = ++this.requestIdCounter;
      this.pendingRequests.set(id, { resolve, reject });
      const msg = { type: 'formatResult', id, format };
      if (this.workerReady) {
        this.worker.postMessage(msg);
      } else {
        this.messageQueue.push(msg);
      }
    });
  }

  /**
   * @private
   * @param {string} input
   * @param {string} query
   * @returns {Promise<ExecuteResult>}
   */
  async _executeMainThread(input, query) {
    if (!this.instance) {
      throw new Error('jq engine not initialized');
    }

    const startTime = performance.now();

    try {
      const parsedInput = JSON.parse(input);
      const result = await this.instance.json(parsedInput, query);
      const executionTime = performance.now() - startTime;
      const resultText = JSON.stringify(result, null, 2);
      return { result, resultText, executionTime };
    } catch (error) {
      const executionTime = performance.now() - startTime;
      // Handle empty result - jq-web throws "Unexpected end of JSON input" for empty output
      if (error.message && error.message.includes('Unexpected end of JSON input')) {
        return { result: [], resultText: '[]', executionTime };
      }
      throw error;
    }
  }

  /** 워커 종료. beforeunload에서 호출. */
  terminate() {
    if (this.worker) {
      terminateJqWorker(this.worker);
      this.worker = null;
      this.workerReady = false;
    }
    this._lastSentInput = null;
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('jq engine terminated'));
    }
    this.pendingRequests.clear();
    this.messageQueue = [];
  }

  /**
   * Execute partial query to infer context type
   * @param {string} input - JSON input data
   * @param {string} partialQuery - Query before current pipe position
   * @param {number} maxDepth - Maximum depth for key extraction (default 8)
   * @returns {Promise<ContextResult>}
   */
  async executeForContext(input, partialQuery, maxDepth = 8) {
    if (!this.instance) {
      throw new Error('jq engine not initialized');
    }

    try {
      // worker 경유 실행 — JSON.parse + WASM이 메인 스레드를 블로킹하지 않음
      const execResult = await this.execute(input, partialQuery) as ExecuteResult;
      // Worker 경로는 resultText만 반환, 메인스레드는 result도 반환
      const result = execResult.result !== undefined
        ? execResult.result
        : JSON.parse(execResult.resultText);

      // key extraction은 결과(소량)에 대해서만 실행
      if (Array.isArray(result)) {
        if (result.length > 0 && typeof result[0] === 'object') {
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
    } catch {
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
   * @returns {Promise<ContextResult>}
   */
  async executeForContextWithTimeout(input, partialQuery, timeout = 2000) {
    let timer;
    try {
      return await Promise.race([
        this.executeForContext(input, partialQuery),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Context execution timeout')), timeout);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}

export const jqEngine = new JqEngine();
