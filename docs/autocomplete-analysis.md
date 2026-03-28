# jq-playground 자동완성 구문 분석 — 현황 분석 및 개선 방향

## 1부. 현재 아키텍처 개요

### 모듈 구성

| 모듈 | 파일 | 역할 |
|------|------|------|
| **PipeAnalyzer** | `src/utils/pipe-analyzer.js` | 파이프 분할, 괄호 깊이 추적, 객체 구성 감지, 변수 추출 |
| **QueryPanel (자동완성)** | `src/components/QueryPanel.js` | 입력 처리, 문맥 판단, 후보 생성, 렌더링 |
| **AutocompleteCache** | `src/utils/autocomplete-cache.js` | 입력 키 캐싱, 컨텍스트 쿼리 결과 캐싱 (LRU, TTL) |
| **JqEngine** | `src/core/jq-engine.js` | jq-wasm Worker 기반 실행, 컨텍스트 추론 |

### 데이터 흐름

```
키 입력
  → getCurrentWord()        커서 위치에서 현재 단어/필드 접근 여부 판단
  → PipeAnalyzer.analyze()  파이프 세그먼트 분할, 함수/객체 문맥 분석
  → getFieldAccessContext()  필드 경로에서 prefix/currentSegment 분리
  → Worker (키 추출)         입력 JSON에서 필드 키 추출 (비동기, 캐싱)
  → jqEngine (컨텍스트 실행)  부분 쿼리 실행으로 현재 문맥의 필드 추출
  → filterAndSortKeys()     필터링/정렬 후 최대 15개 후보 생성
  → renderFieldAutocomplete() UI 렌더링
```

---

## 2부. 확인된 버그

### 버그 1: `splitByPipes` — 중괄호(`{}`) 깊이 미추적

**위치**: `pipe-analyzer.js:181-222`

**문제**: 파이프 분할 시 `parenDepth`(괄호)와 `bracketDepth`(대괄호)만 추적하고, `braceDepth`(중괄호)는 추적하지 않는다.

**영향**: 객체 구성 내부의 파이프가 최상위 파이프로 잘못 분할된다.

**재현**:
```jq
.data | {a: .x | length}
```

`splitByPipes` 결과:
- 기대: `['.data', '{a: .x | length}']` (2 세그먼트)
- 실제: `['.data', '{a: .x', 'length}']` (3 세그먼트) — 객체 내 파이프에서 잘못 분할

**관련 코드**:
```javascript
// pipe-analyzer.js:210
if (char === '|' && parenDepth === 0 && bracketDepth === 0) {
  // braceDepth 체크 없음
```

**참고**: 괄호로 감싸면 우회 가능 — `{a: (.x | length)}`는 정상 작동

---

### 버그 2: `analyzeObjectConstruction` — 콤마/콜론 분석 시 문자열 미추적

**위치**: `pipe-analyzer.js:130-148`

**문제**: `insideBrace` 내용 분석 루프에서 문자열 상태를 추적하지 않아, 문자열 리터럴 내 콜론/쉼표를 구문 요소로 오인식한다.

**재현**:
```jq
{key: "value: with, special", name
```

`colonCount`와 `lastCommaOrStart`가 문자열 내 `:`, `,`에 의해 오염된다.

**영향**: `isAfterColon`/`isShorthandPosition` 판단 오류 → 잘못된 자동완성 모드 선택

**관련 코드**:
```javascript
// pipe-analyzer.js:135-148 — 문자열 상태 추적 없음
for (let i = 0; i < insideBrace.length; i++) {
  const char = insideBrace[i];
  if (char === '(') parenDepth++;
  // ... 문자열 처리 없음
```

---

### 버그 3: `extractVariables` — 단축 구조분해 미지원

**위치**: `pipe-analyzer.js:283-288`

**문제**: 객체 구조분해에서 콜론이 있는 패턴(`as {key: $var}`)만 처리하고, 단축 패턴(`as {$a, $b}`)은 처리하지 않는다.

**재현**:
```jq
. as {$name, $age} | $name
```

