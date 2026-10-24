export interface JsonCandidateMeta {
  index: number;
  start: number;
  end: number;
  preview: string;
  kind: 'object' | 'array';
  line: number;
}

export interface JsonCandidate extends JsonCandidateMeta {
  parsed: unknown;
}

export interface PreprocessOptions {
  extract: boolean;
  unstringify: boolean;
}

export interface PreprocessResult {
  candidates: JsonCandidate[];
  warnings: string[];
}

const PREVIEW_LEN = 120;
const MAX_UNSTRINGIFY_ROUNDS = 5;

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

function makePreview(raw: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_LEN ? flat.slice(0, PREVIEW_LEN) + '…' : flat;
}

function kindOf(value: unknown): 'object' | 'array' {
  return Array.isArray(value) ? 'array' : 'object';
}

function isJsonStructure(value: unknown): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === 'object';
}

/** Skip a JSON string starting at pos (pos must be on opening `"`). Returns end index after closing quote. */
function skipJsonString(text: string, pos: number): number {
  let i = pos + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '"') return i + 1;
    i++;
  }
  return text.length;
}

interface RawSpan {
  start: number;
  end: number;
  open: '{' | '[';
}

/** Find balanced `{`/`[` … `}`/`]` spans; ignores braces inside JSON strings. */
function findJsonSpans(text: string): RawSpan[] {
  const spans: RawSpan[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '{' && ch !== '[') continue;

    const open = ch as '{' | '[';
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let j = i;

    while (j < text.length) {
      const c = text[j];
      if (c === '"') {
        let bs = 0;
        let k = j - 1;
        while (k >= i && text[k] === '\\') { bs++; k--; }
        if (bs % 2 === 0) {
          j = skipJsonString(text, j);
          continue;
        }
      }
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) {
          spans.push({ start: i, end: j + 1, open });
          break;
        }
      }
      j++;
    }
  }

  return spans;
}

