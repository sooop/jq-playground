import { describe, it, expect } from 'vitest';
import {
  tokenize,
  stripTrivia,
  splitTokensByPipe,
  computeNesting,
  tokenIndexAtCursor,
} from '../src/utils/jq-tokenizer';

/** 공백 제거 후 토큰 타입만 추출 */
function types(input) {
  return stripTrivia(tokenize(input)).map(t => t.type);
}

/** 공백 제거 후 토큰 값만 추출 */
function values(input) {
  return stripTrivia(tokenize(input)).map(t => t.value);
}

// ─── 기본 토큰화 ─────────────────────────────────────────

describe('기본 토큰화', () => {
  it('단순 필드 접근', () => {
    expect(types('.foo')).toEqual(['dot', 'ident']);
    expect(values('.foo')).toEqual(['.', 'foo']);
  });

  it('파이프로 연결된 표현식', () => {
    expect(types('.foo | .bar')).toEqual(['dot', 'ident', 'pipe', 'dot', 'ident']);
  });

  it('빈 문자열', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('점만', () => {
    expect(types('.')).toEqual(['dot']);
  });

  it('중첩 필드 접근', () => {
    expect(values('.foo.bar.baz')).toEqual(['.', 'foo', '.', 'bar', '.', 'baz']);
  });
});

// ─── 문자열 리터럴 ───────────────────────────────────────

describe('문자열 리터럴', () => {
  it('단순 문자열', () => {
    const tokens = stripTrivia(tokenize('"hello"'));
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ type: 'string', value: '"hello"' });
  });

  it('문자열 내 파이프 — 단일 토큰으로 유지', () => {
    const tokens = stripTrivia(tokenize('"hello | world"'));
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('string');
    expect(tokens[0].value).toBe('"hello | world"');
  });

  it('이스케이프된 따옴표', () => {
    const tokens = stripTrivia(tokenize('"say \\"hi\\""'));
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('string');
  });

  it('연속 백슬래시 후 따옴표 — 올바른 문자열 경계', () => {
    // "test\\" → 백슬래시 이스케이프 후 따옴표로 닫힘
    const tokens = stripTrivia(tokenize('"test\\\\"'));
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('string');
    expect(tokens[0].value).toBe('"test\\\\"');
  });

  it('연속 백슬래시 홀수개 + 따옴표 — 이스케이프된 따옴표로 미종료', () => {
    // JS: '"test\\\"' → 실제 문자열: "test\"  (백슬래시1+따옴표 = 이스케이프)
    // 토크나이저: \" 를 이스케이프로 인식 → 문자열 미종료
    const input = '"test\\"';
    const tokens = stripTrivia(tokenize(input));
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('error'); // unterminated
  });

  it('미종료 문자열 → error', () => {
    const tokens = stripTrivia(tokenize('"hello'));
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('error');
  });
});

// ─── 숫자 리터럴 ─────────────────────────────────────────

describe('숫자 리터럴', () => {
  it('정수', () => {
    expect(types('42')).toEqual(['number']);
  });

  it('소수', () => {
    expect(types('3.14')).toEqual(['number']);
    expect(values('3.14')).toEqual(['3.14']);
  });

  it('지수 표기', () => {
    expect(types('1e10')).toEqual(['number']);
    expect(types('2.5E-3')).toEqual(['number']);
  });

  it('음수 리터럴 (표현식 시작)', () => {
    expect(types('-1')).toEqual(['number']);
    expect(values('-1')).toEqual(['-1']);
  });

  it('빼기 연산자 (값 뒤)', () => {
    // .x - 1 → dot ident operator number
    expect(types('.x - 1')).toEqual(['dot', 'ident', 'operator', 'number']);
  });
});

// ─── 변수 ────────────────────────────────────────────────

describe('변수', () => {
  it('단순 변수', () => {
    expect(types('$x')).toEqual(['variable']);
    expect(values('$x')).toEqual(['$x']);
  });

  it('as 바인딩', () => {
    expect(types('.price as $p | $p')).toEqual([
      'dot', 'ident', 'keyword', 'variable', 'pipe', 'variable'
    ]);
  });

  it('내장 변수', () => {
    expect(types('$ENV')).toEqual(['variable']);
    expect(types('$__loc__')).toEqual(['variable']);
  });
});

// ─── 키워드 ──────────────────────────────────────────────

describe('키워드', () => {
  it('if-then-else-end', () => {
    expect(types('if .a then .b else .c end')).toEqual([
      'keyword', 'dot', 'ident',
      'keyword', 'dot', 'ident',
      'keyword', 'dot', 'ident',
      'keyword'
    ]);
  });

  it('try-catch', () => {
    expect(types('try .a catch "err"')).toEqual([
      'keyword', 'dot', 'ident', 'keyword', 'string'
    ]);
  });

  it('reduce', () => {
    const t = types('reduce .[] as $x (0; . + $x)');
    expect(t[0]).toBe('keyword'); // reduce
    expect(t).toContain('variable');
    expect(t).toContain('semicolon');
  });

  it('def', () => {
    expect(types('def f: . + 1;')).toEqual([
      'keyword', 'ident', 'colon', 'dot', 'operator', 'number', 'semicolon'
    ]);
  });

  it('true/false/null은 keyword', () => {
    expect(types('true')).toEqual(['keyword']);
    expect(types('false')).toEqual(['keyword']);
    expect(types('null')).toEqual(['keyword']);
  });
});

