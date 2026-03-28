/**
 * jq 경량 토크나이저 (Lightweight jq Tokenizer)
 *
 * jq 쿼리 문자열을 토큰 배열로 변환한다.
 * 자동완성 구문 분석에 필요한 수준만 커버하며,
 * 불완전한 입력에도 크래시 없이 동작한다.
 *
 * 토큰 타입:
 *   string, number, dot, ident, pipe, lbrace, rbrace,
 *   lbracket, rbracket, lparen, rparen, colon, comma,
 *   semicolon, variable, operator, question, whitespace,
 *   keyword, format_string, error
 */

/** @typedef {{ type: string, value: string, start: number, end: number }} Token */

const KEYWORDS = new Set([
  'if', 'then', 'elif', 'else', 'end',
  'try', 'catch',
  'reduce', 'foreach', 'limit', 'label', 'break',
  'import', 'include', 'as', 'def',
  'and', 'or', 'not',
  'true', 'false', 'null',
]);

const OPERATOR_CHARS = new Set(['+', '-', '*', '/', '%', '=', '<', '>', '!']);
const TWO_CHAR_OPERATORS = new Set(['==', '!=', '<=', '>=', '//','+=', '-=', '*=', '/=', '%=', '|=']);

/**
 * jq 쿼리 문자열을 토큰 배열로 변환
 * @param {string} input - jq 쿼리 문자열 (불완전 가능)
 * @returns {Token[]} 토큰 배열
 */
