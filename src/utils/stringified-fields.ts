/**
 * 유효한 JSON 문서 안에서 "값이 stringified JSON인 필드"를 재귀적으로 찾아
 * 선택한 것만 제자리에서 풀어내는 기능.
 *
 * 기존 json-preprocessor.ts 의 unstringifyText() 가 "문서 전체가 escape된 덩어리"를
 * 다루는 것과 달리, 이 모듈은 "문서는 멀쩡한데 특정 필드 값만 문자열"인 경우를 다룬다.
 */

import { unstringifyText } from './json-preprocessor';

/** 한 문자열 값을 무엇으로 해석해 풀었는지 */
export type DecodeKind = 'json' | 'ndjson' | 'url';

export type PathSegment = string | number;

export interface Span {
  start: number;
  end: number;
}

export interface StringifiedNode {
  /** nodes 배열 내 위치. UI 선택 식별자로 사용 */
  id: number;
  /** 이 노드를 감싼 stringified 노드. 최상위면 null */
  parentId: number | null;
  /** 조상 stringified 노드 개수 = 목록 들여쓰기 단계 */
  depth: number;
  /** jq 스타일 표시 경로. 루트는 '.' */
  path: string;
  /** 선택 집합에서 쓰는 충돌 없는 식별자 */
  key: string;
  keyPath: PathSegment[];
  kind: 'object' | 'array';
  decode: DecodeKind;
  /** 원본 문자열 값의 길이 */
  rawSize: number;
  /** decode === 'ndjson' 일 때 줄 수 */
  lineCount?: number;
  /** 원본 텍스트에서의 문자열 리터럴 구간. depth 0 이고 span 수집에 성공했을 때만 존재 */
  start?: number;
  end?: number;
  preview: string;
  /** 문서 자체가 유효한 JSON이 아니라 unstringifyText() 폴백으로 풀린 루트 노드 */
  fallbackRoot?: boolean;
}

export interface DocumentScan {
  /** 스캔 기준이 된 텍스트 (Extract를 쓰면 후보 구간의 텍스트) */
  baseText: string;
  /** 문서의 파싱된 값. fallbackRoot 인 경우 baseText 자체(문자열) */
  root: unknown;
  /** JSON으로도 폴백으로도 해석하지 못한 경우 false — 출력은 baseText 그대로 */
  parsed: boolean;
  nodes: StringifiedNode[];
  /** 문서가 유효한 JSON이 아니라 전체 unstringify 폴백을 탄 경우 */
  rootFallback: boolean;
  /** 폴백으로 풀어낸 값 */
  fallbackValue?: unknown;
  /** 원본 포맷 유지(span 치환)가 가능한가 */
  spansAvailable: boolean;
  /** 노드 수 상한에 걸려 일부만 수집됨 */
  truncated: boolean;
  warnings: string[];
}

const MAX_UNWRAP_DEPTH = 5;
const MAX_NODES = 20000;
const PREVIEW_LEN = 120;

/* ------------------------------------------------------------------ */
/* 경로                                                                 */
/* ------------------------------------------------------------------ */

export function keyOf(keyPath: PathSegment[]): string {
  return JSON.stringify(keyPath);
}

/** json-position-scanner(Find 기능)와 동일한 표기: `.a.b[0].c`, 루트는 `.` */
export function displayPath(keyPath: PathSegment[]): string {
  if (keyPath.length === 0) return '.';
  return keyPath.map(seg => (typeof seg === 'number' ? `[${seg}]` : `.${seg}`)).join('');
}

function isStructure(value: unknown): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === 'object';
}

function makePreview(raw: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_LEN ? flat.slice(0, PREVIEW_LEN) + '…' : flat;
}

/* ------------------------------------------------------------------ */
/* 디코딩                                                               */
/* ------------------------------------------------------------------ */

export interface DecodeResult {
  value: Record<string, unknown> | unknown[];
  decode: DecodeKind;
  lineCount?: number;
}