`$name`과 `$age`가 변수 목록에 추출되지 않는다.

**관련 코드**:
```javascript
// pipe-analyzer.js:286 — 콜론 뒤의 변수만 매칭
const varMatches = inner.matchAll(/:\s*(\$\w+)/g);
```

---

### 버그 4: 이스케이프 처리 불완전 — 연속 백슬래시 패리티 미확인

**위치**: `pipe-analyzer.js:194` (splitByPipes), `pipe-analyzer.js:100` (analyzeObjectConstruction)

**문제**: `prevChar !== '\\'` 로 단일 백슬래시만 확인한다. 연속 백슬래시(`\\\\`)의 홀짝(패리티)을 계산하지 않아, `"test\\\\"` 같은 경우 문자열 경계를 잘못 판단할 수 있다.

**재현**:
```jq
"path\\\\"|keys   ← 백슬래시 4개(이스케이프 2쌍) 뒤 따옴표 = 문자열 종료
"path\\\\\\"|keys ← 백슬래시 6개(이스케이프 3쌍) 뒤 따옴표 = 문자열 종료
"path\\\\\"       ← 백슬래시 4개 + \" = 이스케이프된 따옴표, 미종료
```

단순 `prevChar !== '\\'` 체크로는 위 세 경우를 구별할 수 없다.

---

## 3부. 잠재적 오류

### 3-1. 중첩 객체 구성에서 컨텍스트 손실

```jq
.users | {profile: {age: .years, city: .loc|}}
```

`analyzeObjectConstruction`은 마지막 `{`를 기준으로 분석하므로, 외부 객체의 문맥 정보가 손실된다. 내부 객체에서 `.loc` 뒤의 자동완성이 올바른 컨텍스트(`.users[]` 하위)를 참조하지 못할 수 있다.

### 3-2. 변수 필드 자동완성 미지원

```jq
.items as $item | {name: $item.na|}
```

`$item.na` 에서 `$item`의 필드를 자동완성하는 기능이 없다. `getCurrentWord()`는 `$item`까지만 변수로 인식하고, `.na`는 별도의 필드 접근으로 분리된다. 변수가 바인딩된 값의 구조를 추적하는 메커니즘이 필요하다.

### 3-3. 배열 리터럴 후 컨텍스트 부정확

```jq
[.foo, .bar] | .
```

`completedQuery = '[.foo, .bar]'`를 실행하면 배열이 반환되지만, 사용자가 기대하는 것은 배열 요소의 필드 자동완성이다. 배열 결과에 대해 자동으로 `.[]`를 적용하는 로직이 없다.

### 3-4. `analyzeFunctionContext` 정규식 한계

**위치**: `pipe-analyzer.js:233-234`

```javascript
const funcMatch = segment.match(
  /^(map|select|...)\s*\(\s*([.{].*)?$/
);
```

- 함수 목록이 하드코딩되어 있어 사용자 정의 함수(`def`)를 인식하지 못함
- `[^)]*` 기반 중첩 함수 정규식이 괄호 깊이를 정확히 추적하지 못함
- `map(select(.a) | .b` 같은 중첩에서 실패 가능

### 3-5. `calculateEffectiveContextQuery` — `as` 바인딩 후 컨텍스트 소실

**위치**: `pipe-analyzer.js:59-73`

```jq
.items as $list | $list[].name|
```

마지막 완료 세그먼트 `.items as $list`에서 `as` 바인딩을 감지하면, 해당 세그먼트 전체를 제거한다. 결과적으로 `effectiveContextQuery`가 빈 문자열이 되어 컨텍스트 키 추출이 실패한다.

### 3-6. 캐시 해시 충돌 가능성

**위치**: `autocomplete-cache.js` — `hashInput()`

입력 데이터의 첫 100자 + 마지막 100자만 샘플링하여 해시를 생성한다. 중간 부분만 다른 두 JSON이 같은 해시를 가질 수 있으며, 이 경우 잘못된 캐시 결과가 반환된다.

---

## 4부. 구조적 한계 분석

