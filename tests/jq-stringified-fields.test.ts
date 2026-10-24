import { describe, it, expect } from 'vitest';
import {
  decodeStringified,
  scanDocument,
  collectStringSpans,
  renderReserialized,
  renderSpanReplaced,
  pruneOrphans,
  withAncestors,
  allKeys,
  keyOf,
} from '../src/modes/jq/utils/stringified-fields';

describe('decodeStringified', () => {
  it('decodes a plain JSON object', () => {
    const result = decodeStringified('{"a":1}');
    expect(result).not.toBeNull();
    expect(result!.value).toEqual({ a: 1 });
    expect(result!.decode).toBe('json');
  });

  it('decodes a numbers-only JSON array', () => {
    const result = decodeStringified('[1,2,3]');
    expect(result).not.toBeNull();
    expect(result!.value).toEqual([1, 2, 3]);
    expect(result!.decode).toBe('json');
  });

  it('rejects scalar strings ("123", "true", "null")', () => {
    expect(decodeStringified('123')).toBeNull();
    expect(decodeStringified('true')).toBeNull();
    expect(decodeStringified('null')).toBeNull();
    expect(decodeStringified('"quoted"')).toBeNull();
  });

  it('accepts empty object and empty array', () => {
    const obj = decodeStringified('{}');
    expect(obj).not.toBeNull();
    expect(obj!.value).toEqual({});

    const arr = decodeStringified('[]');
    expect(arr).not.toBeNull();
    expect(arr!.value).toEqual([]);
  });

  it('trims surrounding whitespace before parsing', () => {
    const result = decodeStringified('  {"a":1}\n');
    expect(result).not.toBeNull();
    expect(result!.value).toEqual({ a: 1 });
    expect(result!.decode).toBe('json');
  });

  it('returns null for empty / whitespace-only input', () => {
    expect(decodeStringified('')).toBeNull();
    expect(decodeStringified('   ')).toBeNull();
  });

  it('decodes URL-encoded JSON', () => {
    const encoded = encodeURIComponent('{"a":1}');
    const result = decodeStringified(encoded);
    expect(result).not.toBeNull();
    expect(result!.value).toEqual({ a: 1 });
    expect(result!.decode).toBe('url');
  });

  it('returns null when percent-encoding is present but does not decode to JSON', () => {
    // decodes to two spaces, which trims to empty
    expect(decodeStringified('%20%20')).toBeNull();
  });

  it('decodes NDJSON when every non-blank line parses as object/array (>=2 lines)', () => {
    const result = decodeStringified('{"a":1}\n{"b":2}');
    expect(result).not.toBeNull();
    expect(result!.decode).toBe('ndjson');
    expect(result!.value).toEqual([{ a: 1 }, { b: 2 }]);
    expect(result!.lineCount).toBe(2);
  });

  it('ignores blank lines when judging NDJSON', () => {
    const result = decodeStringified('{"a":1}\n\n{"b":2}');
    expect(result).not.toBeNull();
    expect(result!.decode).toBe('ndjson');
    expect(result!.value).toEqual([{ a: 1 }, { b: 2 }]);
    expect(result!.lineCount).toBe(2);
  });

  it('rejects NDJSON candidate when any line fails to parse', () => {
    expect(decodeStringified('{"a":1}\nhello')).toBeNull();
    expect(decodeStringified('hello\nworld')).toBeNull();
  });
});

describe('collectStringSpans', () => {
  it('locates the literal span of a candidate string value without being confused by braces inside other strings', () => {
    const innerJson = JSON.stringify({ x: 1 });
    const doc = JSON.stringify({ msg: 'text with { brace', a: innerJson });
    const spans = collectStringSpans(doc);

    const aSpan = spans.get(keyOf(['a']));
    expect(aSpan).toBeDefined();
    expect(doc.slice(aSpan!.start, aSpan!.end)).toBe(JSON.stringify(innerJson));
  });

  it('correctly skips escaped quotes inside string literals', () => {
    const innerJson = JSON.stringify({ x: 1 });
    const doc = JSON.stringify({ c: 'a "quote" b', a: innerJson });
    const spans = collectStringSpans(doc);

    const aSpan = spans.get(keyOf(['a']));
    expect(aSpan).toBeDefined();
    expect(doc.slice(aSpan!.start, aSpan!.end)).toBe(JSON.stringify(innerJson));
  });
});