/** JSON으로 파싱해서 객체/배열일 때만 통과. 스칼라("123", "true", "null")는 거부 */
function parseStructure(text: string): Record<string, unknown> | unknown[] | null {
  try {
    const parsed = JSON.parse(text);
    return isStructure(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * NDJSON 판정: 공백 줄을 제외한 **모든** 줄이 객체/배열로 파싱되고,
 * 그런 줄이 **2개 이상**일 때만 배열로 본다. 한 줄이라도 실패하면 포기.
 */
function parseNdjson(text: string): { value: unknown[]; lineCount: number } | null {
  if (!text.includes('\n')) return null;

  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length < 2) return null;

  const values: unknown[] = [];
  for (const line of lines) {
    const parsed = parseStructure(line.trim());
    if (parsed === null) return null;
    values.push(parsed);
  }

  return { value: values, lineCount: values.length };
}

/**
 * 문자열 하나가 stringified JSON인지 판정하고 풀어낸다.
 * 앞뒤 공백은 trim 후 시도하고, percent-encoding은 한 번 디코드해서 재시도한다.
 */
export function decodeStringified(raw: string): DecodeResult | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const direct = parseStructure(trimmed);
  if (direct) return { value: direct, decode: 'json' };

  const nd = parseNdjson(trimmed);
  if (nd) return { value: nd.value, decode: 'ndjson', lineCount: nd.lineCount };

  if (/%[0-9A-Fa-f]{2}/.test(trimmed)) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(trimmed);
    } catch {
      return null;
    }
    if (decoded !== trimmed) {
      const inner = decoded.trim();
      const urlDirect = parseStructure(inner);
      if (urlDirect) return { value: urlDirect, decode: 'url' };
      const urlNd = parseNdjson(inner);
      if (urlNd) return { value: urlNd.value, decode: 'url', lineCount: urlNd.lineCount };
    }
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* 원본 텍스트에서 문자열 값의 위치 수집                                    */
/* ------------------------------------------------------------------ */

/**
 * 유효한 JSON 텍스트를 한 번 훑으며 각 문자열 **값**의 리터럴 구간을 기록한다.
 * `{`, `[`, `%` 중 하나도 없는 문자열은 풀릴 여지가 없으므로 건너뛴다.
 */
export function collectStringSpans(text: string): Map<string, Span> {
  const spans = new Map<string, Span>();
  const n = text.length;
  let pos = 0;

  function skipWs(): void {
    while (pos < n) {
      const c = text[pos];
      if (c === ' ' || c === '\n' || c === '\r' || c === '\t') pos++;
      else break;
    }
  }

  /** pos가 여는 따옴표일 때 호출. 리터럴 구간을 반환하고 pos를 닫는 따옴표 다음으로 옮긴다. */
  function readStringLiteral(): Span | null {
    if (pos >= n || text[pos] !== '"') return null;
    const start = pos;
    pos++;
    while (pos < n) {
      const ch = text[pos];
      if (ch === '\\') {
        pos += 2;
        continue;
      }
      if (ch === '"') {
        pos++;
        return { start, end: pos };
      }
      pos++;
    }
    return null;
  }

  function decodeLiteral(span: Span): string | null {
    try {
      return JSON.parse(text.slice(span.start, span.end)) as string;
    } catch {
      return null;
    }
  }

  function readValue(keyPath: PathSegment[]): void {
    skipWs();
    if (pos >= n) return;
    const ch = text[pos];

    if (ch === '"') {
      const span = readStringLiteral();
      if (!span) return;
      const literal = text.slice(span.start, span.end);
      if (/[{[%]/.test(literal)) spans.set(keyOf(keyPath), span);
      return;
    }
    if (ch === '{') {
      readObject(keyPath);
      return;
    }
    if (ch === '[') {
      readArray(keyPath);
      return;
    }
    while (pos < n && !/[,\]}\s]/.test(text[pos])) pos++;
  }

  function readObject(keyPath: PathSegment[]): void {
    pos++; // '{'
    skipWs();
    if (pos < n && text[pos] === '}') {
      pos++;
      return;
    }
    while (pos < n) {
      skipWs();
      if (pos >= n || text[pos] !== '"') return;
      const keySpan = readStringLiteral();
      if (!keySpan) return;
      const key = decodeLiteral(keySpan);
      if (key === null) return;

      skipWs();
      if (pos >= n || text[pos] !== ':') return;
      pos++;

      readValue([...keyPath, key]);

      skipWs();
      if (pos >= n) return;
      if (text[pos] === ',') {
        pos++;
        continue;
      }
      if (text[pos] === '}') {
        pos++;
        return;
      }
      return;
    }
  }

  function readArray(keyPath: PathSegment[]): void {
    pos++; // '['
    skipWs();
    if (pos < n && text[pos] === ']') {
      pos++;
      return;
    }
    let index = 0;
    while (pos < n) {
      readValue([...keyPath, index]);
      skipWs();
      if (pos >= n) return;
      if (text[pos] === ',') {
        pos++;
        index++;
        continue;
      }
      if (text[pos] === ']') {
        pos++;
        return;
      }
      return;
    }
  }

  readValue([]);
  return spans;
}

/* ------------------------------------------------------------------ */
/* 스캔                                                                 */
/* ------------------------------------------------------------------ */

interface ScanOptions {
  spans?: Map<string, Span>;
  /** 폴백 루트 아래를 스캔할 때처럼 시작 깊이를 올려 잡는 경우 */
  baseDepth?: number;
  baseParentId?: number | null;
  startId?: number;
}

export interface FieldScanResult {
  nodes: StringifiedNode[];
  truncated: boolean;
}

/** 값을 재귀적으로 훑어 stringified JSON인 문자열 값을 모두 찾는다. */
export function scanStringifiedFields(root: unknown, options: ScanOptions = {}): FieldScanResult {
  const { spans, baseDepth = 0, baseParentId = null, startId = 0 } = options;
  const nodes: StringifiedNode[] = [];
  let truncated = false;

  function visit(value: unknown, keyPath: PathSegment[], parentId: number | null, depth: number): void {
    if (truncated) return;
    if (startId + nodes.length >= MAX_NODES) {
      truncated = true;
      return;
    }

    if (typeof value === 'string') {
      if (depth >= baseDepth + MAX_UNWRAP_DEPTH) return;
      const decoded = decodeStringified(value);
      if (!decoded) return;

      const id = startId + nodes.length;
      const span = depth === 0 ? spans?.get(keyOf(keyPath)) : undefined;
      nodes.push({
        id,
        parentId,
        depth,
        path: displayPath(keyPath),
        key: keyOf(keyPath),
        keyPath,
        kind: Array.isArray(decoded.value) ? 'array' : 'object',
        decode: decoded.decode,
        rawSize: value.length,
        lineCount: decoded.lineCount,
        start: span?.start,
        end: span?.end,
        preview: makePreview(JSON.stringify(decoded.value)),
      });

      // 푼 결과 안쪽도 계속 본다 (중첩 재귀)
      visit(decoded.value, keyPath, id, depth + 1);
      return;
    }

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        visit(value[i], [...keyPath, i], parentId, depth);
      }
      return;
    }

    if (isStructure(value)) {
      for (const k of Object.keys(value)) {
        visit((value as Record<string, unknown>)[k], [...keyPath, k], parentId, depth);
      }
    }
  }

  visit(root, [], baseParentId, baseDepth);
  return { nodes, truncated };
}

