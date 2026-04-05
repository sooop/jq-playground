// ─── jq Engine ───────────────────────────────────────────────────────────────

/** Raw execution result returned by the jq engine. */
export interface ExecuteResult {
  /** JSON-stringified output */
  resultText: string;
  /** Wall-clock time in milliseconds */
  executionTime: number;
  /** Parsed JS value (main-thread only) */
  result?: unknown;
}

/** Context inference result used by the autocomplete system. */
export interface ContextResult {
  type: 'array' | 'object' | 'string' | 'number' | 'boolean' | 'any';
  /** Dot-notation key paths extracted from the result */
  keys: string[];
}

/** Formatted output result returned by `JqEngine.formatResult`. */
export interface FormatResult {
  format: 'json' | 'csv';
  /** Re-stringified JSON (format === 'json') */
  resultText?: string;
  /** HTML table string (format === 'csv') */
  html?: string;
  /** Raw CSV string (format === 'csv') */
  csv?: string;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

/** A single entry stored in the input-history store. */
export interface InputHistoryEntry {
  /** Auto-incremented primary key */
  id: number;
  /** Formatted JSON or plain text */
  content: string;
  /** FNV-1a hash of `content` (deduplication) */
  contentHash: string;
  /** Original file name, or null */
  fileName: string | null;
  /** `content.length` (byte approximation) */
  size: number;
  /** ISO-8601 creation time */
  timestamp: string;
  /** ISO-8601 last-access time */
  lastUsed: string;
}

/** A single entry stored in the query-history store. */
export interface QueryHistoryEntry {
  /** Auto-incremented primary key (or array index for localStorage) */
  id: number;
  /** The jq query string */
  query: string;
  /** ISO-8601 creation time (IndexedDB only) */
  timestamp?: string;
}

/** A saved / bookmarked query. */
export interface SavedQuery {
  /** Auto-incremented primary key */
  id: number;
  /** User-supplied label */
  name: string;
  /** The jq query string */
  query: string;
  /** ISO-8601 creation time */
  timestamp: string;
}

// ─── Autocomplete ─────────────────────────────────────────────────────────────

/** Cached input-key entry held by `AutocompleteCache`. */
export interface InputKeysCache {
  /** Dot-notation key paths */
  keys: string[];
  /** `true` while background extraction is still running */
  incomplete: boolean;
  /** `Date.now()` at last update */
  timestamp: number;
}

/** Cached context-key entry held by `AutocompleteCache`. */
export interface ContextKeysCache {
  /** Dot-notation key paths */
  keys: string[];
  /** jq result type string */
  type: string;
  /** `Date.now()` at last update (used for LRU + TTL) */
  timestamp: number;
}

// ─── Panel sizes ──────────────────────────────────────────────────────────────

/** Persisted panel split ratios. */
export interface PanelSizes {
  /** Left panel width as a percentage (20–80) */
  horizontal: number;
  /** Top panel height as a percentage (20–80) */
  vertical: number;
}

// ─── Component API pattern ────────────────────────────────────────────────────

/**
 * An HTMLElement augmented with a typed `.api` property.
 * Each `create*()` factory casts its return value to this type.
 */
export type ComponentElement<T> = HTMLElement & { api: T };

export interface OutputPanelApi {
  showLoading(): void;
  showResult(data: unknown, format: string, executionTime?: number): void;
  showResultText(resultText: string, format: string, executionTime?: number): void;
  showFormattedResult(content: string, format: string, csvCache?: string, executionTime?: number): void;
  showError(message: string, autoHideDuration?: number | false): void;
  hideError(): void;
  getFormat(): string;
  getLastResultText(): string | null;
  clear(): void;
  isAutoPlayEnabled(): boolean;
  toggleAutoPlay(): void;
}

/** OutputPanel element with optional external callback. */
export type OutputPanelElement = ComponentElement<OutputPanelApi> & {
  onAutoPlayToggle?: (enabled: boolean) => void;
};

export interface InputPanelApi {
  getCurrentFileName(): string | null;
  restoreInput(content: string, fileName: string | null): void;
  setAutoPlayIndicator(enabled: boolean): void;
}

export interface QueryPanelApi {
  getQuery(): string;
  addToHistory(query: string): Promise<void>;
  saveQuery(name: string, query: string): void;
  terminateWorker?(): void;
  invalidateCache(): void;
  getCacheStats(): unknown;
}

export interface PanelToggleApi {
  toggle(): void;
  close(): void;
  open(): void;
}

export interface SaveQueryModalApi {
  show(query: string): void;
  hide(): void;
}

export interface HelpModalApi {
  show(): void;
  hide(): void;
}
