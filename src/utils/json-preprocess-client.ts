import {
  preprocessJson,
  formatCandidate,
  type PreprocessOptions,
  type JsonCandidateMeta,
} from './json-preprocessor';
import type {
  PreprocessWorkerRequest,
  PreprocessWorkerResponse,
} from './json-preprocess.worker';

const WORKER_IDLE_MS = 30000;
const SIZE_FORCE_WORKER = 1024 * 1024; // 1MB

let worker: Worker | null = null;
let workerUrl: string | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let nextJobId = 1;

function getWorker(): Worker {
  if (idleTimer !== null) clearTimeout(idleTimer);

  if (!worker) {
    worker = new Worker(
      new URL('./json-preprocess.worker.ts', import.meta.url),
      { type: 'module' }
    );
  }

  idleTimer = setTimeout(() => {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    if (workerUrl) {
      URL.revokeObjectURL(workerUrl);
      workerUrl = null;
    }
  }, WORKER_IDLE_MS);

  return worker;
}

function runOnMainThread(
  text: string,
  options: PreprocessOptions
): { candidates: JsonCandidateMeta[]; warnings: string[] } {
  const result = preprocessJson(text, options);
  return {
    candidates: result.candidates.map(c => ({
      index: c.index,
      start: c.start,
      end: c.end,
      preview: c.preview,
      kind: c.kind,
      line: c.line,
    })),
    warnings: result.warnings,
  };
}

function formatOnMainThread(text: string, options: PreprocessOptions, candidateIndex: number): string {
  const result = preprocessJson(text, options);
  const candidate = result.candidates.find(c => c.index === candidateIndex);
  if (!candidate) throw new Error('Candidate not found');
  return formatCandidate(candidate);
}

function shouldUseWorker(text: string): boolean {
  return text.length >= SIZE_FORCE_WORKER;
}

function postToWorker<T extends PreprocessWorkerResponse>(
  request: PreprocessWorkerRequest,
  expectedType: T['type']
): Promise<T> {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const jobId = request.jobId;

    const onMessage = (e: MessageEvent<PreprocessWorkerResponse>) => {
      if (e.data.jobId !== jobId || e.data.type !== expectedType) return;
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      if ('error' in e.data && e.data.error) {
        reject(new Error(e.data.error));
      } else {
        resolve(e.data as T);
      }
    };

    const onError = (err: ErrorEvent) => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      reject(err.error ?? new Error('Worker error'));
    };

    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage(request);
  });
}

export interface ScanResult {
  jobId: number;
  candidates: JsonCandidateMeta[];
  warnings: string[];
}

export interface PreprocessClient {
  scan(text: string, options: PreprocessOptions): Promise<ScanResult>;
  format(jobId: number, candidateIndex: number, text: string, options: PreprocessOptions): Promise<string>;
  cancel(): void;
}

export function createPreprocessClient(): PreprocessClient {
  let activeJobId: number | null = null;
  let lastScanContext: { text: string; options: PreprocessOptions } | null = null;

  return {
    async scan(text, options) {
      const jobId = nextJobId++;
      activeJobId = jobId;
      lastScanContext = { text, options };

      if (!shouldUseWorker(text)) {
        // Small inputs: main thread is fine
        await new Promise<void>(r => setTimeout(r, 0));
        if (activeJobId !== jobId) throw new Error('Cancelled');
        const result = runOnMainThread(text, options);
        return { jobId, ...result };
      }

      try {
        const response = await postToWorker(
          { type: 'scan', jobId, text, options },
          'scan'
        );
        if (activeJobId !== jobId) throw new Error('Cancelled');
        return {
          jobId,
          candidates: response.candidates,
          warnings: response.warnings,
        };
      } catch {
        // Worker unavailable (e.g. single-file build) — fallback
        if (activeJobId !== jobId) throw new Error('Cancelled');
        const result = runOnMainThread(text, options);
        return { jobId, ...result };
      }
    },

    async format(jobId, candidateIndex, text, options) {
      if (!shouldUseWorker(text)) {
        await new Promise<void>(r => setTimeout(r, 0));
        return formatOnMainThread(text, options, candidateIndex);
      }

      try {
        const response = await postToWorker(
          { type: 'format', jobId, candidateIndex },
          'format'
        );
        return response.formatted;
      } catch {
        return formatOnMainThread(text, options, candidateIndex);
      }
    },

    cancel() {
      activeJobId = null;
      lastScanContext = null;
    },
  };
}

export const SIZE_LIMITS = {
  WARN: 5 * 1024 * 1024,
  CONFIRM: 10 * 1024 * 1024,
  REJECT: 20 * 1024 * 1024,
} as const;

export function checkSizeGuard(text: string): { ok: true } | { ok: false; reason: string } {
  if (text.length > SIZE_LIMITS.REJECT) {
    return { ok: false, reason: '입력이 20MB를 초과합니다. 파일을 잘라서 시도하세요.' };
  }
  return { ok: true };
}

export function needsSizeConfirm(text: string): boolean {
  return text.length > SIZE_LIMITS.CONFIRM;
}

export function needsSizeWarning(text: string): boolean {
  return text.length > SIZE_LIMITS.WARN;
}

export { suggestDefaultOptions, detectExtractLikely, detectUnstringifyLikely } from './json-preprocessor';