/**
 * 텍스트 하나를 문서로 보고 전체 스캔한다.
 *
 * - 유효한 JSON이면 필드 트리를 만든다 (루트 자체가 문자열이면 `.` 노드가 최상단에 들어온다).
 * - 유효하지 않으면 기존 unstringifyText() 폴백을 타고, 그 결과를 `.` 단일 루트 노드로 노출한 뒤
 *   그 안쪽을 다시 스캔한다. (예전 "Unstringify 토글" 동작을 트리 안으로 흡수)
 */
export function scanDocument(baseText: string): DocumentScan {
  const warnings: string[] = [];
  const trimmed = baseText.trim();

  if (!trimmed) {
    return {
      baseText,
      root: null,
      parsed: false,
      nodes: [],
      rootFallback: false,
      spansAvailable: false,
      truncated: false,
      warnings,
    };
  }

  let parsed: unknown;
  let valid = true;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    valid = false;
  }

  if (valid) {
    let spans: Map<string, Span> | undefined;
    try {
      spans = collectStringSpans(baseText);
    } catch {
      spans = undefined;
    }
    const { nodes, truncated } = scanStringifiedFields(parsed, { spans });
    if (truncated) warnings.push(`후보가 ${MAX_NODES}개를 넘어 일부만 표시합니다`);
    return {
      baseText,
      root: parsed,
      parsed: true,
      nodes,
      rootFallback: false,
      spansAvailable: spans !== undefined,
      truncated,
      warnings,
    };
  }

  // 문서 자체가 escape된 덩어리인 경우 — 예전 Unstringify 토글의 동작
  const fallback = unstringifyText(baseText);
  if (fallback.value === null || !isStructure(fallback.value)) {
    if (fallback.warning) warnings.push(fallback.warning);
    return {
      baseText,
      root: baseText,
      parsed: false,
      nodes: [],
      rootFallback: false,
      spansAvailable: false,
      truncated: false,
      warnings,
    };
  }

  if (fallback.rounds > 1) warnings.push(`문서 전체 unstringify ${fallback.rounds}회 적용`);

  const rootNode: StringifiedNode = {
    id: 0,
    parentId: null,
    depth: 0,
    path: '.',
    key: keyOf([]),
    keyPath: [],
    kind: Array.isArray(fallback.value) ? 'array' : 'object',
    decode: 'json',
    rawSize: baseText.length,
    preview: makePreview(JSON.stringify(fallback.value)),
    fallbackRoot: true,
  };

  const inner = scanStringifiedFields(fallback.value, {
    baseDepth: 1,
    baseParentId: 0,
    startId: 1,
  });
  if (inner.truncated) warnings.push(`후보가 ${MAX_NODES}개를 넘어 일부만 표시합니다`);

  return {
    baseText,
    root: baseText,
    parsed: true,
    nodes: [rootNode, ...inner.nodes],
    rootFallback: true,
    fallbackValue: fallback.value,
    spansAvailable: false,
    truncated: inner.truncated,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* 적용                                                                 */
/* ------------------------------------------------------------------ */

function walkApply(value: unknown, keyPath: PathSegment[], depth: number, selected: Set<string>): unknown {
  if (typeof value === 'string') {
    if (depth >= MAX_UNWRAP_DEPTH) return value;
    if (!selected.has(keyOf(keyPath))) return value;
    const decoded = decodeStringified(value);
    if (!decoded) return value;
    return walkApply(decoded.value, keyPath, depth + 1, selected);
  }

  if (Array.isArray(value)) {
    return value.map((item, i) => walkApply(item, [...keyPath, i], depth, selected));
  }

  if (isStructure(value)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value)) {
      out[k] = walkApply((value as Record<string, unknown>)[k], [...keyPath, k], depth, selected);
    }
    return out;
  }

  return value;
}