### 근본 문제: 동일한 파싱의 중복 수행

현재 시스템은 **5개 이상의 독립적인 파싱 로직**이 각각 jq 문법을 부분적으로 해석한다:

| 함수 | 파싱 대상 | 문자열 처리 | 괄호 추적 | 중괄호 추적 |
|------|----------|:---------:|:--------:|:----------:|
| `splitByPipes` | 파이프 분할 | O | O | **X** |
| `analyzeObjectConstruction` (1차 루프) | 중괄호 매칭 | O | X | O |
| `analyzeObjectConstruction` (2차 루프) | 콤마/콜론 분석 | **X** | O | X |
| `analyzeFunctionContext` | 함수 패턴 | 정규식 | 정규식 | X |
| `extractVariables` | 변수 추출 | X | X | 정규식 |
| `getFieldAccessContext` | 필드 경로 | X | X | X |
| `getCurrentWord` | 단어 경계 | X | X | X |

**결과**:
1. 문자열/이스케이프 처리를 고치려면 **여러 함수를 동시에 수정**해야 함
2. 중괄호 추적을 추가하려면 **각 함수에 개별 구현**해야 함
3. 새로운 jq 문법 지원 시 **모든 파서에 반영**해야 함
4. 일관성 보장 불가 — 각 함수가 같은 입력을 다르게 해석할 수 있음

---

## 5부. 개선 방향 — 경량 jq 토크나이저

### 옵션 비교

| 접근 | 장점 | 단점 | 싱글파일 빌드 |
|------|------|------|:-----------:|
| **현재 코드 패치** | 변경 최소 | 구조적 한계 그대로 유지 | O |
| **경량 토크나이저** | 파싱 로직 통합, 순수 JS | jq 문법 수작업 정의 필요 | **O** |
| **tree-sitter-jq** | 완전한 AST, 에러 복구 내장 | .wasm 2개 추가, 문법 완성도 불확실 | **X** |
| **jq-wasm 파서** | 가장 정확 | API 미제공 (jq-web 0.6.2) | N/A |

### 권장안: 경량 jq 토크나이저 도입

**구현 완료**: `src/utils/jq-tokenizer.js`

핵심 설계:
- **한 번 토큰화** → 모든 분석 함수가 토큰 스트림을 소비
- 문자열/이스케이프/괄호 처리가 **한 곳**에서 해결됨
- `computeNesting()` — 모든 토큰의 괄호/중괄호/대괄호 깊이를 일괄 계산
- `splitTokensByPipe()` — 깊이 정보 기반으로 최상위 파이프만 분할 (버그 1 해결)
- 불완전한 입력에도 크래시 없이 동작 (미종료 문자열 → `error` 토큰)

**토큰 타입**:
```
string, number, dot, ident, pipe, lbrace, rbrace,
lbracket, rbracket, lparen, rparen, colon, comma,
semicolon, variable, operator, question, whitespace,
keyword, format_string, comment, error
```

### 단계적 도입 로드맵

#### Phase 1 (완료): 토크나이저 작성 및 테스트
- `src/utils/jq-tokenizer.js` — 55개 테스트 통과
- 싱글파일 빌드 호환 확인

#### Phase 2: PipeAnalyzer 토큰 기반 전환
- `splitByPipes` → `tokenize()` + `splitTokensByPipe()` 호출로 대체
- `analyzeObjectConstruction` → 토큰 스트림에서 중괄호/콜론/쉼표 분석
- `extractVariables` → 토큰에서 `keyword(as)` + `variable` 패턴 매칭

#### Phase 3: QueryPanel 함수 통합
- `getCurrentWord` + `getFieldAccessContext` → 토큰 기반으로 통합
- `analyzeFunctionContext` → 토큰 패턴 매칭으로 대체 (정규식 제거)
- 커서 위치의 토큰으로 문맥을 정확히 판단

#### Phase 4: 기능 확장
- 변수 필드 자동완성 (`$x.field` 패턴)
- 배열 리터럴 후 컨텍스트 자동 보정
- 사용자 정의 함수(`def`) 인식
