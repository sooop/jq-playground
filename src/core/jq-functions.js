// jq built-in functions and operators
// inputType: 'any' (default), 'array', 'object', 'string', 'number', 'item' (individual element), 'array|object'
export const JQ_FUNCTIONS = [
  // Basic filters
  { name: '.', desc: 'Identity filter', inputType: 'any' },
  { name: '..', desc: 'Recursive descent', inputType: 'any' },
  { name: '.[]', desc: 'Array/object value iterator', inputType: 'array|object' },
  { name: '.foo', desc: 'Object field access', inputType: 'object' },

  // Types
  { name: 'type', desc: 'Get value type', inputType: 'any' },
  { name: 'length', desc: 'Get length of value', inputType: 'any' },
  { name: 'keys', desc: 'Get object keys or array indices', inputType: 'array|object' },
  { name: 'keys_unsorted', desc: 'Get keys without sorting', inputType: 'array|object' },
  { name: 'values', desc: 'Get all values', inputType: 'array|object' },
  { name: 'empty', desc: 'Return no results', inputType: 'any' },
  { name: 'null', desc: 'Null value', inputType: 'any' },

  // Array operations
  { name: 'map', desc: 'Map expression over array', inputType: 'array' },
  { name: 'select', desc: 'Filter by condition (use on individual items)', inputType: 'item' },
  { name: 'sort', desc: 'Sort array', inputType: 'array' },
  { name: 'sort_by', desc: 'Sort by expression', inputType: 'array' },
  { name: 'reverse', desc: 'Reverse array', inputType: 'array' },
  { name: 'unique', desc: 'Get unique values', inputType: 'array' },
  { name: 'unique_by', desc: 'Get unique values by expression', inputType: 'array' },
  { name: 'group_by', desc: 'Group by expression', inputType: 'array' },
  { name: 'flatten', desc: 'Flatten array', inputType: 'array' },
  { name: 'add', desc: 'Add/concatenate array elements', inputType: 'array' },
  { name: 'min', desc: 'Get minimum value', inputType: 'array' },
  { name: 'max', desc: 'Get maximum value', inputType: 'array' },
  { name: 'min_by', desc: 'Get minimum by expression', inputType: 'array' },
  { name: 'max_by', desc: 'Get maximum by expression', inputType: 'array' },
  { name: 'first', desc: 'Get first element', inputType: 'array' },
  { name: 'last', desc: 'Get last element', inputType: 'array' },
  { name: 'nth', desc: 'Get nth element', inputType: 'array' },
  { name: 'indices', desc: 'Get indices of value', inputType: 'array|string' },
  { name: 'index', desc: 'Get first index of value', inputType: 'array|string' },
  { name: 'rindex', desc: 'Get last index of value', inputType: 'array|string' },
  { name: 'inside', desc: 'Check if inside another value', inputType: 'any' },
  { name: 'contains', desc: 'Check if contains value', inputType: 'any' },
  { name: 'has', desc: 'Check if has key', inputType: 'array|object' },
  { name: 'in', desc: 'Check if key is in object', inputType: 'any' },
  { name: 'any', desc: 'Check if any element matches', inputType: 'array' },
  { name: 'all', desc: 'Check if all elements match', inputType: 'array' },
  { name: 'limit', desc: 'Limit number of outputs', inputType: 'any' },
  { name: 'until', desc: 'Repeat until condition', inputType: 'any' },
  { name: 'while', desc: 'Repeat while condition', inputType: 'any' },
  { name: 'repeat', desc: 'Repeat expression', inputType: 'any' },
  { name: 'range', desc: 'Generate range of numbers', inputType: 'any' },
  { name: 'recurse', desc: 'Recursive application', inputType: 'any' },
  { name: 'walk', desc: 'Walk through structure', inputType: 'any' },
  { name: 'transpose', desc: 'Transpose matrix', inputType: 'array' },

  // String operations
  { name: 'tostring', desc: 'Convert to string', inputType: 'any' },
  { name: 'tonumber', desc: 'Convert to number', inputType: 'any' },
  { name: 'ascii_downcase', desc: 'Convert to lowercase', inputType: 'string' },
  { name: 'ascii_upcase', desc: 'Convert to uppercase', inputType: 'string' },
  { name: 'startswith', desc: 'Check if starts with string', inputType: 'string' },
  { name: 'endswith', desc: 'Check if ends with string', inputType: 'string' },
  { name: 'ltrimstr', desc: 'Remove prefix string', inputType: 'string' },
  { name: 'rtrimstr', desc: 'Remove suffix string', inputType: 'string' },
  { name: 'split', desc: 'Split string', inputType: 'string' },
  { name: 'join', desc: 'Join array to string', inputType: 'array' },
  { name: 'test', desc: 'Test regex match', inputType: 'string' },
  { name: 'match', desc: 'Match regex', inputType: 'string' },
  { name: 'capture', desc: 'Capture regex groups', inputType: 'string' },
  { name: 'splits', desc: 'Split by regex', inputType: 'string' },
  { name: 'sub', desc: 'Substitute first regex match', inputType: 'string' },
  { name: 'gsub', desc: 'Substitute all regex matches', inputType: 'string' },
  { name: 'implode', desc: 'Convert codepoints to string', inputType: 'array' },
  { name: 'explode', desc: 'Convert string to codepoints', inputType: 'string' },

  // Math operations
  { name: 'floor', desc: 'Round down to integer', inputType: 'number' },
  { name: 'ceil', desc: 'Round up to integer', inputType: 'number' },
  { name: 'round', desc: 'Round to nearest integer', inputType: 'number' },
  { name: 'sqrt', desc: 'Square root', inputType: 'number' },
  { name: 'pow', desc: 'Power', inputType: 'number' },
  { name: 'log', desc: 'Natural logarithm', inputType: 'number' },
  { name: 'log10', desc: 'Base-10 logarithm', inputType: 'number' },
  { name: 'log2', desc: 'Base-2 logarithm', inputType: 'number' },
  { name: 'exp', desc: 'Exponential', inputType: 'number' },
  { name: 'exp10', desc: 'Base-10 exponential', inputType: 'number' },
  { name: 'exp2', desc: 'Base-2 exponential', inputType: 'number' },
  { name: 'sin', desc: 'Sine', inputType: 'number' },
  { name: 'cos', desc: 'Cosine', inputType: 'number' },
  { name: 'tan', desc: 'Tangent', inputType: 'number' },
  { name: 'asin', desc: 'Arcsine', inputType: 'number' },
  { name: 'acos', desc: 'Arccosine', inputType: 'number' },
  { name: 'atan', desc: 'Arctangent', inputType: 'number' },
  { name: 'fabs', desc: 'Absolute value', inputType: 'number' },

  // Object operations
  { name: 'to_entries', desc: 'Convert object to key-value pairs', inputType: 'object' },
  { name: 'from_entries', desc: 'Convert key-value pairs to object', inputType: 'array' },
  { name: 'with_entries', desc: 'Transform object entries', inputType: 'object' },
  { name: 'paths', desc: 'Get all paths', inputType: 'any' },
  { name: 'leaf_paths', desc: 'Get paths to leaf values', inputType: 'any' },
  { name: 'getpath', desc: 'Get value at path', inputType: 'any' },
  { name: 'setpath', desc: 'Set value at path', inputType: 'any' },
  { name: 'delpaths', desc: 'Delete paths', inputType: 'any' },

  // Date operations
  { name: 'now', desc: 'Current Unix timestamp', inputType: 'any' },
  { name: 'fromdateiso8601', desc: 'Parse ISO8601 date', inputType: 'string' },
  { name: 'todateiso8601', desc: 'Format as ISO8601 date', inputType: 'number' },
  { name: 'fromdate', desc: 'Parse Unix timestamp', inputType: 'number' },
  { name: 'todate', desc: 'Format Unix timestamp', inputType: 'number' },
  { name: 'strftime', desc: 'Format time string', inputType: 'number' },
  { name: 'strptime', desc: 'Parse time string', inputType: 'string' },
  { name: 'gmtime', desc: 'Convert to GMT time array', inputType: 'number' },
  { name: 'mktime', desc: 'Convert time array to timestamp', inputType: 'array' },

  // I/O and formatting
  { name: 'format', desc: 'Format string', inputType: 'string' },
  { name: '@base64', desc: 'Base64 encode', inputType: 'string' },
  { name: '@base64d', desc: 'Base64 decode', inputType: 'string' },
  { name: '@uri', desc: 'URI encode', inputType: 'string' },
  { name: '@csv', desc: 'CSV format', inputType: 'array' },
  { name: '@tsv', desc: 'TSV format', inputType: 'array' },
  { name: '@json', desc: 'JSON format', inputType: 'any' },
  { name: '@html', desc: 'HTML encode', inputType: 'string' },
  { name: '@text', desc: 'Plain text format', inputType: 'any' },
  { name: '@sh', desc: 'Shell escape', inputType: 'string' },

  // Control flow
  { name: 'if', desc: 'Conditional expression', inputType: 'any' },
  { name: 'then', desc: 'Then branch', inputType: 'any' },
  { name: 'else', desc: 'Else branch', inputType: 'any' },
  { name: 'elif', desc: 'Else-if branch', inputType: 'any' },
  { name: 'end', desc: 'End conditional', inputType: 'any' },
  { name: 'and', desc: 'Logical AND', inputType: 'any' },
  { name: 'or', desc: 'Logical OR', inputType: 'any' },
  { name: 'not', desc: 'Logical NOT', inputType: 'any' },
  { name: 'try', desc: 'Try expression', inputType: 'any' },
  { name: 'catch', desc: 'Catch error', inputType: 'any' },

  // Special
  { name: 'error', desc: 'Raise error', inputType: 'any' },
  { name: 'debug', desc: 'Debug output', inputType: 'any' },
  { name: 'env', desc: 'Environment variables', inputType: 'any' },
  { name: '$__loc__', desc: 'Location info', inputType: 'any' },
  { name: 'input', desc: 'Read next input', inputType: 'any' },
  { name: 'inputs', desc: 'Read all inputs', inputType: 'any' },
  { name: 'recurse_down', desc: 'Recursive descent', inputType: 'any' },
  { name: 'isnan', desc: 'Check if NaN', inputType: 'number' },
  { name: 'isinfinite', desc: 'Check if infinite', inputType: 'number' },
  { name: 'isfinite', desc: 'Check if finite', inputType: 'number' },
  { name: 'isnormal', desc: 'Check if normal', inputType: 'number' },
  { name: 'infinite', desc: 'Infinite value', inputType: 'any' },
  { name: 'nan', desc: 'NaN value', inputType: 'any' },

  // Advanced
  { name: 'path', desc: 'Get path to value', inputType: 'any' },
  { name: 'del', desc: 'Delete path', inputType: 'any' },
  { name: 'reduce', desc: 'Reduce expression', inputType: 'any' },
  { name: 'foreach', desc: 'Foreach loop', inputType: 'any' },
  { name: 'as', desc: 'Bind variable', inputType: 'any' },
  { name: 'def', desc: 'Define function', inputType: 'any' },
  { name: 'ascii', desc: 'ASCII value', inputType: 'string' },
  { name: 'utf8bytelength', desc: 'UTF-8 byte length', inputType: 'string' },
  { name: 'tojson', desc: 'Convert to JSON string', inputType: 'any' },
  { name: 'fromjson', desc: 'Parse JSON string', inputType: 'string' },
  { name: 'splits', desc: 'Split stream', inputType: 'string' },
  { name: 'scan', desc: 'Scan for regex matches', inputType: 'string' },
  { name: 'combinations', desc: 'Get combinations', inputType: 'array' },
  { name: 'until', desc: 'Until loop', inputType: 'any' },
  { name: 'limit', desc: 'Limit output', inputType: 'any' },
  { name: 'sql', desc: 'SQL-like operations', inputType: 'any' },
  { name: 'builtins', desc: 'List all builtin functions', inputType: 'any' },

  // Null/Boolean handling
  { name: 'null', desc: 'Null value', inputType: 'any' },
  { name: 'true', desc: 'Boolean true', inputType: 'any' },
  { name: 'false', desc: 'Boolean false', inputType: 'any' },
  { name: 'isvalid', desc: 'Check if valid', inputType: 'any' },
  { name: 'isnull', desc: 'Check if null', inputType: 'any' },
  { name: 'isboolean', desc: 'Check if boolean', inputType: 'any' },
  { name: 'isnumber', desc: 'Check if number', inputType: 'any' },
  { name: 'isstring', desc: 'Check if string', inputType: 'any' },
  { name: 'isarray', desc: 'Check if array', inputType: 'any' },
  { name: 'isobject', desc: 'Check if object', inputType: 'any' },
  { name: 'isempty', desc: 'Check if empty', inputType: 'any' },

  // Alternative operators
  { name: 'alternative', desc: 'Alternative operator //', inputType: 'any' },
  { name: 'optional', desc: 'Optional operator ?', inputType: 'any' },

  // Type filters
  { name: 'arrays', desc: 'Select only arrays', inputType: 'any' },
  { name: 'objects', desc: 'Select only objects', inputType: 'any' },
  { name: 'iterables', desc: 'Select only iterables', inputType: 'any' },
  { name: 'booleans', desc: 'Select only booleans', inputType: 'any' },
  { name: 'numbers', desc: 'Select only numbers', inputType: 'any' },
  { name: 'strings', desc: 'Select only strings', inputType: 'any' },
  { name: 'nulls', desc: 'Select only nulls', inputType: 'any' },
  { name: 'values', desc: 'Select only non-null values', inputType: 'any' },
  { name: 'scalars', desc: 'Select only scalar values', inputType: 'any' },
];

