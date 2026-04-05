export interface JsonEntry {
  path: string;
  key: string | null;
  value: string;
  keyStart: number;
  keyEnd: number;
  valueStart: number;
  valueEnd: number;
}

const MAX_VALUE_DISPLAY = 60;
const SIZE_LIMIT = 2 * 1024 * 1024; // 2MB

export function scanJson(text: string, maxEntries = 5000): JsonEntry[] {
  if (text.length > SIZE_LIMIT) return [];

  const entries: JsonEntry[] = [];
  let pos = 0;

  function skipWhitespace(): void {
    while (pos < text.length) {
      const c = text[pos];
      if (c === ' ' || c === '\n' || c === '\r' || c === '\t') pos++;
      else break;
    }
  }

  function parseString(): { start: number; end: number; value: string } | null {
    if (pos >= text.length || text[pos] !== '"') return null;
    const start = pos;
    pos++;
    let value = '';
    while (pos < text.length) {
      const ch = text[pos];
      if (ch === '\\') {
        pos++;
        if (pos >= text.length) break;
        const esc = text[pos];
        if (esc === 'u' && pos + 4 < text.length) {
          const code = parseInt(text.slice(pos + 1, pos + 5), 16);
          if (!isNaN(code)) value += String.fromCharCode(code);
          pos += 5;
        } else {
          const escMap: Record<string, string> = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f' };
          value += escMap[esc] ?? esc;
          pos++;
        }
      } else if (ch === '"') {
        pos++;
        return { start, end: pos, value };
      } else {
        value += ch;
        pos++;
      }
    }
    return null;
  }

  function parseLiteral(): { start: number; end: number; value: string } | null {
    const start = pos;
    if (text[pos] === '-' || (text[pos] >= '0' && text[pos] <= '9')) {
      while (pos < text.length && /[-+\d.eE]/.test(text[pos])) pos++;
      return { start, end: pos, value: text.slice(start, pos) };
    }
    if (text.startsWith('true', pos)) { pos += 4; return { start, end: pos, value: 'true' }; }
    if (text.startsWith('false', pos)) { pos += 5; return { start, end: pos, value: 'false' }; }
    if (text.startsWith('null', pos)) { pos += 4; return { start, end: pos, value: 'null' }; }
    return null;
  }

  function addEntry(path: string, key: string | null, keyStart: number, keyEnd: number, valueStart: number, valueEnd: number, rawValue: string): void {
    const display = rawValue.length > MAX_VALUE_DISPLAY ? rawValue.slice(0, MAX_VALUE_DISPLAY) + '…' : rawValue;
    entries.push({ path, key, value: display, keyStart, keyEnd, valueStart, valueEnd });
  }

  function parseValue(path: string, key: string | null, keyStart: number, keyEnd: number): void {
    if (entries.length >= maxEntries) return;
    skipWhitespace();
    if (pos >= text.length) return;
    const ch = text[pos];
    if (ch === '"') {
      const result = parseString();
      if (result) addEntry(path, key, keyStart, keyEnd, result.start, result.end, `"${result.value}"`);
    } else if (ch === '{') {
      parseObject(path);
    } else if (ch === '[') {
      parseArray(path);
    } else {
      const result = parseLiteral();
      if (result) addEntry(path, key, keyStart, keyEnd, result.start, result.end, result.value);
    }
  }

  function parseObject(path: string): void {
    if (pos >= text.length || text[pos] !== '{') return;
    pos++;
    skipWhitespace();
    if (pos >= text.length) return;
    if (text[pos] === '}') { pos++; return; }

    while (pos < text.length && entries.length < maxEntries) {
      skipWhitespace();
      if (pos >= text.length || text[pos] !== '"') break;

      const keyResult = parseString();
      if (!keyResult) break;

      skipWhitespace();
      if (pos >= text.length || text[pos] !== ':') break;
      pos++;

      const childPath = path ? `${path}.${keyResult.value}` : `.${keyResult.value}`;
      parseValue(childPath, keyResult.value, keyResult.start, keyResult.end);

      skipWhitespace();
      if (pos >= text.length) break;
      if (text[pos] === ',') { pos++; }
      else if (text[pos] === '}') { pos++; break; }
      else break;
    }
  }

  function parseArray(path: string): void {
    if (pos >= text.length || text[pos] !== '[') return;
    pos++;
    skipWhitespace();
    if (pos >= text.length) return;
    if (text[pos] === ']') { pos++; return; }

    let index = 0;
    while (pos < text.length && entries.length < maxEntries) {
      skipWhitespace();
      const elemPath = `${path}[${index}]`;
      const elemPos = pos;
      parseValue(elemPath, null, elemPos, elemPos);

      skipWhitespace();
      if (pos >= text.length) break;
      if (text[pos] === ',') { pos++; index++; }
      else if (text[pos] === ']') { pos++; break; }
      else break;
    }
  }

  skipWhitespace();
  if (pos < text.length) {
    if (text[pos] === '{') parseObject('');
    else if (text[pos] === '[') parseArray('');
  }

  return entries;
}

export function filterEntries(
  entries: JsonEntry[],
  query: string,
  matchKeys: boolean,
  matchValues: boolean
): JsonEntry[] {
  if (!query.trim()) return entries;
  const q = query.toLowerCase();
  return entries.filter(e => {
    if (matchKeys && e.key && e.key.toLowerCase().includes(q)) return true;
    if (matchValues && e.value.toLowerCase().includes(q)) return true;
    return false;
  });
}
