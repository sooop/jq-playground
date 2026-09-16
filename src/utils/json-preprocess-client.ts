import {
  preprocessJson,
  formatCandidate,
  type PreprocessOptions,
  type JsonCandidateMeta,
  type JsonCandidate,
} from './json-preprocessor';
import {
  scanDocument,
  renderResult,
  type DocumentScan,
  type StringifiedNode,
} from './stringified-fields';
import type {
  PreprocessWorkerRequest,
  PreprocessWorkerResponse,
  PreprocessWorkerScanResponse,
  PreprocessWorkerFormatResponse,
  PreprocessWorkerFieldsResponse,
  PreprocessWorkerRenderResponse,
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

/* ------------------------------------------------------------------ */
/* 메인 스레드 폴백용 캐시                                                */
/* ------------------------------------------------------------------ */

interface LocalJob {
  text: string;
  candidates: JsonCandidate[];
  scan?: DocumentScan;
}

const localJobs = new Map<number, LocalJob>();

function toMeta(c: JsonCandidate): JsonCandidateMeta {
  return {
    index: c.index,
    start: c.start,
    end: c.end,
    preview: c.preview,
    kind: c.kind,
    line: c.line,
  };
}

function baseTextFor(job: LocalJob, candidateIndex: number | null): string {
  if (candidateIndex === null) return job.text;
  const candidate = job.candidates.find(c => c.index === candidateIndex);
  if (!candidate) throw new Error('Candidate not found');
  return job.text.slice(candidate.start, candidate.end);
}

function scanOnMainThread(
  jobId: number,
  text: string,
  options: PreprocessOptions
): { candidates: JsonCandidateMeta[]; warnings: string[] } {
  const result = preprocessJson(text, options);
  localJobs.set(jobId, { text, candidates: result.candidates });
  return {
    candidates: result.candidates.map(toMeta),
    warnings: result.warnings,
  };
}

function fieldsOnMainThread(jobId: number, candidateIndex: number | null): FieldsResult {
  const job = localJobs.get(jobId);
  if (!job) throw new Error('Job not found');
  const scan = scanDocument(baseTextFor(job, candidateIndex));
  job.scan = scan;
  return {
    nodes: scan.nodes,
    rootFallback: scan.rootFallback,
    spansAvailable: scan.spansAvailable,
    truncated: scan.truncated,
    warnings: scan.warnings,
  };
}

function renderOnMainThread(jobId: number, selectedKeys: string[], preserveFormat: boolean): string {
  const scan = localJobs.get(jobId)?.scan;
  if (!scan) throw new Error('Scan not found');
  return renderResult(scan, new Set(selectedKeys), preserveFormat);
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

export interface FieldsResult {
  nodes: StringifiedNode[];
  rootFallback: boolean;
  spansAvailable: boolean;
  truncated: boolean;
  warnings: string[];
}

export interface PreprocessClient {
  scan(text: string, options: PreprocessOptions): Promise<ScanResult>;
  /** 선택한 후보(또는 candidateIndex === null 이면 소스 전체) 안의 stringified 필드 트리 */
  fields(jobId: number, candidateIndex: number | null): Promise<FieldsResult>;
  /** 선택된 경로만 풀어낸 결과 텍스트 */
  render(jobId: number, selectedKeys: string[], preserveFormat: boolean): Promise<string>;
  format(jobId: number, candidateIndex: number, text: string, options: PreprocessOptions): Promise<string>;
  cancel(): void;
}

export function createPreprocessClient(): PreprocessClient {
  let activeJobId: number | null = null;
  // scan이 어느 경로로 돌았는지 기억해야 fields/render가 같은 캐시를 본다
  const usesWorker = new Map<number, boolean>();

  return {
    async scan(text, options) {
      const jobId = nextJobId++;
      activeJobId = jobId;

      if (!shouldUseWorker(text)) {
        // Small inputs: main thread is fine
        await new Promise<void>(r => setTimeout(r, 0));
        if (activeJobId !== jobId) throw new Error('Cancelled');
        usesWorker.set(jobId, false);
        return { jobId, ...scanOnMainThread(jobId, text, options) };
      }

      try {
        const response = await postToWorker<PreprocessWorkerScanResponse>(
          { type: 'scan', jobId, text, options },
          'scan'
        );
        if (activeJobId !== jobId) throw new Error('Cancelled');
        usesWorker.set(jobId, true);
        return {
          jobId,
          candidates: response.candidates,
          warnings: response.warnings,
        };
      } catch (err) {
        // Worker unavailable (e.g. single-file build) — fallback
        if (activeJobId !== jobId) throw new Error('Cancelled');
        if ((err as Error).message === 'Cancelled') throw err;
        usesWorker.set(jobId, false);
        return { jobId, ...scanOnMainThread(jobId, text, options) };
      }
    },

    async fields(jobId, candidateIndex) {
      if (usesWorker.get(jobId)) {
        try {
          const response = await postToWorker<PreprocessWorkerFieldsResponse>(
            { type: 'fields', jobId, candidateIndex },
            'fields'
          );
          return {
            nodes: response.nodes,
            rootFallback: response.rootFallback,
            spansAvailable: response.spansAvailable,
            truncated: response.truncated,
            warnings: response.warnings,
          };
        } catch {
          // Worker가 죽었으면 메인 스레드 캐시로 되살린다
          usesWorker.set(jobId, false);
        }
      }
      await new Promise<void>(r => setTimeout(r, 0));
      return fieldsOnMainThread(jobId, candidateIndex);
    },

    async render(jobId, selectedKeys, preserveFormat) {
      if (usesWorker.get(jobId)) {
        try {
          const response = await postToWorker<PreprocessWorkerRenderResponse>(
            { type: 'render', jobId, selectedKeys, preserveFormat },
            'render'
          );
          return response.formatted;
        } catch {
          usesWorker.set(jobId, false);
        }
      }
      await new Promise<void>(r => setTimeout(r, 0));
      return renderOnMainThread(jobId, selectedKeys, preserveFormat);
    },

    async format(jobId, candidateIndex, text, options) {
      if (!shouldUseWorker(text)) {
        await new Promise<void>(r => setTimeout(r, 0));
        return formatOnMainThread(text, options, candidateIndex);
      }

      try {
        const response = await postToWorker<PreprocessWorkerFormatResponse>(
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
      localJobs.clear();
      usesWorker.clear();
    },
  };
}

export const SIZE_LIMITS = {
  WARN: 5 * 1024 * 1024,
  CONFIRM: 10 * 1024 * 1024,
  REJECT: 20 * 1024 * 1024,
} as const;

// strictNullChecks가 꺼져 있어 판별 유니온 narrowing이 동작하지 않으므로 reason을 optional로 둔다
export function checkSizeGuard(text: string): { ok: boolean; reason?: string } {
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
