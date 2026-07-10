import {
  preprocessJson,
  formatCandidate,
  type PreprocessOptions,
  type JsonCandidateMeta,
} from './json-preprocessor';

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

export type PreprocessWorkerRequest = PreprocessWorkerScanRequest | PreprocessWorkerFormatRequest;

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

export type PreprocessWorkerResponse = PreprocessWorkerScanResponse | PreprocessWorkerFormatResponse;

// In-memory cache of parsed candidates per job (Worker-only, not sent to main)
const jobCache = new Map<number, { candidates: ReturnType<typeof preprocessJson>['candidates'] }>();

self.onmessage = (e: MessageEvent<PreprocessWorkerRequest>) => {
  const msg = e.data;

  if (msg.type === 'scan') {
    try {
      const result = preprocessJson(msg.text, msg.options);
      jobCache.set(msg.jobId, { candidates: result.candidates });

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