// Input type labels and colors
export const INPUT_TYPE_INFO = {
  'any': { label: 'any', color: '#999' },
  'array': { label: 'array', color: '#2563eb' },
  'object': { label: 'object', color: '#7c3aed' },
  'string': { label: 'string', color: '#059669' },
  'number': { label: 'number', color: '#dc2626' },
  'item': { label: 'item', color: '#ea580c' },
  'array|object': { label: 'array|obj', color: '#6366f1' },
  'array|string': { label: 'arr|str', color: '#0891b2' },
  'field': { label: 'field', color: '#f59e0b' },
  'variable': { label: 'var', color: '#e879f9' },
};

// Extract keys from JSON data for autocomplete
export function extractKeys(data, maxDepth = 8) {
  const keys = new Set();

  function traverse(obj, path, depth, isRoot = false) {
    if (depth > maxDepth || obj === null || obj === undefined) return;

    if (Array.isArray(obj)) {
      // For arrays, traverse first few items to find common structure
      const sampleSize = Math.min(obj.length, 5);
      for (let i = 0; i < sampleSize; i++) {
        // Skip [] prefix for root-level arrays to match context keys
        traverse(obj[i], isRoot ? path : path + '[]', depth, false);
      }
    } else if (typeof obj === 'object') {
      for (const key of Object.keys(obj)) {
        const newPath = path ? `${path}.${key}` : key;
        keys.add(newPath);
        traverse(obj[key], newPath, depth + 1, false);
      }
    }
  }

  traverse(data, '', 0, true);
  return Array.from(keys);
}

