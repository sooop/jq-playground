# 자동완성 구문 분석 — 현황 분석 문서 + 토크나이저 도입 계획

## Context
jq-playground 자동완성의 구문 분석 로직(PipeAnalyzer, QueryPanel)이 ad-hoc 패턴 매칭의 누적으로 복잡한 jq 문법에서 오작동한다. 현재 버그와 잠재적 오류를 문서화하고, 경량 jq 토크나이저 기반 리팩터링 방향을 제시한다.

**핵심 제약**: 싱글파일 빌드(`dist/index.html`) 유지 필수 — 추가 .wasm 파일 불가

## 작업 1: 분석 문서 작성

**파일**: `docs/autocomplete-analysis.md` (한국어)

### 문서 구조

#### 1부. 현재 아키텍처 개요
- 모듈별 역할: PipeAnalyzer, QueryPanel 자동완성 함수들, AutocompleteCache
- 데이터 흐름: 키 입력 → 문맥 분석 → 후보 생성 → 렌더링

#### 2부. 확인된 버그
| # | 위치 | 문제 | 재현 표현식 |
|---|------|------|------------|
| 1 | `splitByPipes` (pipe-analyzer.js:181-222) | `{}` 깊이 미추적 → 객체 내 파이프 오분할 | `{a: .x \| .y}` |
| 2 | `analyzeObjectConstruction` (pipe-analyzer.js:130-148) | insideBrace 루프에서 문자열 미추적 → 문자열 내 콜론/쉼표 오인식 | `{key: "a:b", name` |
| 3 | `extractVariables` (pipe-analyzer.js:283-288) | 단축 구조분해 미지원 | `as {$a, $b}` |
| 4 | splitByPipes + analyzeObjectConstruction | 이스케이프 패리티 미확인 (연속 `\\`) | `"test\\\\"` |

#### 3부. 잠재적 오류
- 중첩 객체 구성 컨텍스트 손실: `{a: {b: .field|}}`
- 변수 필드 자동완성 미지원: `$x.field`
- 배열 리터럴 후 컨텍스트 부정확: `[.foo, .bar] | .`
- analyzeFunctionContext 정규식 한계: 중첩 함수
- calculateEffectiveContextQuery의 as 바인딩 후 컨텍스트 소실
- 캐시 해시 충돌 (첫100+마지막100자 샘플링)

#### 4부. 구조적 한계 분석
- 현재 접근의 근본 문제: 동일한 파싱을 여러 함수에서 중복 수행
- 각 함수가 독립적으로 문자열/괄호/깊이를 추적 → 일관성 보장 불가

#### 5부. 개선 방향 — 경량 jq 토크나이저
- **옵션 비교**: 현재 코드 패치 vs 토크나이저 vs tree-sitter-jq
- **권장안**: 경량 토크나이저 도입
  - 싱글파일 빌드 호환 (순수 JS, 추가 .wasm 불필요)
  - 한 번 토큰화 → 모든 분석 함수가 토큰 스트림 소비
  - 자동완성에 필요한 수준만 커버
- **토큰 타입 초안**: `string`, `number`, `dot`, `ident`, `pipe`, `lbrace/rbrace`, `lbracket/rbracket`, `lparen/rparen`, `colon`, `comma`, `semicolon`, `as`, `variable`, `operator`, `whitespace`, `keyword`(if/then/else/end/try/catch/reduce/foreach/label/break)
- **단계적 도입 로드맵**:
  1. 토크나이저 모듈 작성 + 테스트
  2. PipeAnalyzer가 토큰 스트림 기반으로 전환
  3. 기존 동작 유지 확인 후 점진적 버그 수정

## 작업 2: 토크나이저 구현 + 테스트

**기존 코드 유지** — PipeAnalyzer, QueryPanel은 수정하지 않음. 토크나이저를 먼저 독립 모듈로 작성하고 빌드·테스트까지 확인.

### 파일 구성
- `src/utils/jq-tokenizer.js` — 토크나이저 모듈 (순수 JS, 의존성 없음)
- `tests/jq-tokenizer.test.js` — 테스트 (프로젝트 테스트 프레임워크 확인 필요)

### 토크나이저 요구사항
- 입력: jq 쿼리 문자열 (불완전할 수 있음)
- 출력: 토큰 배열 `[{type, value, start, end}, ...]`
- 문자열 리터럴: 이스케이프 시퀀스 완전 처리 (연속 백슬래시 패리티)
- 괄호/중괄호/대괄호: 개별 토큰으로 분리
- 불완전한 입력: 에러 토큰(`error`/`unterminated_string`)으로 표현, 크래시 없음
- jq 작은따옴표: jq는 작은따옴표 문자열 미지원이므로 무시 가능

### 빌드 검증
- `npm run build` 성공 확인 (Vite single-file)
- 토크나이저가 빌드에 포함되는지 확인 (import만 해도 tree-shake 대상이 될 수 있으므로)

### 테스트 케이스 (최소)
1. 기본 파이프 분할: `.foo | .bar` → 토큰 시퀀스 확인
2. 문자열 내 파이프: `"hello | world"` → 단일 string 토큰
3. 이스케이프: `"test\\"` → 올바른 문자열 경계
4. 중괄호 중첩: `{a: {b: .c}}` → 올바른 brace 매칭
5. 객체 내 파이프: `{a: .x | .y}` → pipe가 brace 내부에 있음을 표현
6. 불완전 입력: `map(.foo |` → 에러 없이 토큰화
7. 변수: `.price as $p | $p` → variable 토큰
8. 키워드: `if .a then .b else .c end` → keyword 토큰

## 수정/생성 파일 목록
- 생성: `docs/autocomplete-analysis.md`
- 생성: `src/utils/jq-tokenizer.js`
- 생성: `tests/jq-tokenizer.test.js` (테스트 프레임워크에 따라 경로 조정)

## 검증
1. `npm run build` 성공
2. 테스트 전체 통과
3. 기존 자동완성 동작 변경 없음 (기존 코드 미수정)
