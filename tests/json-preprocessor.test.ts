import { describe, it, expect } from 'vitest';
import {
  preprocessJson,
  unstringifyText,
  detectExtractLikely,
  detectUnstringifyLikely,
  formatCandidate,
} from '../src/utils/json-preprocessor';

describe('extract JSON from logs', () => {
  it('extracts JSON after prefix text', () => {
    const text = 'Response: {"a":1,"b":2}';
    const result = preprocessJson(text, { extract: true, unstringify: false });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].parsed).toEqual({ a: 1, b: 2 });
    expect(result.candidates[0].kind).toBe('object');
  });

  it('extracts multiple JSON values separately', () => {
    const text = 'first {"x":1} and second [1,2,3] end';
    const result = preprocessJson(text, { extract: true, unstringify: false });
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].parsed).toEqual({ x: 1 });
    expect(result.candidates[1].parsed).toEqual([1, 2, 3]);
    expect(result.candidates[1].kind).toBe('array');
  });

  it('ignores braces inside strings', () => {
    const text = '{"msg":"value { not json }","n":1}';
    const result = preprocessJson(text, { extract: true, unstringify: false });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].parsed).toEqual({ msg: 'value { not json }', n: 1 });
  });

  it('keeps outer span only for nested objects', () => {
    const text = '{"outer":{"inner":1}}';
    const result = preprocessJson(text, { extract: true, unstringify: false });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].parsed).toEqual({ outer: { inner: 1 } });
  });
});

describe('unstringify', () => {
  it('unescapes quoted JSON string', () => {
    const text = '{\\"name\\":\\"foo\\"}';
    const { value } = unstringifyText(text);
    expect(value).toEqual({ name: 'foo' });
  });

  it('handles double-stringified JSON', () => {
    const inner = JSON.stringify(JSON.stringify({ a: 1 }));
    const { value, rounds } = unstringifyText(inner);
    expect(value).toEqual({ a: 1 });
    expect(rounds).toBeGreaterThan(1);
  });

  it('unstringify-only mode on full text', () => {
    const text = '{\\"id\\":42}';
    const result = preprocessJson(text, { extract: false, unstringify: true });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].parsed).toEqual({ id: 42 });
  });
});

describe('extract + unstringify combined', () => {
  it('extracts then unstringifies candidate', () => {
    const text = 'log: {\\"k\\":\\"v\\"}';
    const result = preprocessJson(text, { extract: true, unstringify: true });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].parsed).toEqual({ k: 'v' });
  });
});

describe('detection helpers', () => {
  it('detectExtractLikely for log text', () => {
    expect(detectExtractLikely('ok {"a":1}')).toBe(true);
    expect(detectExtractLikely('{"a":1}')).toBe(false);
  });

  it('detectUnstringifyLikely for escaped text', () => {
    expect(detectUnstringifyLikely('{\\"a\\":1}')).toBe(true);
  });
});

describe('formatCandidate', () => {
  it('pretty-prints parsed value', () => {
    const result = preprocessJson('{"a":1}', { extract: true, unstringify: false });
    const formatted = formatCandidate(result.candidates[0]);
    expect(formatted).toContain('"a": 1');
  });
});

describe('large input', () => {
  it('completes for ~1MB text with embedded JSON', () => {
    const payload = JSON.stringify({
      items: Array.from({ length: 40000 }, (_, i) => ({ id: i, label: `item-${i}`, nested: { x: i % 10 } })),
    });
    const text = 'LOG START\n'.repeat(50) + payload + '\nLOG END';
    expect(text.length).toBeGreaterThan(1024 * 1024 * 0.9);
    const start = Date.now();
    const result = preprocessJson(text, { extract: true, unstringify: false });
    const elapsed = Date.now() - start;
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(15000);
  }, 20000);
});