// ─── 연산자 ──────────────────────────────────────────────

describe('연산자', () => {
  it('비교 연산자', () => {
    expect(values('.a == 1')).toEqual(['.', 'a', '==', '1']);
    expect(values('.a != 1')).toEqual(['.', 'a', '!=', '1']);
    expect(values('.a <= 1')).toEqual(['.', 'a', '<=', '1']);
    expect(values('.a >= 1')).toEqual(['.', 'a', '>=', '1']);
  });

  it('alternative 연산자 //', () => {
    expect(values('.a // "default"')).toEqual(['.', 'a', '//', '"default"']);
  });

  it('update 연산자 |=', () => {
    expect(values('.a |= . + 1')).toEqual(['.', 'a', '|=', '.', '+', '1']);
    // 재확인: |= 가 pipe가 아님을 검증
    expect(types('.a |= . + 1')).not.toContain('pipe');
  });

  it('?// (try-alternative)', () => {
    const tokens = stripTrivia(tokenize('.a ?// "b"'));
    expect(tokens[2]).toMatchObject({ type: 'operator', value: '?//' });
  });
});

// ─── 구조 문자 ───────────────────────────────────────────

describe('구조 문자', () => {
  it('중괄호 객체 구성', () => {
    expect(types('{a: .b}')).toEqual([
      'lbrace', 'ident', 'colon', 'dot', 'ident', 'rbrace'
    ]);
  });

  it('대괄호 배열 구성', () => {
    expect(types('[.a, .b]')).toEqual([
      'lbracket', 'dot', 'ident', 'comma', 'dot', 'ident', 'rbracket'
    ]);
  });

  it('배열 반복 .[]', () => {
    expect(types('.[]')).toEqual(['dot', 'lbracket', 'rbracket']);
  });

  it('배열 인덱싱 .[0]', () => {
    expect(types('.[0]')).toEqual(['dot', 'lbracket', 'number', 'rbracket']);
  });

  it('괄호', () => {
    expect(types('(.a + .b)')).toEqual([
      'lparen', 'dot', 'ident', 'operator', 'dot', 'ident', 'rparen'
    ]);
  });
});

// ─── 중괄호 중첩 ─────────────────────────────────────────

describe('중괄호 중첩', () => {
  it('{a: {b: .c}} — 올바른 brace 매칭', () => {
    const tks = stripTrivia(tokenize('{a: {b: .c}}'));
    expect(tks.filter(t => t.type === 'lbrace')).toHaveLength(2);
    expect(tks.filter(t => t.type === 'rbrace')).toHaveLength(2);
  });

  it('중첩 객체 전체 토큰 시퀀스', () => {
    expect(types('{a: {b: .c}}')).toEqual([
      'lbrace', 'ident', 'colon',
      'lbrace', 'ident', 'colon', 'dot', 'ident', 'rbrace',
      'rbrace'
    ]);
  });
});

// ─── 객체 내 파이프 ──────────────────────────────────────

describe('객체 내 파이프 — splitByPipes 핵심 시나리오', () => {
  it('{a: .x | .y} — 파이프가 brace 내부임을 인식', () => {
    const tokens = stripTrivia(tokenize('{a: .x | .y}'));
    const nesting = computeNesting(stripTrivia(tokenize('{a: .x | .y}')));
    const pipeIdx = tokens.findIndex(t => t.type === 'pipe');
    expect(pipeIdx).toBeGreaterThan(-1);
    expect(nesting[pipeIdx].braceDepth).toBe(1); // brace 내부
  });

  it('splitTokensByPipe: 객체 내 파이프로 분할하지 않음', () => {
    const tokens = stripTrivia(tokenize('{a: .x | .y}'));
    const segments = splitTokensByPipe(tokens);
    expect(segments).toHaveLength(1); // 분할되지 않음
  });

  it('splitTokensByPipe: 최상위 파이프만 분할', () => {
    const tokens = stripTrivia(tokenize('.foo | {a: .x | .y} | .bar'));
    const segments = splitTokensByPipe(tokens);
    expect(segments).toHaveLength(3);
    expect(segments[0].map(t => t.value).join('')).toBe('.foo');
    expect(segments[2].map(t => t.value).join('')).toBe('.bar');
  });

  it('splitTokensByPipe: 괄호 내 파이프 무시', () => {
    const tokens = stripTrivia(tokenize('.a | map(. | .b) | .c'));
    const segments = splitTokensByPipe(tokens);
    expect(segments).toHaveLength(3);
  });
});

// ─── 불완전 입력 ─────────────────────────────────────────