/**
 * Create an inline Web Worker for key extraction
 * Uses Blob URL for single-file build compatibility
 * @returns {Worker} Web Worker instance
 */
export function createKeyExtractionWorker() {
  const workerCode = `
    // Key extraction worker - BFS traversal with progress reporting
    const MAX_DEPTH = 8;
    const SAMPLE_SIZE = 5;
    const PROGRESS_INTERVAL = 100; // ms

    self.onmessage = function(e) {
      const { type, id, jsonString, options = {} } = e.data;

      if (type !== 'extract') return;

      const maxDepth = options.maxDepth || MAX_DEPTH;
      const sampleSize = options.sampleSize || SAMPLE_SIZE;
      const startTime = performance.now();

      try {
        const data = JSON.parse(jsonString);
        const keys = new Set();
        let lastProgressTime = startTime;
        let currentDepth = 0;

        // BFS queue: [{obj, path, depth}]
        const queue = [{ obj: data, path: '', depth: 0 }];

        while (queue.length > 0) {
          const { obj, path, depth } = queue.shift();

          // Track max depth reached
          if (depth > currentDepth) {
            currentDepth = depth;

            // Report progress periodically
            const now = performance.now();
            if (now - lastProgressTime > PROGRESS_INTERVAL) {
              lastProgressTime = now;
              self.postMessage({
                type: 'progress',
                id: id,
                currentDepth: currentDepth,
                keysFound: keys.size,
                keys: Array.from(keys)
              });
            }
          }

          if (depth > maxDepth || obj === null || obj === undefined) continue;

          if (Array.isArray(obj)) {
            // Sample array elements
            const len = Math.min(obj.length, sampleSize);
            for (let i = 0; i < len; i++) {
              if (obj[i] !== null && typeof obj[i] === 'object') {
                queue.push({ obj: obj[i], path: path + '[]', depth: depth });
              }
            }
          } else if (typeof obj === 'object') {
            const objKeys = Object.keys(obj);
            for (const key of objKeys) {
              const newPath = path ? path + '.' + key : key;
              keys.add(newPath);

              const value = obj[key];
              if (value !== null && typeof value === 'object') {
                queue.push({ obj: value, path: newPath, depth: depth + 1 });
              }
            }
          }
        }

        const endTime = performance.now();
        self.postMessage({
          type: 'result',
          id: id,
          keys: Array.from(keys),
          stats: {
            depth: currentDepth,
            keyCount: keys.size,
            timeMs: Math.round(endTime - startTime)
          }
        });
      } catch (error) {
        self.postMessage({
          type: 'error',
          id: id,
          message: error.message
        });
      }
    };
  `;

  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);

  // Store URL for cleanup
  worker._blobUrl = url;

  return worker;
}