export function tokenize(input) {
  const tokens = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];

    // 1. 공백
    if (/\s/.test(ch)) {
      const start = i;
      while (i < len && /\s/.test(input[i])) i++;
      tokens.push({ type: 'whitespace', value: input.slice(start, i), start, end: i });
      continue;
    }

    // 2. 주석 (#)
    if (ch === '#') {
      const start = i;
      while (i < len && input[i] !== '\n') i++;
      tokens.push({ type: 'comment', value: input.slice(start, i), start, end: i });
      continue;
    }

    // 3. 문자열 리터럴 (큰따옴표만 — jq는 작은따옴표 미지원)
    if (ch === '"') {
      const start = i;
      i++; // skip opening quote
      let closed = false;
      while (i < len) {
        if (input[i] === '\\') {
          i += 2; // skip escaped char
          continue;
        }
        if (input[i] === '"') {
          i++; // skip closing quote
          closed = true;
          break;
        }
        i++;
      }
      const value = input.slice(start, i);
      const type = closed ? 'string' : 'error';
      tokens.push({ type, value, start, end: i });
      continue;
    }

    // 4. 포맷 문자열 (@base32, @csv, @html, @json, @text, @tsv, @uri)
    if (ch === '@') {
      const start = i;
      i++; // skip @
      while (i < len && /[a-zA-Z0-9_]/.test(input[i])) i++;
      tokens.push({ type: 'format_string', value: input.slice(start, i), start, end: i });
      continue;
    }

    // 5. 변수 ($identifier)
    if (ch === '$') {
      const start = i;
      i++; // skip $
      while (i < len && /[\w]/.test(input[i])) i++;
      tokens.push({ type: 'variable', value: input.slice(start, i), start, end: i });
      continue;
    }

    // 6. 숫자 리터럴
    if (/[0-9]/.test(ch) || (ch === '-' && i + 1 < len && /[0-9]/.test(input[i + 1]) && needsNumericMinus(tokens))) {
      const start = i;
      if (ch === '-') i++;
      while (i < len && /[0-9]/.test(input[i])) i++;
      if (i < len && input[i] === '.') {
        // 소수점 뒤에 숫자가 있는 경우만 소수
        if (i + 1 < len && /[0-9]/.test(input[i + 1])) {
          i++; // skip dot
          while (i < len && /[0-9]/.test(input[i])) i++;
        }
      }
      // 지수 표기
      if (i < len && (input[i] === 'e' || input[i] === 'E')) {
        i++;
        if (i < len && (input[i] === '+' || input[i] === '-')) i++;
        while (i < len && /[0-9]/.test(input[i])) i++;
      }
      tokens.push({ type: 'number', value: input.slice(start, i), start, end: i });
      continue;
    }

    // 7. 점 (dot) — 필드 접근 또는 identity
    if (ch === '.') {
      tokens.push({ type: 'dot', value: '.', start: i, end: i + 1 });
      i++;
      continue;
    }

    // 8. 파이프
    if (ch === '|') {
      // |= 은 연산자
      if (i + 1 < len && input[i + 1] === '=') {
        tokens.push({ type: 'operator', value: '|=', start: i, end: i + 2 });
        i += 2;
      } else {
        tokens.push({ type: 'pipe', value: '|', start: i, end: i + 1 });
        i++;
      }
      continue;
    }

    // 9. 구조 문자
    if (ch === '{') { tokens.push({ type: 'lbrace', value: '{', start: i, end: i + 1 }); i++; continue; }
    if (ch === '}') { tokens.push({ type: 'rbrace', value: '}', start: i, end: i + 1 }); i++; continue; }
    if (ch === '[') { tokens.push({ type: 'lbracket', value: '[', start: i, end: i + 1 }); i++; continue; }
    if (ch === ']') { tokens.push({ type: 'rbracket', value: ']', start: i, end: i + 1 }); i++; continue; }
    if (ch === '(') { tokens.push({ type: 'lparen', value: '(', start: i, end: i + 1 }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'rparen', value: ')', start: i, end: i + 1 }); i++; continue; }
    if (ch === ':') { tokens.push({ type: 'colon', value: ':', start: i, end: i + 1 }); i++; continue; }
    if (ch === ',') { tokens.push({ type: 'comma', value: ',', start: i, end: i + 1 }); i++; continue; }
    if (ch === ';') { tokens.push({ type: 'semicolon', value: ';', start: i, end: i + 1 }); i++; continue; }
    if (ch === '?') {
      // ?// (try-alternative operator)
      if (i + 2 < len && input[i + 1] === '/' && input[i + 2] === '/') {
        tokens.push({ type: 'operator', value: '?//', start: i, end: i + 3 });
        i += 3;
      } else {
        tokens.push({ type: 'question', value: '?', start: i, end: i + 1 });
        i++;
      }
      continue;
    }

    // 10. 연산자
    if (OPERATOR_CHARS.has(ch)) {
      const start = i;
      // // (alternative operator) 체크
      if (ch === '/' && i + 1 < len && input[i + 1] === '/') {
        tokens.push({ type: 'operator', value: '//', start: i, end: i + 2 });
        i += 2;
        continue;
      }
      // 2문자 연산자 체크
      if (i + 1 < len) {
        const twoChar = input.slice(i, i + 2);
        if (TWO_CHAR_OPERATORS.has(twoChar)) {
          tokens.push({ type: 'operator', value: twoChar, start, end: i + 2 });
          i += 2;
          continue;
        }
      }
      tokens.push({ type: 'operator', value: ch, start, end: i + 1 });
      i++;
      continue;
    }

    // 11. 식별자 / 키워드
    if (/[a-zA-Z_]/.test(ch)) {
      const start = i;
      while (i < len && /[\w]/.test(input[i])) i++;
      const value = input.slice(start, i);
      const type = KEYWORDS.has(value) ? 'keyword' : 'ident';
      tokens.push({ type, value, start, end: i });
      continue;
    }

    // 12. 인식 불가 문자 → error 토큰
    tokens.push({ type: 'error', value: ch, start: i, end: i + 1 });
    i++;
  }

  return tokens;
}

/**
 * 음수 부호로 해석해야 하는지 판단 (직전 토큰 기반)
 * 직전에 값 토큰(숫자, 식별자, 닫는 괄호 등)이 있으면 - 는 빼기 연산자
 * @param {Token[]} tokens
 * @returns {boolean} true면 음수 리터럴의 마이너스
 */