describe('scanDocument - basic candidate detection', () => {
  it('finds a stringified object field and records its path/kind/decode', () => {
    const innerA = JSON.stringify({ x: 1 });
    const doc = JSON.stringify({ a: innerA, b: 'hello', c: 42 });
    const scan = scanDocument(doc);

    expect(scan.rootFallback).toBe(false);
    expect(scan.nodes).toHaveLength(1);
    const node = scan.nodes[0];
    expect(node.path).toBe('.a');
    expect(node.kind).toBe('object');
    expect(node.decode).toBe('json');
  });

  it('detects candidates inside array elements with bracket-index paths', () => {
    const doc = JSON.stringify({ logs: [JSON.stringify({ lv: 1 }), JSON.stringify({ lv: 2 })] });
    const scan = scanDocument(doc);

    expect(scan.nodes).toHaveLength(2);
    const paths = scan.nodes.map(n => n.path).sort();
    expect(paths).toEqual(['.logs[0]', '.logs[1]']);
  });

  it('excludes scalar-parsing strings from candidates', () => {
    const doc = JSON.stringify({ a: '123', b: 'true', c: 'null', d: 'plain text' });
    const scan = scanDocument(doc);
    expect(scan.nodes).toHaveLength(0);
  });

  it('accepts empty object/array string values as candidates', () => {
    const doc = JSON.stringify({ a: '{}', b: '[]' });
    const scan = scanDocument(doc);
    expect(scan.nodes).toHaveLength(2);
    const a = scan.nodes.find(n => n.path === '.a')!;
    const b = scan.nodes.find(n => n.path === '.b')!;
    expect(a.kind).toBe('object');
    expect(b.kind).toBe('array');
  });
});

describe('scanDocument - nested recursion', () => {
  it('finds nested stringified fields with correct depth/parentId/path', () => {
    const grandInner = JSON.stringify({ x: 1 });
    const payloadObj = JSON.stringify({ body: grandInner });
    const doc = JSON.stringify({ payload: payloadObj });

    const scan = scanDocument(doc);
    expect(scan.nodes).toHaveLength(2);

    const parent = scan.nodes.find(n => n.path === '.payload')!;
    const child = scan.nodes.find(n => n.path === '.payload.body')!;

    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    expect(parent.depth).toBe(0);
    expect(parent.parentId).toBeNull();
    expect(child.depth).toBe(1);
    expect(child.parentId).toBe(parent.id);
  });
});

describe('scanDocument - rootFallback', () => {
  it('falls back to unstringifyText() when the document text itself is not valid JSON, exposing a single "." root node', () => {
    // Literal backslash-quote characters, NOT valid JSON on its own.
    const text = String.raw`{\"a\":1}`;
    const scan = scanDocument(text);

    expect(scan.rootFallback).toBe(true);
    expect(scan.nodes).toHaveLength(1);
    expect(scan.nodes[0].path).toBe('.');
    expect(scan.nodes[0].fallbackRoot).toBe(true);
  });

  it('does NOT use rootFallback when the whole document is a valid JSON string whose value is itself JSON', () => {
    // The document text is `"{\"a\":1}"` -- a valid JSON string literal.
    const text = JSON.stringify(JSON.stringify({ a: 1 }));
    const scan = scanDocument(text);

    expect(scan.rootFallback).toBe(false);
    expect(scan.nodes).toHaveLength(1);
    expect(scan.nodes[0].path).toBe('.');
    expect(scan.nodes[0].decode).toBe('json');
  });
});

describe('renderReserialized', () => {
  it('unwraps only selected fields, keeps others as strings, and preserves key order', () => {
    const strA = JSON.stringify({ x: 1 });
    const strB = JSON.stringify({ y: 2 });
    const doc = JSON.stringify({ a: strA, b: strB, c: 3 });
    const scan = scanDocument(doc);

    const nodeA = scan.nodes.find(n => n.path === '.a')!;
    const selected = new Set([nodeA.key]);

    const result = renderReserialized(scan, selected);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({ a: { x: 1 }, b: strB, c: 3 });
    expect(Object.keys(parsed)).toEqual(['a', 'b', 'c']);
  });
});

