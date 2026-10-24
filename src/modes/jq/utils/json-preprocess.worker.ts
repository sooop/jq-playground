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

export interface PreprocessWorkerScanRequest {
  type: 'scan';
  jobId: number;
  text: string;
  options: PreprocessOptions;
}

export interface PreprocessWorkerFormatRequest {
  type: 'format';
  jobId: number;
  candidateIndex: number;
}

/** 선택한 후보(또는 문서 전체) 안의 stringified 필드 트리를 스캔 */
export interface PreprocessWorkerFieldsRequest {
  type: 'fields';
  jobId: number;
  /** null이면 Extract를 쓰지 않고 소스 텍스트 전체를 문서로 본다 */
  candidateIndex: number | null;
}

/** 선택된 경로만 풀어낸 최종 텍스트를 만든다 */
export interface PreprocessWorkerRenderRequest {
  type: 'render';
  jobId: number;
  selectedKeys: string[];
  preserveFormat: boolean;
}

export type PreprocessWorkerRequest =
  | PreprocessWorkerScanRequest
  | PreprocessWorkerFormatRequest
  | PreprocessWorkerFieldsRequest
  | PreprocessWorkerRenderRequest;

export interface PreprocessWorkerScanResponse {
  type: 'scan';
  jobId: number;
  candidates: JsonCandidateMeta[];
  warnings: string[];
  error?: string;
}

export interface PreprocessWorkerFormatResponse {
  type: 'format';
  jobId: number;
  candidateIndex: number;
  formatted: string;
  error?: string;
}

export interface PreprocessWorkerFieldsResponse {
  type: 'fields';
  jobId: number;
  nodes: StringifiedNode[];
  rootFallback: boolean;
  spansAvailable: boolean;
  truncated: boolean;
  warnings: string[];
  error?: string;
}

export interface PreprocessWorkerRenderResponse {
  type: 'render';
  jobId: number;
  formatted: string;
  error?: string;
}

export type PreprocessWorkerResponse =
  | PreprocessWorkerScanResponse
  | PreprocessWorkerFormatResponse
  | PreprocessWorkerFieldsResponse
  | PreprocessWorkerRenderResponse;

interface JobEntry {
  text: string;
  candidates: JsonCandidate[];
  scan?: DocumentScan;
}

// 파싱 결과는 Worker 안에만 두고 메인 스레드로는 메타데이터만 보낸다
const jobCache = new Map<number, JobEntry>();

/** 후보(또는 소스 전체)를 문서로 보고 그 텍스트를 돌려준다 */
export function baseTextFor(entry: JobEntry, candidateIndex: number | null): string {
  if (candidateIndex === null) return entry.text;
  const candidate = entry.candidates.find(c => c.index === candidateIndex);
  if (!candidate) throw new Error('Candidate not found');
  return entry.text.slice(candidate.start, candidate.end);
}

self.onmessage = (e: MessageEvent<PreprocessWorkerRequest>) => {
  const msg = e.data;

  if (msg.type === 'scan') {
    try {
      const result = preprocessJson(msg.text, msg.options);
      jobCache.set(msg.jobId, { text: msg.text, candidates: result.candidates });

      const response: PreprocessWorkerScanResponse = {
        type: 'scan',
        jobId: msg.jobId,
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
      self.postMessage(response);
    } catch (err) {
      const response: PreprocessWorkerScanResponse = {
        type: 'scan',
        jobId: msg.jobId,
        candidates: [],
        warnings: [],
        error: (err as Error).message,
      };
      self.postMessage(response);
    }
    return;
  }

  if (msg.type === 'fields') {
    try {
      const entry = jobCache.get(msg.jobId);
      if (!entry) throw new Error('Job not found');

      const scan = scanDocument(baseTextFor(entry, msg.candidateIndex));
      entry.scan = scan;

      const response: PreprocessWorkerFieldsResponse = {
        type: 'fields',
        jobId: msg.jobId,
        nodes: scan.nodes,
        rootFallback: scan.rootFallback,
        spansAvailable: scan.spansAvailable,
        truncated: scan.truncated,
        warnings: scan.warnings,
      };
      self.postMessage(response);
    } catch (err) {
      const response: PreprocessWorkerFieldsResponse = {
        type: 'fields',
        jobId: msg.jobId,
        nodes: [],
        rootFallback: false,
        spansAvailable: false,
        truncated: false,
        warnings: [],
        error: (err as Error).message,
      };
      self.postMessage(response);
    }
    return;
  }

  if (msg.type === 'render') {
    try {
      const scan = jobCache.get(msg.jobId)?.scan;
      if (!scan) throw new Error('Scan not found');

      const response: PreprocessWorkerRenderResponse = {
        type: 'render',
        jobId: msg.jobId,
        formatted: renderResult(scan, new Set(msg.selectedKeys), msg.preserveFormat),
      };
      self.postMessage(response);
    } catch (err) {
      const response: PreprocessWorkerRenderResponse = {
        type: 'render',
        jobId: msg.jobId,
        formatted: '',
        error: (err as Error).message,
      };
      self.postMessage(response);
    }
    return;
  }

  if (msg.type === 'format') {
    try {
      const cached = jobCache.get(msg.jobId);
      const candidate = cached?.candidates.find(c => c.index === msg.candidateIndex);
      if (!candidate) {
        const response: PreprocessWorkerFormatResponse = {
          type: 'format',
          jobId: msg.jobId,
          candidateIndex: msg.candidateIndex,
          formatted: '',
          error: 'Candidate not found',
        };
        self.postMessage(response);
        return;
      }

      const response: PreprocessWorkerFormatResponse = {
        type: 'format',
        jobId: msg.jobId,
        candidateIndex: msg.candidateIndex,
        formatted: formatCandidate(candidate),
      };
      self.postMessage(response);
    } catch (err) {
      const response: PreprocessWorkerFormatResponse = {
        type: 'format',
        jobId: msg.jobId,
        candidateIndex: msg.candidateIndex,
        formatted: '',
        error: (err as Error).message,
      };
      self.postMessage(response);
    }
  }
};

export {};