/**
 * Terminate worker and clean up blob URL
 * @param {Worker} worker - Worker to terminate
 */
export function terminateKeyExtractionWorker(worker) {
  if (worker) {
    worker.terminate();
    if (worker._blobUrl) {
      URL.revokeObjectURL(worker._blobUrl);
    }
  }
}

// ─── jq 실행 워커 ────────────────────────────────────────────────────────────

const JQ_CDN_BASE = 'https://cdn.jsdelivr.net/npm/jq-web@0.6.2/';
const JQ_CDN_JS = JQ_CDN_BASE + 'jq.js';

// 워커 코드 문자열 — ${JQ_CDN_BASE}, ${JQ_CDN_JS}는 이 파일 평가 시점에 보간됨
const JQ_WORKER_CODE = `
  // importScripts() 전에 Module.locateFile 설정:
  // blob: URL 컨텍스트에서는 상대경로 해석이 불가하므로 CDN 절대 URL로 우회
  self.Module = {
    locateFile: function(filename) {
      return '${JQ_CDN_BASE}' + filename;
    }
  };

  importScripts('${JQ_CDN_JS}');

  let jqInstance = null;
  let initError = null;

  // 워커 시작 시 즉시 초기화 (첫 쿼리 지연 방지)
  const initPromise = (function() {
    try {
      var jqRef = (typeof self.jq !== 'undefined') ? self.jq : null;
      if (!jqRef) throw new Error('jq not available after importScripts');
      var p = jqRef.promised ? jqRef.promised : jqRef;
      return Promise.resolve(p).then(function(inst) {
        jqInstance = inst;
        self.postMessage({ type: 'ready' });
      }).catch(function(err) {
        initError = err;
        self.postMessage({ type: 'init_error', message: err.message });
      });
    } catch(err) {
      initError = err;
      self.postMessage({ type: 'init_error', message: err.message });
      return Promise.reject(err);
    }
  })();

  self.onmessage = function(e) {
    var msg = e.data;
    if (msg.type !== 'execute') return;
    var id = msg.id, input = msg.input, query = msg.query;

    initPromise.then(function() {
      if (initError || !jqInstance) {
        self.postMessage({ type: 'error', id: id,
          message: 'Worker init failed: ' + (initError ? initError.message : 'no instance') });
        return;
      }
      var startTime = performance.now();
      try {
        var parsed = JSON.parse(input);
        Promise.resolve(jqInstance.json(parsed, query)).then(function(result) {
          self.postMessage({ type: 'result', id: id, result: result,
            executionTime: performance.now() - startTime });
        }).catch(function(err) {
          var t = performance.now() - startTime;
          if (err.message && err.message.includes('Unexpected end of JSON input')) {
            self.postMessage({ type: 'result', id: id, result: [], executionTime: t });
          } else {
            self.postMessage({ type: 'error', id: id, message: err.message });
          }
        });
      } catch(err) {
        var t2 = performance.now() - startTime;
        if (err.message && err.message.includes('Unexpected end of JSON input')) {
          self.postMessage({ type: 'result', id: id, result: [], executionTime: t2 });
        } else {
          self.postMessage({ type: 'error', id: id, message: err.message });
        }
      }
    }).catch(function(err) {
      self.postMessage({ type: 'error', id: id,
        message: 'Worker initialization error: ' + err.message });
    });
  };
`;

/**
 * jq 쿼리 실행용 인라인 Web Worker 생성.
 * Blob URL 방식으로 file:// 프로토콜 및 단일 파일 빌드와 호환.
 * @returns {Worker}
 */
export function createJqWorker() {
  const blob = new Blob([JQ_WORKER_CODE], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  worker._blobUrl = url;
  return worker;
}

/**
 * jq 워커를 종료하고 blob URL을 해제한다.
 * @param {Worker} worker
 */
export function terminateJqWorker(worker) {
  if (worker) {
    worker.terminate();
    if (worker._blobUrl) URL.revokeObjectURL(worker._blobUrl);
  }
}

/**
 * Get the expected input type for a function
 * @param {string} functionName - Name of the jq function
 * @returns {string} Input type ('any', 'array', 'object', 'item', etc.)
 */
export function getFunctionInputType(functionName) {
  const func = JQ_FUNCTIONS.find(f => f.name === functionName);
  return func?.inputType || 'any';
}

export function filterFunctions(prefix) {
  if (!prefix) return [];

  const lower = prefix.toLowerCase();
  return JQ_FUNCTIONS
    .filter(fn => fn.name.toLowerCase().startsWith(lower))
    .slice(0, 10); // Limit to 10 suggestions
}