/** 선택된 경로만 풀어낸 새 값을 만든다. 키 순서는 보존된다. */
export function applySelection(scan: DocumentScan, selected: Set<string>): unknown {
  if (scan.rootFallback) {
    if (!selected.has(keyOf([]))) return scan.root;
    return walkApply(scan.fallbackValue, [], 1, selected);
  }
  return walkApply(scan.root, [], 0, selected);
}

/** 노드 하나를 (그 안쪽 선택까지 반영해서) 풀어낸 값. 풀 수 없으면 null */
export function resolveNode(scan: DocumentScan, node: StringifiedNode, selected: Set<string>): unknown {
  if (node.fallbackRoot) {
    return walkApply(scan.fallbackValue, [], 1, selected);
  }

  let cursor: unknown = scan.root;
  for (const seg of node.keyPath) {
    if (cursor === null || typeof cursor !== 'object') return null;
    cursor = (cursor as Record<PathSegment, unknown>)[seg];
  }
  if (typeof cursor !== 'string') return null;

  const decoded = decodeStringified(cursor);
  if (!decoded) return null;
  return walkApply(decoded.value, node.keyPath, node.depth + 1, selected);
}

/* ------------------------------------------------------------------ */
/* 출력                                                                 */
/* ------------------------------------------------------------------ */

