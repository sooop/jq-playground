/**
 * @file Shared JSDoc type definitions for the jq playground.
 * Import this file nowhere — it exists only for type-checker consumption.
 */

// ─── jq Engine ───────────────────────────────────────────────────────────────

/**
 * Raw execution result returned by the jq engine.
 * Worker path returns only `resultText`; main-thread path also returns `result`.
 * @typedef {Object} ExecuteResult
 * @property {string}  resultText    - JSON-stringified output
 * @property {number}  executionTime - Wall-clock time in milliseconds
 * @property {*}       [result]      - Parsed JS value (main-thread only)
 */

/**
 * Context inference result used by the autocomplete system.
 * @typedef {Object} ContextResult
 * @property {'array'|'object'|'string'|'number'|'boolean'|'any'} type - jq result type
 * @property {string[]} keys - Dot-notation key paths extracted from the result
 */

/**
 * Formatted output result returned by `JqEngine.formatResult`.
 * @typedef {Object} FormatResult
 * @property {'json'|'csv'} format   - Requested format
 * @property {string}  [resultText]  - Re-stringified JSON (format === 'json')
 * @property {string}  [html]        - HTML table string  (format === 'csv')
 * @property {string}  [csv]         - Raw CSV string     (format === 'csv')
 */

// ─── Storage ─────────────────────────────────────────────────────────────────

/**
 * A single entry stored in the input-history store.
 * @typedef {Object} InputHistoryEntry
 * @property {number}  id          - Auto-incremented primary key
 * @property {string}  content     - Formatted JSON or plain text
 * @property {string}  contentHash - FNV-1a hash of `content` (deduplication)
 * @property {string|null} fileName - Original file name, or null
 * @property {number}  size        - `content.length` (byte approximation)
 * @property {string}  timestamp   - ISO-8601 creation time
 * @property {string}  lastUsed    - ISO-8601 last-access time
 */

/**
 * A single entry stored in the query-history store.
 * @typedef {Object} QueryHistoryEntry
 * @property {number} id        - Auto-incremented primary key (or array index for localStorage)
 * @property {string} query     - The jq query string
 * @property {string} [timestamp] - ISO-8601 creation time (IndexedDB only)
 */

/**
 * A saved / bookmarked query.
 * @typedef {Object} SavedQuery
 * @property {number} id        - Auto-incremented primary key
 * @property {string} name      - User-supplied label
 * @property {string} query     - The jq query string
 * @property {string} timestamp - ISO-8601 creation time
 */

// ─── Autocomplete ─────────────────────────────────────────────────────────────

/**
 * Cached input-key entry held by `AutocompleteCache`.
 * @typedef {Object} InputKeysCache
 * @property {string[]} keys       - Dot-notation key paths
 * @property {boolean}  incomplete - `true` while background extraction is still running
 * @property {number}   timestamp  - `Date.now()` at last update
 */

/**
 * Cached context-key entry held by `AutocompleteCache`.
 * @typedef {Object} ContextKeysCache
 * @property {string[]} keys       - Dot-notation key paths
 * @property {string}   type       - jq result type string
 * @property {number}   timestamp  - `Date.now()` at last update (used for LRU + TTL)
 */

// ─── Panel sizes ──────────────────────────────────────────────────────────────

/**
 * Persisted panel split ratios.
 * @typedef {Object} PanelSizes
 * @property {number} horizontal - Left panel width as a percentage (20–80)
 * @property {number} vertical   - Top panel height as a percentage (20–80)
 */

export {};