describe('불완전 입력', () => {
  it('map(.foo | — 크래시 없이 토큰화', () => {
    const tokens = tokenize('map(.foo |');
    expect(tokens.length).toBeGreaterThan(0);
    expect(types('map(.foo |')).toContain('pipe');
  });

  it('{ name: . — 미닫힌 중괄호', () => {
    const tokens = stripTrivia(tokenize('{ name: .'));
    expect(tokens.map(t => t.type)).toEqual(['lbrace', 'ident', 'colon', 'dot']);
  });

  it('select(.a == — 미닫힌 괄호', () => {
    const tokens = stripTrivia(tokenize('select(.a =='));
    expect(tokens.length).toBeGreaterThan(0);
  });

  it('.foo | — 파이프 뒤 빈 입력', () => {
    const segments = splitTokensByPipe(stripTrivia(tokenize('.foo |')));
    expect(segments).toHaveLength(1); // .foo만
  });

  it('.foo | . — 파이프 뒤 점', () => {
    const segments = splitTokensByPipe(stripTrivia(tokenize('.foo | .')));
    expect(segments).toHaveLength(2);
  });
});

// ─── computeNesting ──────────────────────────────────────

describe('computeNesting', () => {
  it('중첩 깊이 추적', () => {
    const tokens = stripTrivia(tokenize("({["));
    const nesting = computeNesting(tokens);
    // ( → paren 0에서 시작, 후 1
    expect(nesting[0]).toEqual({ parenDepth: 0, bracketDepth: 0, braceDepth: 0 });
    // { → paren 1, brace 0에서 시작
    expect(nesting[1]).toEqual({ parenDepth: 1, bracketDepth: 0, braceDepth: 0 });
    // [ → paren 1, brace 1, bracket 0에서 시작
    expect(nesting[2]).toEqual({ parenDepth: 1, bracketDepth: 0, braceDepth: 1 });
  });

  it('닫는 괄호로 깊이 감소', () => {
    const tokens = stripTrivia(tokenize("(})"));
    const nesting = computeNesting(tokens);
    // ) → paren = 0 (음수 방지)
    expect(nesting[2].parenDepth).toBe(0);
  });
});

// ─── tokenIndexAtCursor ──────────────────────────────────

describe('tokenIndexAtCursor', () => {
  it('커서 위치의 토큰 반환', () => {
    const tokens = tokenize('.foo');
    // cursor=0 → dot (start=0, end=1)
    expect(tokenIndexAtCursor(tokens, 0)).toBe(0);
    // cursor=1 → 'foo' (start=1, end=4)
    expect(tokenIndexAtCursor(tokens, 1)).toBe(1);
  });

  it('범위 밖 커서 → -1', () => {
    const tokens = tokenize('.foo');
    expect(tokenIndexAtCursor(tokens, 100)).toBe(-1);
  });
});

// ─── 포맷 문자열 ─────────────────────────────────────────

describe('포맷 문자열', () => {
  it('@csv, @json 등', () => {
    expect(types('@csv')).toEqual(['format_string']);
    expect(types('.[] | @json')).toContain('format_string');
  });
});

// ─── 주석 ────────────────────────────────────────────────

describe('주석', () => {
  it('# 이후 줄 끝까지 주석', () => {
    const tokens = tokenize('.foo # comment\n| .bar');
    const stripped = stripTrivia(tokens);
    expect(stripped.map(t => t.type)).toEqual(['dot', 'ident', 'pipe', 'dot', 'ident']);
  });
});

// ─── 복합 시나리오 ───────────────────────────────────────

describe('복합 시나리오', () => {
  it('map(select(.age > 18) | .name)', () => {
    const tokens = stripTrivia(tokenize('map(select(.age > 18) | .name)'));
    expect(tokens[0]).toMatchObject({ type: 'ident', value: 'map' });
    expect(tokens).toContainEqual(expect.objectContaining({ type: 'pipe' }));
  });

  it('.users | map({name, age: .years}) | sort_by(.age)', () => {
    const tokens = stripTrivia(tokenize('.users | map({name, age: .years}) | sort_by(.age)'));
    const segments = splitTokensByPipe(tokens);
    expect(segments).toHaveLength(3);
  });

  it('reduce .[] as $x (0; . + $x)', () => {
    const tokens = stripTrivia(tokenize('reduce .[] as $x (0; . + $x)'));
    expect(tokens[0]).toMatchObject({ type: 'keyword', value: 'reduce' });
    expect(tokens.find(t => t.type === 'variable')).toMatchObject({ value: '$x' });
    expect(tokens.find(t => t.type === 'semicolon')).toBeTruthy();
  });

  it('[.[] | select(.active)] | length', () => {
    const tokens = stripTrivia(tokenize('[.[] | select(.active)] | length'));
    const segments = splitTokensByPipe(tokens);
    // 최상위 파이프 하나만 — 대괄호 안 파이프는 분할 안 됨
    expect(segments).toHaveLength(2);
  });

  it('def addtwo: . + 2; .x | addtwo', () => {
    const tokens = stripTrivia(tokenize('def addtwo: . + 2; .x | addtwo'));
    expect(tokens[0]).toMatchObject({ type: 'keyword', value: 'def' });
  });
});