/** pos가 속한 줄의 선행 공백 */
function lineIndentAt(text: string, pos: number): string {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const match = /^[ \t]*/.exec(text.slice(lineStart, pos));
  return match ? match[0] : '';
}

/** 첫 줄을 제외한 모든 줄에 들여쓰기를 덧붙인다 */
function reindent(json: string, indent: string): string {
  if (!indent) return json;
  return json.split('\n').map((line, i) => (i === 0 ? line : indent + line)).join('\n');
}

/** 전체 재직렬화 — 문서 전체를 2-space로 다시 찍는다 */
export function renderReserialized(scan: DocumentScan, selected: Set<string>, indent = 2): string {
  if (!scan.parsed) return scan.baseText;
  const value = applySelection(scan, selected);
  if (typeof value === 'string' && scan.rootFallback) return value;
  return JSON.stringify(value, null, indent);
}

/**
 * 원본 포맷 유지 — 선택된 최상위 노드의 문자열 리터럴 구간만 교체한다.
 * 삽입되는 블록은 그 줄의 들여쓰기에 맞춰 pretty 출력한다.
 */
export function renderSpanReplaced(scan: DocumentScan, selected: Set<string>, indent = 2): string {
  const targets = scan.nodes
    .filter(n => n.depth === 0 && n.start !== undefined && n.end !== undefined && selected.has(n.key))
    .sort((a, b) => b.start! - a.start!);

  let text = scan.baseText;
  for (const node of targets) {
    const resolved = resolveNode(scan, node, selected);
    if (resolved === null || resolved === undefined) continue;
    const block = reindent(JSON.stringify(resolved, null, indent), lineIndentAt(text, node.start!));
    text = text.slice(0, node.start!) + block + text.slice(node.end!);
  }
  return text;
}

export function renderResult(scan: DocumentScan, selected: Set<string>, preserveFormat: boolean): string {
  if (preserveFormat && scan.spansAvailable) return renderSpanReplaced(scan, selected);
  return renderReserialized(scan, selected);
}

/* ------------------------------------------------------------------ */
/* 선택 상태 헬퍼                                                        */
/* ------------------------------------------------------------------ */

/** 부모가 빠지면 자식도 적용될 수 없으므로 함께 해제한다 */
export function pruneOrphans(nodes: StringifiedNode[], selected: Set<string>): Set<string> {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const next = new Set(selected);
  let changed = true;

  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.parentId === null || !next.has(node.key)) continue;
      const parent = byId.get(node.parentId);
      if (parent && !next.has(parent.key)) {
        next.delete(node.key);
        changed = true;
      }
    }
  }

  return next;
}

/** 부모를 켤 때 조상도 함께 켜야 적용이 가능하다 */
export function withAncestors(nodes: StringifiedNode[], selected: Set<string>): Set<string> {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const next = new Set(selected);

  for (const node of nodes) {
    if (!next.has(node.key)) continue;
    let cursor = node.parentId;
    while (cursor !== null) {
      const parent = byId.get(cursor);
      if (!parent) break;
      next.add(parent.key);
      cursor = parent.parentId;
    }
  }

  return next;
}

export function allKeys(nodes: StringifiedNode[]): Set<string> {
  return new Set(nodes.map(n => n.key));
}

export { MAX_UNWRAP_DEPTH, MAX_NODES };