function needsNumericMinus(tokens) {
  if (tokens.length === 0) return true;
  const last = tokens[tokens.length - 1];
  if (last.type === 'whitespace') {
    // 공백 건너뛰고 그 앞 토큰 확인
    for (let j = tokens.length - 2; j >= 0; j--) {
      if (tokens[j].type !== 'whitespace') {
        return !isValueToken(tokens[j]);
      }
    }
    return true;
  }
  return !isValueToken(last);
}

/** @param {Token} token */
function isValueToken(token) {
  const valueTypes = new Set(['number', 'string', 'ident', 'keyword', 'variable', 'rparen', 'rbracket', 'rbrace']);
  return valueTypes.has(token.type);
}

/**
 * 공백/주석 토큰을 제거한 토큰 배열 반환
 * @param {Token[]} tokens
 * @returns {Token[]}
 */
export function stripTrivia(tokens) {
  return tokens.filter(t => t.type !== 'whitespace' && t.type !== 'comment');
}

/**
 * 특정 위치(커서)에서의 토큰 인덱스 반환
 * @param {Token[]} tokens
 * @param {number} cursor - 커서 위치 (0-based)
 * @returns {number} 토큰 인덱스 (-1이면 토큰 없음)
 */
export function tokenIndexAtCursor(tokens, cursor) {
  // 경계(start==cursor)인 토큰이 있으면 그쪽 우선 (뒤 토큰)
  // 자동완성 관점에서 커서 바로 뒤 토큰이 더 유용
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].start === cursor) return i;
  }
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].start <= cursor && cursor <= tokens[i].end) {
      return i;
    }
  }
  return -1;
}

/**
 * 토큰 배열에서 괄호 깊이 정보를 계산
 * 각 토큰에 대해 { parenDepth, bracketDepth, braceDepth } 반환
 * @param {Token[]} tokens
 * @returns {{ parenDepth: number, bracketDepth: number, braceDepth: number }[]}
 */
export function computeNesting(tokens) {
  const result = [];
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (const token of tokens) {
    // 열기 전의 깊이를 기록 (열기 토큰은 자신이 시작하는 깊이)
    if (token.type === 'lparen') {
      result.push({ parenDepth, bracketDepth, braceDepth });
      parenDepth++;
    } else if (token.type === 'rparen') {
      parenDepth = Math.max(0, parenDepth - 1);
      result.push({ parenDepth, bracketDepth, braceDepth });
    } else if (token.type === 'lbracket') {
      result.push({ parenDepth, bracketDepth, braceDepth });
      bracketDepth++;
    } else if (token.type === 'rbracket') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      result.push({ parenDepth, bracketDepth, braceDepth });
    } else if (token.type === 'lbrace') {
      result.push({ parenDepth, bracketDepth, braceDepth });
      braceDepth++;
    } else if (token.type === 'rbrace') {
      braceDepth = Math.max(0, braceDepth - 1);
      result.push({ parenDepth, bracketDepth, braceDepth });
    } else {
      result.push({ parenDepth, bracketDepth, braceDepth });
    }
  }

  return result;
}

/**
 * 토큰 스트림에서 최상위 레벨의 파이프로 분할
 * (모든 깊이가 0인 pipe 토큰 기준)
 * @param {Token[]} tokens
 * @returns {Token[][]} 세그먼트별 토큰 배열
 */
export function splitTokensByPipe(tokens) {
  const nesting = computeNesting(tokens);
  const segments = [];
  let current = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const nest = nesting[i];

    if (
      token.type === 'pipe' &&
      nest.parenDepth === 0 &&
      nest.bracketDepth === 0 &&
      nest.braceDepth === 0
    ) {
      if (current.length > 0) segments.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }

  if (current.length > 0) segments.push(current);
  return segments;
}