/** Drop spans fully contained in another span. */
function filterOuterSpans(spans: RawSpan[]): RawSpan[] {
  return spans.filter((span, idx) => {
    for (let j = 0; j < spans.length; j++) {
      if (idx === j) continue;
      const other = spans[j];
      if (other.start <= span.start && other.end >= span.end && other.start < span.start) {
        return false;
      }
    }
    return true;
  });
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Robust unescape: repeated JSON.parse while result is a string containing JSON,
 * or progressive backslash-unescape for escaped fragments.
 */
export function unstringifyText(text: string): { value: unknown | null; rounds: number; warning?: string } {
  const trimmed = text.trim();
  if (!trimmed) return { value: null, rounds: 0 };

  let current: unknown = trimmed;
  let rounds = 0;

  const tryProgressiveUnescape = (input: string): unknown | null => {
    let s = input;
    for (let i = 0; i < MAX_UNSTRINGIFY_ROUNDS; i++) {
      const parsed = tryParseJson(s);
      if (parsed !== null) {
        if (isJsonStructure(parsed)) return parsed;
        if (typeof parsed === 'string') {
          s = parsed;
          continue;
        }
      }
      const next = s.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      if (next === s) break;
      s = next;
    }
    const final = tryParseJson(s);
    return final !== null && isJsonStructure(final) ? final : null;
  };

  // Direct parse (valid JSON document or quoted string)
  const direct = tryParseJson(trimmed);
  if (direct !== null) {
    current = direct;
    rounds = 1;
  } else {
    const progressive = tryProgressiveUnescape(trimmed);
    if (progressive !== null) {
      return { value: progressive, rounds: 1 };
    }
    // Try wrapping as JSON string literal
    try {
      current = JSON.parse('"' + trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"');
      rounds = 1;
    } catch {
      return { value: null, rounds: 0 };
    }
  }

  while (rounds < MAX_UNSTRINGIFY_ROUNDS && typeof current === 'string') {
    const inner = current.trim();
    const parsed = tryParseJson(inner);
    if (parsed === null) {
      const progressive = tryProgressiveUnescape(inner);
      if (progressive !== null) return { value: progressive, rounds: rounds + 1 };
      break;
    }
    current = parsed;
    rounds++;
  }

  if (!isJsonStructure(current)) {
    return { value: null, rounds, warning: 'unstringify 결과가 JSON 객체/배열이 아닙니다' };
  }

  return { value: current, rounds };
}

function spanToCandidate(text: string, span: RawSpan, index: number, tryUnstringify: boolean): JsonCandidate | null {
  const raw = text.slice(span.start, span.end);
  let parsed = tryParseJson(raw);

  if (parsed === null && tryUnstringify) {
    const { value } = unstringifyText(raw);
    parsed = value;
  }

  if (parsed === null || !isJsonStructure(parsed)) return null;

  return {
    index,
    start: span.start,
    end: span.end,
    preview: makePreview(raw),
    kind: kindOf(parsed),
    line: lineAt(text, span.start),
    parsed,
  };
}

function extractCandidates(text: string, tryUnstringify: boolean): JsonCandidate[] {
  const spans = filterOuterSpans(findJsonSpans(text));
  const candidates: JsonCandidate[] = [];
  let index = 0;

  for (const span of spans) {
    const candidate = spanToCandidate(text, span, index, tryUnstringify);
    if (candidate) {
      candidates.push(candidate);
      index++;
    }
  }

  return candidates;
}

function applyUnstringifyToCandidate(candidate: JsonCandidate, warnings: string[]): JsonCandidate {
  const raw = typeof candidate.parsed === 'string'
    ? candidate.parsed
    : JSON.stringify(candidate.parsed);

  const { value, rounds, warning } = unstringifyText(raw);
  if (value === null || !isJsonStructure(value)) {
    if (warning) warnings.push(warning);
    return candidate;
  }
  if (rounds > 1) {
    warnings.push(`후보 #${candidate.index + 1}: unstringify ${rounds}회 적용`);
  }

  const formatted = JSON.stringify(value);
  return {
    ...candidate,
    parsed: value,
    kind: kindOf(value),
    preview: makePreview(formatted),
  };
}

export function preprocessJson(text: string, options: PreprocessOptions): PreprocessResult {
  const warnings: string[] = [];
  if (!text) return { candidates: [], warnings };

  if (!options.extract && !options.unstringify) {
    warnings.push('Extract 또는 Unstringify 중 하나 이상을 선택하세요');
    return { candidates: [], warnings };
  }

  let candidates: JsonCandidate[] = [];

  if (options.extract) {
    candidates = extractCandidates(text, options.unstringify);
    if (candidates.length === 0) {
      warnings.push('추출 가능한 JSON을 찾지 못했습니다');
    }
  } else if (options.unstringify) {
    const { value, rounds, warning } = unstringifyText(text);
    if (warning) warnings.push(warning);
    if (value !== null && isJsonStructure(value)) {
      const raw = JSON.stringify(value);
      candidates = [{
        index: 0,
        start: 0,
        end: text.length,
        preview: makePreview(raw),
        kind: kindOf(value),
        line: 1,
        parsed: value,
      }];
      if (rounds > 1) warnings.push(`unstringify ${rounds}회 적용`);
    } else {
      warnings.push('unstringify할 JSON을 찾지 못했습니다');
    }
    return { candidates, warnings };
  }

  if (options.unstringify && options.extract) {
    // Re-unstringify parsed values that may still be stringified (double escape)
    candidates = candidates.map(c => applyUnstringifyToCandidate(c, warnings));
  }

  return { candidates, warnings };
}

export function toCandidateMeta(c: JsonCandidate): JsonCandidateMeta {
  return {
    index: c.index,
    start: c.start,
    end: c.end,
    preview: c.preview,
    kind: c.kind,
    line: c.line,
  };
}

export function formatCandidate(candidate: JsonCandidate, indent = 2): string {
  return JSON.stringify(candidate.parsed, null, indent);
}

export function detectExtractLikely(text: string): boolean {
  if (!text) return false;
  try {
    JSON.parse(text.trim());
    return false;
  } catch {
    return text.includes('{') || text.includes('[');
  }
}

export function detectUnstringifyLikely(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return false;
    } catch {
      // invalid JSON starting with brace — might need unstringify
    }
  }
  if (/\\"/.test(text) || /\\\\/.test(text)) {
    const { value } = unstringifyText(text.slice(0, Math.min(text.length, 5000)));
    return value !== null;
  }
  return false;
}

export function suggestDefaultOptions(text: string): PreprocessOptions {
  return {
    extract: detectExtractLikely(text),
    unstringify: detectUnstringifyLikely(text),
  };
}
