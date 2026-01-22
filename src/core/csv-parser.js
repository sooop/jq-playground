/**
 * CSV/TSV to JSON converter
 * Supports RFC 4180 CSV parsing with auto-delimiter detection
 */

export class CsvParseError extends Error {
  constructor(message, line = null, column = null) {
    super(message);
    this.name = 'CsvParseError';
    this.line = line;
    this.column = column;
  }
}

/**
 * Remove UTF-8 BOM if present
 */
function removeBOM(text) {
  if (text.charCodeAt(0) === 0xFEFF) {
    return text.slice(1);
  }
  return text;
}

/**
 * Count delimiters in a line, ignoring those inside quotes
 */
function countDelimiters(line, delimiter) {
  let count = 0;
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      // Check for escaped quote
      if (i + 1 < line.length && line[i + 1] === '"') {
        i++; // Skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      count++;
    }
  }

  return count;
}

/**
 * Detect delimiter by analyzing first 100 lines
 */
export function detectDelimiter(text) {
  const lines = text.split('\n').slice(0, 100).filter(line => line.trim());
  if (lines.length < 2) return null;

  const delimiters = [',', '\t', ';'];
  const scores = {};

  for (const delimiter of delimiters) {
    const counts = lines.map(line => countDelimiters(line, delimiter));

    // Check consistency
    const firstCount = counts[0];
    if (firstCount === 0) continue;

    const consistent = counts.filter(c => c === firstCount).length;
    const consistency = consistent / counts.length;

    if (consistency >= 0.8) {
      scores[delimiter] = {
        count: firstCount,
        consistency: consistency
      };
    }
  }

  // Choose delimiter with highest count and consistency
  let best = null;
  let bestScore = 0;

  for (const [delimiter, data] of Object.entries(scores)) {
    const score = data.count * data.consistency;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }

  return best;
}

/**
 * Parse TSV (tab-separated) - simple split for performance
 */
function parseTSV(text, options) {
  const lines = text.split('\n').filter(line => line.trim());
  if (lines.length === 0) {
    throw new CsvParseError('Empty TSV content');
  }

  const headers = lines[0].split('\t').map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split('\t');
    const row = {};

    for (let j = 0; j < headers.length; j++) {
      const value = values[j] || '';
      row[headers[j]] = options.inferTypes ? inferType(value) : value;
    }

    rows.push(row);
  }

  return rows;
}

/**
 * Parse CSV with RFC 4180 support (quotes, newlines in values)
 */
function parseCSV(text, delimiter, options) {
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;
  let line = 1;
  let column = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    column++;

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote
          currentField += '"';
          i++; // Skip next quote
          column++;
        } else {
          // End of quoted field
          inQuotes = false;
        }
      } else {
        currentField += char;
        if (char === '\n') {
          line++;
          column = 0;
        }
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        currentRow.push(currentField);
        currentField = '';
      } else if (char === '\n') {
        // End of row
        currentRow.push(currentField);
        if (currentRow.some(f => f.trim())) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
        line++;
        column = 0;
      } else if (char === '\r') {
        // Skip CR in CRLF
        if (nextChar !== '\n') {
          // Standalone CR - treat as newline
          currentRow.push(currentField);
          if (currentRow.some(f => f.trim())) {
            rows.push(currentRow);
          }
          currentRow = [];
          currentField = '';
          line++;
          column = 0;
        }
      } else {
        currentField += char;
      }
    }
  }

  // Handle last field/row
  if (inQuotes) {
    throw new CsvParseError('Unclosed quote', line, column);
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.some(f => f.trim())) {
      rows.push(currentRow);
    }
  }

  if (rows.length === 0) {
    throw new CsvParseError('Empty CSV content');
  }

  // Convert to objects
  const headers = rows[0].map(h => h.trim());
  const result = [];

  for (let i = 1; i < rows.length; i++) {
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      const value = rows[i][j] || '';
      row[headers[j]] = options.inferTypes ? inferType(value) : value;
    }
    result.push(row);
  }

  return result;
}

/**
 * Infer type from string value
 */
function inferType(value) {
  const trimmed = value.trim();

  // null
  if (trimmed === '' || trimmed === 'null') {
    return null;
  }

  // boolean
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  // number
  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== '') {
    return num;
  }

  // string (default)
  return value;
}

/**
 * Convert CSV/TSV to JSON array
 * @param {string} text - CSV/TSV content
 * @param {Object} options - Parsing options
 * @param {string} options.delimiter - Delimiter (auto-detect if undefined)
 * @param {boolean} options.hasHeader - First row is header (default: true)
 * @param {boolean} options.inferTypes - Infer types (default: false, keeps strings)
 * @returns {Array} JSON array
 */
export function csvToJson(text, options = {}) {
  const opts = {
    delimiter: undefined,
    hasHeader: true,
    inferTypes: false,
    ...options
  };

  // Remove BOM
  text = removeBOM(text);

  // Auto-detect delimiter
  let delimiter = opts.delimiter;
  if (!delimiter) {
    delimiter = detectDelimiter(text);
    if (!delimiter) {
      throw new CsvParseError('Cannot detect delimiter');
    }
  }

  // Use optimized TSV parser for tabs
  if (delimiter === '\t') {
    return parseTSV(text, opts);
  }

  // Use full CSV parser for comma/semicolon
  return parseCSV(text, delimiter, opts);
}