describe('renderSpanReplaced - original format preservation', () => {
  it('keeps surrounding whitespace and indents the inserted block to match the line', () => {
    const payloadStr = JSON.stringify({ a: 1, b: 2 });
    const text = `{\n  "id": 1,\n  "payload": ${JSON.stringify(payloadStr)}\n}`;
    const scan = scanDocument(text);

    const node = scan.nodes.find(n => n.path === '.payload')!;
    const selected = new Set([node.key]);
    const result = renderSpanReplaced(scan, selected);

    const expected = `{\n  "id": 1,\n  "payload": {\n    "a": 1,\n    "b": 2\n  }\n}`;
    expect(result).toBe(expected);
  });

  it('replaces multiple top-level fields without offsets drifting (replaces back-to-front)', () => {
    const strFirst = JSON.stringify({ a: 1, extra: 'aaaaaaaaaa' }); // longer literal
    const strSecond = JSON.stringify({ b: 2 }); // shorter literal
    const text = `{\n  "first": ${JSON.stringify(strFirst)},\n  "id": 999,\n  "second": ${JSON.stringify(strSecond)}\n}`;
    const scan = scanDocument(text);

    const nodeFirst = scan.nodes.find(n => n.path === '.first')!;
    const nodeSecond = scan.nodes.find(n => n.path === '.second')!;
    const selected = new Set([nodeFirst.key, nodeSecond.key]);

    const result = renderSpanReplaced(scan, selected);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({ first: { a: 1, extra: 'aaaaaaaaaa' }, id: 999, second: { b: 2 } });
    // untouched literal in between stays exactly as-is
    expect(result).toContain('"id": 999,');
  });

  it('reflects nested selections inside the top-level replaced block', () => {
    const grandInner = JSON.stringify({ z: 9 });
    const outerStr = JSON.stringify({ inner: grandInner });
    const doc = JSON.stringify({ outer: outerStr });
    const scan = scanDocument(doc);

    const outerNode = scan.nodes.find(n => n.path === '.outer')!;
    const innerNode = scan.nodes.find(n => n.path === '.outer.inner')!;
    const selected = new Set([outerNode.key, innerNode.key]);

    const result = renderSpanReplaced(scan, selected);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({ outer: { inner: { z: 9 } } });
  });
});

describe('pruneOrphans / withAncestors', () => {
  function buildNestedScan() {
    const grandInner = JSON.stringify({ z: 9 });
    const outerStr = JSON.stringify({ inner: grandInner });
    const doc = JSON.stringify({ outer: outerStr });
    return scanDocument(doc);
  }

  it('pruneOrphans removes a selected child whose parent is not selected', () => {
    const scan = buildNestedScan();
    const outerNode = scan.nodes.find(n => n.path === '.outer')!;
    const innerNode = scan.nodes.find(n => n.path === '.outer.inner')!;

    const selected = new Set([innerNode.key]); // parent NOT selected
    const pruned = pruneOrphans(scan.nodes, selected);

    expect(pruned.has(innerNode.key)).toBe(false);
    expect(pruned.has(outerNode.key)).toBe(false);
    expect(pruned.size).toBe(0);
  });

  it('pruneOrphans keeps a child when its parent is also selected', () => {
    const scan = buildNestedScan();
    const outerNode = scan.nodes.find(n => n.path === '.outer')!;
    const innerNode = scan.nodes.find(n => n.path === '.outer.inner')!;

    const selected = new Set([outerNode.key, innerNode.key]);
    const pruned = pruneOrphans(scan.nodes, selected);

    expect(pruned.has(outerNode.key)).toBe(true);
    expect(pruned.has(innerNode.key)).toBe(true);
  });

  it('withAncestors auto-includes ancestors when only a child is selected', () => {
    const scan = buildNestedScan();
    const outerNode = scan.nodes.find(n => n.path === '.outer')!;
    const innerNode = scan.nodes.find(n => n.path === '.outer.inner')!;

    const selected = new Set([innerNode.key]);
    const withAnc = withAncestors(scan.nodes, selected);

    expect(withAnc.has(innerNode.key)).toBe(true);
    expect(withAnc.has(outerNode.key)).toBe(true);
    expect(withAnc.size).toBe(2);
  });

  it('allKeys returns every node key in the scan', () => {
    const scan = buildNestedScan();
    const outerNode = scan.nodes.find(n => n.path === '.outer')!;
    const innerNode = scan.nodes.find(n => n.path === '.outer.inner')!;

    expect(allKeys(scan.nodes)).toEqual(new Set([outerNode.key, innerNode.key]));
  });
});
