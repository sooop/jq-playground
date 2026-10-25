# xsv-playground 통합 계획 — CSV / jq / Markdown 3-모드 단일 HTML 앱

**Date**: 2026-09-17  
**Target Route**: src/  
**Status**: Draft  

## Overview

세 개의 독립적인 도구(CSV 편집기, jq 쿼리 빌더, Markdown 뷰어)를 하나의 Svelte 앱으로 통합하여 단일 `dist/index.html`로 빌드 및 배포하는 계획입니다. 기존 xsv-playground의 디자인 토큰과 테마를 기준으로 하며, 각 모드의 기능을 최대한 보존합니다.

---

## Context

이웃한 세 저장소가 각각 "단일 HTML로 빌드해 로컬에서 더블클릭으로 쓰는 도구"라는 같은 형태를 가진다.

| 저장소 | 스택 | 규모 | 비고 |
|---|---|---|---|
| `D:\project\xsv-playground` | Svelte 5 + TS | src 13.1k줄, 테스트 301+297+24건 | 디자인 토큰·테마의 기준. 통합 대상 저장소(브랜치 `sooop/integrated`) |
| `D:\project\jq-playground` | Vanilla TS | src 13.8k줄 + CSS 3.1k줄 | DataGrid는 xsv 그리드 코어의 축소 복사판(주석에 출처 명시). UI 6.5k줄은 Svelte로 재작성 필요 |
| `D:\project\md-viewer` | Svelte 5 + JS | src 2.8k줄, 테스트 없음 | 이미 Svelte 5 runes. 편집 모드·자동 저장까지 있음 |

세 도구를 **하나의 Svelte 앱, 하나의 `dist/index.html`** 로 합친다. 디자인·UI 체계는 xsv의 토큰과 테마를 그대로 쓰고, 각 도구의 기능은 최대한 그대로 이식한다. 인터넷 연결은 상정한다(무거운 라이브러리는 CDN 지연 로드).

## 사용자와 합의된 결정 (인터뷰 결과 — 변경 불가)

1. **저장 위치**: 이 저장소에 통합. 이름·`package.json name`·`dist/index.html` 유지. jq·md 저장소는 보관용(이력 이관 없음).
2. **셸 구조**: 상단 **모드 탭 3개 (CSV / jq / Markdown)**, 도구당 1문서. 모드를 오가도 각 모드 상태(스크롤 위치 포함)는 유지. 파일 드롭 시 종류에 따라 해당 모드로 자동 전환. 붙여넣기는 활성 모드가 처리.
3. **그리드 통합**: jq DataGrid 폐기, **xsv `Grid.svelte`에 `readonly` 옵션** 추가해 jq 출력 뷰로 재사용.
4. **도구 간 연결**: (a) jq CSV 출력 → CSV 모드, (b) CSV 표(전체/보이는 부분/선택) → JSON 배열로 jq 입력, (c) MD 코드블록(csv/tsv/json) → 해당 도구로 열기. 대상 모드에 문서가 있으면 `dialogs.confirm`으로 덮어쓰기 확인.
5. **디자인**: xsv `src/app.css` 토큰·`data-theme` 테마만 사용. **단일 앰버 액센트**(jq 3색 삼면화 폐기, 패널 구분은 라벨·경계선·포커스 테두리).
6. **폰트**: 로컬 폰트 스택만. 웹폰트 링크 전부 삭제.
7. **지연 로드**: SheetJS·jq-web·Mermaid·KaTeX·highlight.js는 **처음 쓰는 시점에 CDN 로드**. marked·dompurify만 번들(마크다운 기본 렌더는 오프라인 동작). CSV 경로는 오프라인 유지.
8. **저장소**: **새 IndexedDB 하나**(`xsv-playground`)를 모드별 스토어로 분할. 기존 세 DB 데이터 이관 없음. localStorage는 `xsv.` 접두 하나.
9. **단축키**: 각 모드 단축키는 **활성 모드에서만** 동작. 셸 전역은 **모드 전환 Ctrl+Shift+1/2/3** 만. 커맨드 팰릿(Ctrl+K)·도움말(`?`)은 jq·md·CSV 각자 것 유지(셸 통합 팰릿 없음).
10. **언어**: 전부 TypeScript(md-viewer `.js` → `.ts`, `.svelte`에 `lang="ts"`). xsv tsconfig `strict` + `noUnusedLocals/Parameters` + `verbatimModuleSyntax` 통과.
11. **검증**: xsv 단위·e2e·edge 전부 유지 + jq 단위 테스트 4파일 이식 + **모드 전환·파일 라우팅·연결 기능 e2e 추가**. e2e 외부 요청 감시는 "허용 CDN 도메인 목록" 방식.

### 설계 중 확정한 세부 결정

- **아이콘**: `@lucide/svelte` 도입 안 함. md의 12개 아이콘·jq `icons.ts`는 xsv 관례대로 인라인 SVG. 런타임 의존성은 marked·dompurify 2개만 추가(README의 "0개" 문구 수정).
- **툴체인**: svelte `^5.56` 으로 올림(md 코드 호환). vite `^7`, plugin-svelte `^6`, TS `^5.9`, vitest `^5` 유지(단일 파일 빌드가 검증된 조합).
- **모드 페인 표시**: `display:none` 금지 → `position:absolute; inset:0` 스택에 `visibility:hidden` + `inert`. `display:none`은 `overflow:auto` 요소의 scrollTop을 0으로 리셋하고 Grid 뷰포트가 한 프레임 0이 된다. **한 번이라도 활성화된 모드만 마운트**(`mounted[m]` 래치) → CSV만 쓰는 기존 e2e의 DOM이 현행과 동일하게 유지되어 전역 셀렉터(`.canvas .tr`, `[role=grid]` 등)가 중복 매치되지 않는다.
- **readonly Grid 범위**: 셀 편집(더블클릭·F2·Enter·타이핑)·붙여넣기·Delete·헤더 이름변경·행 드래그 순서변경 차단. 정렬·필터·열 폭·**열 순서 드래그**(jq DataGrid도 허용했던 기능, 모드가 `onMoveCol`에서 히스토리 없이 적용)·숨기기·선택·복사·찾기·내보내기 허용. 컨텍스트 메뉴 항목은 Grid가 아니라 각 모드가 만든다(`Grid.svelte:704-727`은 `onContextMenu(e)`만 올림) — 이 분리 유지.
- **셸 ↔ 모드 통신**: 명령(`openFile/openText/receive/focusMode`)은 `bind:this` + `export function`(저장소 기존 관례: `Grid.svelte:214,229,334`), 활성 여부는 `isActive` prop, 모드→셸 상태(hasDocument/isDirty/label)는 공유 rune 스토어 `shell.status[mode]`, 서비스(toast/dialog/theme)는 모듈 싱글턴.
- **jq 워커**: `json-preprocess.worker.ts`는 `?worker&inline` import로 인라인(현 jq `dist/`는 2025-05 stale 산출물로 모듈 워커 도입 후 단일 파일 빌드가 검증된 적 없음). Blob 문자열 워커 3종(jq 실행·키 추출·포맷)은 그대로. 메인 스레드 `window.jq` 로드는 워커 실패 시 폴백으로만.
- **jq-engine 가드 수정(필수)**: `jq-engine.ts:257-259` `executeForContext`가 `this.instance` null이면 throw → 워커 전용 모드에서 자동완성 컨텍스트 추론이 조용히 죽는다. `if (!this.worker && !this.instance)`로 완화. 그 외 pipe-analyzer 알려진 버그 4건은 **그대로 가져온다**(이식 범위 외).
- **콘솔 규약**: e2e가 콘솔 에러 1건에도 실패하므로 이식 코드의 `console.*` 전수 제거(jq `indexeddb-storage.ts:56,78` 등). jq-web Emscripten 로그는 `Module.print/printErr` 주입으로 삼킨다. 그래도 남으면 화이트리스트 여부를 **별도 결정 사항으로 사용자에게 올림**.
- **localStorage 키 충돌**: CSV·jq 그리드가 `FindStore`의 `findRegex`, App의 `regexMode`를 공유하면 Alt+R 상태가 전이된다 → 키에 모드 접두(`csv.regexMode`/`jq.regexMode`, `FindStore` 생성자에 키 인자).

---

## 목표 디렉터리 구조

```
src/
  main.ts                          무변경
  App.svelte                       셸(약 250줄): 테마·탭바·페인 스택·파일 input·드롭 오버레이·Toast·DialogHost
  app.css                          토큰 + 공용 클래스(.toolbar/.btn.on/.drop-hint 승격)
  shell/
    mode.ts                        ModeId · ModePayload · ModeHandle · ModeStatus 타입
    shell.svelte.ts                shell 상태(active/status/theme) + sendTo() + mounted 래치
    fileKind.ts                    detectFileKind(name, head, sample)
    ModeTabs.svelte
  modes/
    csv/CsvMode.svelte             App.svelte에서 잘라낸 CSV 전체
    jq/  JqMode.svelte, jqState.svelte.ts, index.ts, core/ utils/ panels/ autocomplete/ transform/ data/
    md/  MdMode.svelte, mdState.svelte.ts, lib/ components/
  lib/                             위치 그대로 (테스트 import 경로 무변경)
    ui/toast.svelte.ts             (신규) 토스트 싱글턴
    ui/GridWorkbench.svelte        (신규) 그리드+필터+열관리+찾기+내보내기 재사용 단위
    util/cdn.ts                    (신규) loadScript/loadStyle — xlsx.ts:26-44 일반화
    data/idb.ts                    (신규) DB 배관(openDb/withTx/req/normalizeError/SCHEMA)
    data/kvStore.ts                (신규) jq/md용 범용 CRUD + LRU enforceLimit
    data/docStore.ts               CSV 문서 API — 공개 시그니처 불변, idb.ts 위임
```

`lib/ui/`의 CSV 전용 다이얼로그(SheetPicker/DocPicker/Split/Join/Replace/ShortcutHelp)를 `modes/csv/ui/`로 내리는 것은 **통합 완료 후 별도 커밋**으로 미룬다.

---

## 핵심 인터페이스

```ts
// src/shell/mode.ts
export type ModeId = 'csv' | 'jq' | 'md'
export type ModePayload =
  | { kind: 'table'; header: string[]; rows: string[][]; name: string; from: ModeId }
  | { kind: 'text';  text: string; name: string; from: ModeId }
export interface ModeHandle {
  openFile(file: File): Promise<void>
  openText(text: string, name: string): Promise<void>
  receive(p: ModePayload): Promise<void>     // 셸이 덮어쓰기 확인을 마친 뒤 호출
  focusMode(): void
  handleKeydown(e: KeyboardEvent): boolean   // 활성 + 다이얼로그 없음일 때만 셸이 호출
}
export interface ModeStatus { hasDocument: boolean; isDirty: boolean; label: string }
```

```ts
// src/shell/shell.svelte.ts
export const shell = $state({ active: 'csv' as ModeId, theme: 'dark' as 'dark'|'light',
  status: { csv: {...}, jq: {...}, md: {...} } as Record<ModeId, ModeStatus> })
export async function sendTo(to: ModeId, p: ModePayload): Promise<void>
//  → status[to].hasDocument 이면 dialogs.confirm → handles[to].receive(p) → active = to
```

셸의 전역 keydown(캡처 단계, 기존 `App.svelte:1487` 방식 계승): ① Ctrl+Shift+1/2/3 → 모드 전환 ② `dialogs`에 열린 다이얼로그가 있으면 중단(`dialog.svelte.ts`에 `isOpen` getter 없으면 추가) ③ `handles[active].handleKeydown(e)`.

`shell.theme`은 기존 `App.svelte:92-108`의 `theme` 파생값을 스토어로 옮긴 것 — md의 Mermaid 재렌더(`render-extras.js:141-163`)와 hljs 토큰 CSS가 구독한다. `save('themePref')` 키·값은 e2e:1497이 직접 읽으므로 **변경 금지**.

IndexedDB 스키마(`idb.ts`, DB `xsv-playground` v1, 멱등 `onupgradeneeded` 유지):

| 스토어 | keyPath | 인덱스 | 제한 |
|---|---|---|---|
| `csv.docMeta` / `csv.docBody` | id | by_updated | — |
| `jq.inputHistory` | id(auto) | timestamp, lastUsed, contentHash | 300 LRU |
| `jq.queryHistory` | id(auto) | timestamp | 100 LRU |
| `jq.savedQueries` | id(auto) | — | (현 jq는 localStorage에 저장 → IDB로 통일, 초기화 비동기화) |
| `md.files` | id(auto) | name, openedAt | 20 LRU(현재 열린 문서 보호) |

계승 규약(`docStore.ts:1-15` 주석): 콘솔 출력 0 · 실패한 `dbPromise` 캐시 안 함 · `tx.onerror/onabort` 양쪽 reject · meta+body 한 트랜잭션.

---

## 구현 단계

각 단계 끝에서 `npm run verify`(check → test → build → e2e → edge) 통과. 사용자가 `npm run dev`를 띄워 두는 경우가 많으므로 `npm run build`/`.next`류 파괴 작업 전 포트 점유 확인(글로벌 CLAUDE.md 규칙 — 이 프로젝트는 Vite라 `dist/`만 건드리지만 `vite build`가 `dist`를 비우므로 동일 원칙 적용).

### P0. 기준선
`npm run verify` + `npm run e2e:shots` 결과·dist 크기(현 257KB) 기록.

### P1. 무해 추출 3종 (App.svelte 동작 완전 불변, e2e/edge 수정 0줄)
- `lib/util/cdn.ts` `loadScript(url)`/`loadStyle(url)`: 중복 호출 dedupe + **실패 시 캐시 삭제해 재시도 가능**(`xlsx.ts:38` 규약). `xlsx.ts:26-44` `loadSheetJS`를 3줄로 축소.
- `lib/ui/toast.svelte.ts` `ToastController{items, push, dismiss}` 싱글턴 `toasts`. `App.svelte:114-124` 위임, `Toast.svelte` 무수정. 하위 컴포넌트의 `onNotice` prop 드릴링(`Grid.svelte:31`, `ColumnManager.svelte:12`)은 그대로 두되 신규 코드는 싱글턴 사용.
- `lib/data/idb.ts` 분리(openDb/req/withTx/normalizeError/DocStoreError/newDocId/idbUsable/storageInfo, `docStore.ts:25-161,200-210`). `docStore.ts`는 위임만. **DB_NAME은 아직 `'xsv'`.** `tests/docs.test.ts`는 docStore를 import하지 않아 영향 0.

### P2. CsvMode 순수 추출 (가장 위험 — 여기서 멈추고 확인)
- `App.svelte` 63-1489행(인스턴스·로딩·엑셀·편집 연산·컨텍스트 메뉴 items·문서 저장·도구·전역 단축키)과 마크업 1519-1840행, 스타일(`.toolbar/.brand/.sheet-name/main/.banner/.empty-filter/.doc-progress*`)을 `modes/csv/CsvMode.svelte`로 이동. import 경로 `./lib/…`→`../../lib/…` 약 60행.
- App에는 테마·Toast·DialogHost·`<CsvMode isActive={true} />`만.
- 루트 `<main>`은 `<section class="mode">`로(모드마다 `<main>`이 생기면 안 됨). `.empty-filter`의 `inset: var(--header-h) 0 0 var(--gutter-w)`는 페인 기준 유지.
- **합격 기준: DOM 구조·클래스·aria가 1바이트도 안 바뀌어 e2e/edge 무수정 통과.**

### P3. 셸 골격
- `ModeTabs.svelte` + 페인 스택(`visibility`+`inert`) + `shell.active` + Ctrl+Shift+1/2/3 + `mounted` 래치. jq/md는 플레이스홀더.
- 높이 체인: `.app{flex column; height:100%}` → 탭바 `flex:none` → 페인 컨테이너 `flex:1; min-height:0; position:relative`.
- CsvMode의 `window.addEventListener('keydown', …, true)`(1487행)를 제거하고 `handleKeydown(e)` export로 전환. 모드 내부 팝업(ContextMenu/ColumnManager/툴 메뉴)은 `isActive` false 전환 `$effect`에서 전부 닫는다.
- 테마 버튼(`1625-1648`)을 CSV 툴바 → 탭바 우측으로 이동. e2e:1487-1491이 `aria-label` 접두 `'테마'`로 찾으므로 버튼 속성 유지. `shell.theme` 스토어화.
- 신규 e2e 그룹 **'모드 전환'**: 탭 클릭·단축키·플레이스홀더 왕복 후 CSV 필터+정렬+`.body` scrollTop 동일.

### P4. 파일 라우팅
- `shell/fileKind.ts`: ① `looksSpreadsheet(name, head)`(`detect.ts:21-25`) → csv ② 확장자(`.md .markdown .mdown .mkd`→md / `.json .jsonl .ndjson .geojson`→jq / `.csv .tsv .tab .psv`→csv) ③ `.txt/.log/무확장자`는 내용 스니핑(선행 `{`/`[` 또는 첫 두 줄 JSON.parse→jq / `#`·코드펜스·`|---|`→md / `detectDelimiter`+`CsvParser`로 앞 20줄 필드 수 ≥2·분산 0→csv — `detectDelimiter`는 폴백 `,`를 반환하므로 반환값만으로 판정 금지) ④ 폴백 md.
- 셸은 `file.slice(0, 64KB)`만 읽어 판정(`decodeBytes`로 cp949 안전), 본문은 모드가 읽는다(28MB 이중 읽기 방지).
- 셸 파일 input `accept`를 md/json 확장자까지 확장. 창 전역 드롭에서 `if (!hasData) return`(`App.svelte:1494,1501`) 제거. DropZone 자체 드롭(`DropZone.svelte:57-62`)과 이중 처리 없는지 확인. 드래그 오버레이 `.drop-hint`를 앱 루트로 승격.
- CsvMode에 `openFile/openText/receive/focusMode` export. **`openText`/`receive`는 반드시 `loadText` 경로를 지나야** `currentDoc = null` 불변식(`App.svelte:934-939`)이 유지된다.
- 신규 e2e 그룹 **'파일 종류 자동 전환'**(`.md`/`.json`/`.csv`/JSON 내용의 `.txt`).

### P5. 새 IndexedDB
- `DB_NAME='xsv-playground'`, 스토어 `csv.docMeta`/`csv.docBody`, `kvStore.ts`(list/get/put/del/clear/findByIndex + `enforceLimit` LRU — jq `indexeddb-storage.ts:198-229` 로직을 콘솔 없이 재작성). e2e는 매 실행 새 프로필이라 영향 없음.

### P6. Grid readonly + GridWorkbench 추출
- `Grid.svelte` `readonly = false` prop. 가드: `startEdit`(335) 맨 앞, `typeToEdit`(474 — `preventDefault`가 먼저 실행되므로 별도 가드 필수), `onBodyDblClick`(319 — 선택은 유지), Delete/Backspace(445), `onPaste`(481), `onHeadDblClick`(572 — `autoWidth`는 허용, rename만 차단), `onGutPointerMove/Up`(661-694 행 드래그), 편집 오버레이 `{#if editing && !readonly}`. 루트에 `class:readonly`.
- `export function remeasure()`(ResizeObserver 콜백 본문 `146-157` 추출 + `syncScroll`). 모드 활성화 시 `requestAnimationFrame(() => grid?.remeasure())` 보험.
- `lib/ui/GridWorkbench.svelte`: `{ds, view, sel, find, readonly?, toolbarStart?/toolbarEnd? (Snippet), contextItems?, statusExtra?, 편집 콜백들}` — `<Grid>`·`<SmartFilter>`·정렬/필터 초기화·`<ColumnManager>`·`<ColumnFilterMenu>`·찾기(`openFind/closeFind/gotoHit`+`<FindPanel>`)·`doExport`+`<ExportDialog>`·`<StatusBar>`·`.empty-filter`를 묶는다(모두 `ds/view/sel/find`에만 의존, 편집 Op 무관 — `App.svelte:1177-1194,1356-1367,1589-1614,1660-1722,1763-1784,1809-1811`). CsvMode에서 추출하며 **DOM 무변경이 합격 기준**.

### P7. 모드 본체 — **jq와 md를 서브 에이전트로 병렬 진행**(상호 간섭 없음: 서로 다른 디렉터리, 공용 lib는 P1~P6에서 확정)

#### P7-jq (`src/modes/jq/`) — 단계별 완료 기준은 순서대로 누적
1. **순수 로직 복사 + strict 타입 보정**: `core/{jq-engine,jq-functions,csv-parser,csv-converter,file-handler}`, `utils/{jq-tokenizer,pipe-analyzer,json-extractor,json-position-scanner,json-preprocessor,json-preprocess-client,json-preprocess.worker,stringified-fields,autocomplete-cache,virtual-scroller,keyboard,keymap}`. 암묵적 any 제거, `import type`. `INPUT_TYPE_INFO`(`jq-functions.ts:207-218`)의 hex 10개 제거 → 클래스 기반. 테스트 4파일(`jq-tokenizer/json-preprocessor/stringified-fields/csv-matrix`) 이식(grid-* 3파일 제외). 완료: `npm run check` + jq 테스트 green.
2. **워커 배선**: `?worker&inline`, `loadScript`로 jq-web 지연 로드(`engine: idle|loading|ready|failed`, 로딩 중 출력 패널 안내, 실패 시 `dialogs.alert`), `jq-engine.ts:257-259` 가드 완화, `postToWorker` 실패 시 메인 스레드 폴백(`scanOnMainThread` 등 이미 존재). 완료: `npm run build` 후 `dist/`에 `index.html` 1개, `rg -c scanDocument dist/index.html > 0`, `file://`로 열어 첫 쿼리 실행 성공.
3. **`jqState.svelte.ts`**: input/inputName/autoFormat/transformUndo/query/format/autoPlay/maximized/resultText/`matrix`(**`$state.raw`**)/execMs/loading/error/stale/splitH·splitV(`xsv.jq.*`)/engine. 디바운스 `$effect` 규칙: 트리거는 `input.length`·`query`·`autoPlay`만(`format`은 별도 effect로 `formatResult`만), 지연 300/500/1000ms(`App.ts:398-412`), generation 카운터 유지(`:454-461`), `format`은 `await execute()` 후 읽기, 3MB 초과 시 autoPlay 해제(`:427-437`), 수동 실행은 `run(true)`.
4. **패널 3종**: `panels/InputPanel.svelte`(+`InputHistoryMenu`, `InputFindPanel`, `core/input-pipeline.ts`로 파일/드롭/붙여넣기 5분기 통합 `InputPanel.ts:611-678`), `panels/QueryPanel.svelte`(+`QueryHistoryMenu`, `SavedQueriesMenu`, `util/fuzzy.ts`), `panels/OutputPanel.svelte`(+`OutputJson.svelte` 가상 스크롤·검색, 에러 시 이전 결과 흐리게+"이전 결과" 라벨 `OutputPanel.ts:496-532`). 패널 간 DOM 직접 접근 4곳(`Toolbar.ts:220`, `InputPanel.ts:439`, `QueryPanel.ts:1174`, `TransformModal.ts:137,543`)은 전부 상태 스토어 경유로. `alert/confirm` 30여 곳 → `dialogs`(paste 핸들러가 비동기로 바뀌는 점 주의).
5. **출력 그리드**: `finalize([matrix.header, ...matrix.rows], ',', true, false)`(`detect.ts:206`) → `ds.loadParsed(pr, name)`(`dataset.svelte.ts:155`). 자체 `Dataset/View/SelectionStore/FindStore` 인스턴스. `<GridWorkbench readonly>` + 컨텍스트 메뉴(복사/열 숨기기/숨김 해제/내보내기/찾기). 결과 행수 임계(20만) 초과 시 토스트 경고. "CSV 모드로 보내기" 버튼(format==='csv'일 때만).
6. **자동완성**: `autocomplete/engine.svelte.ts`(`QueryPanel.ts:1104-1377`, `924-979`, `1027-1075`), `word.ts`(순수화, 단위 테스트 신설), `caret.ts`(mirror div), `AutocompletePopup.svelte`, `AutocompleteDoc.svelte`. 수용 체크리스트 12항목: `$var` 완성 / `{name, a|` shorthand / 콜론 뒤 / prefix 분리 / 캐시→동기→워커 3단 렌더 / 컨텍스트 쿼리 2초 타임아웃+함수별 fallback / `updateId` 취소 가드 5곳 / 단어 끝 아니면 숨김·정확 일치 1건 숨김 / **Tab 순환**(zsh menu completion, Esc 원본 복원) / 줄 시작 Tab 들여쓰기 / hover-lock 5px / 괄호 자동 삽입.
7. **Transform 모달**: `transform/TransformDialog.svelte`, `CandidateList`, `FieldTree`(24px 가상 스크롤), `TransformPreview`(200KB/2MB 임계). 체크리스트 8항목: 취소 가드 / 후보→필드→프리뷰 3단 연쇄 / `preserveFormat`은 `spansAvailable`일 때만 / 조상 자동 선택·고아 제거 / `focusPaths`(Find ↧ 진입) / Preview 임계 / Apply 스냅샷 Undo → Input Undo 버튼 / 열 때 빈 입력이면 클립보드 읽기+10MB confirm.
8. **치트시트·스니펫·도움말·커맨드 팰릿**: 데이터(`data/cheatsheet.ts`, `data/snippets.ts`) 분리, 다이얼로그 3종 + `CommandPalette.svelte`(Ctrl+K, jq 모드 소유). 툴바 File/View/Tools/Help 드롭다운은 jq 모드 자체 툴바 행(xsv `ContextMenu.svelte` 재사용).
9. **단축키·리사이즈·최대화**: `keymap.ts`를 `createKeymap()` 인스턴스 + `dispatch(e)`로(window 리스너 제거, `isEditing` 가드 유지). Ctrl+1/2/3·F6·Ctrl+Shift+T/E/M·Esc·`?`·Ctrl+Enter·Ctrl+F(입력 Find/출력 검색)·Ctrl+Shift+F. 스플리터 비율 `xsv.jq.splitH/V`.
10. **CSS**: `tokens.css/toolbar.css/command-palette.css/data-grid.css` 폐기, `layout.css`→JqMode scoped(3색 주입 `:52-54`·`--font-display` 타이틀 `:84-90`·`inset box-shadow` `:74` 삭제), `components.css` 1596줄을 컴포넌트별 scoped로 분산, `json-transform.css`→transform/*. 토큰 매핑: `--bg-primary→--bg-raised`, `--bg-secondary→--bg`, `--bg-tertiary→--bg-header`, `--text-primary/secondary/tertiary/muted→--text/--text-dim/--text-dim/--text-faint`, `--border-primary/secondary/light→--border/--border-strong/--border-soft`, `--accent-*→--accent`, `--accent-bg/subtle→--accent-soft`, `--error-color→--danger`, `--success→--ok`, `--info→--sel`, `--shadow-*→--shadow-pop`, `--overlay-bg→--bg-overlay`, `--ring→전역 :focus-visible`, `--radius/space→리터럴`, `--font-sans→--font-ui`, `--font-size-*→--fs-label/--fs-ui/12.5/13/14px`, `--transition→var(--dur) var(--ease)`. hex 24곳(`components.css:166,546-563,726-743,1259-1311,1542-1581`) 치환. 완료: `rg '#[0-9a-fA-F]{3,8}' src/modes/jq --glob '*.svelte'` 0건.
11. **저장소**: `storage.ts` 585줄 → `kvStore` 위 150줄 어댑터. 마이그레이션·localStorage 폴백·테마/액센트 API·`flushAll` 삭제. 키: `jq-panel-resize→xsv.jq.splitH/V`, `jq-find-regex→xsv.jq.inputFindRegex`, `jq-input-sort→xsv.jq.inputSort`, 나머지 삭제. FNV-1a 해시 dedup 유지.
12. **JqMode 공개 API**: `openFile`(파일 파이프라인), `openText`(붙여넣기 파이프라인), `receive`(`text`→`setInput`), `hasDocument`(`input.trim().length>0`), `handleKeydown`, `focusMode`. `shell.status.jq` 갱신 `$effect`.

#### P7-md (`src/modes/md/`)
1. **DB**: `lib/db.ts` — `kvStore` 위에 `saveFile(name, content, source, protectId)`(동일 name+source면 갱신, MAX 20 LRU) / `saveScrollPos` / `updateContent` / `updateName`. 단위 테스트 신설(name+source 중복 판정, LRU 보호).
2. **순수 로직 TS 변환**: `markdown.ts`(marked 렌더러 훅 타입), `search.ts`(Custom Highlight 이름 `md-search-match/active`로 접두, `CSS.highlights` 타입 없으면 `declare global`), `highlight.ts`(CDN: cdnjs `highlight.js/11.11.1/highlight.min.js` UMD → `window.hljs`; `hljs.getLanguage(lang)` false면 `languages/{lang}.min.js` 추가 로드, 실패 시 plain 유지·콘솔 출력 0; 기존 `IntersectionObserver` 흐름 유지 — `markdown.js:57-74` 렌더러는 항상 escape+`data-lang`만 출력하므로 결합 지점 변경 없음), `render-extras.ts`(mermaid/katex `import(/* @vite-ignore */ CDN)` 유지 — `inlineDynamicImports`와 충돌 없음; `rerenderMermaid`는 `shell.theme` 구독).
3. **`mdState.svelte.ts`**: `app`→`mdState` 개명. `theme`·`toasts` 제거. `MdDocRecord/MdTypography/MdSearchOptions` 타입. `typography`는 `load/save('md.typography')`.
4. **leaf 컴포넌트 TS 변환 + 인라인 SVG**: Sidebar/TocPanel/Minimap/SearchBar/CommandPalette(Ctrl+K, md 소유). md `Toast.svelte` 삭제 → `toasts.push`.
5. **Reader/Editor**: `:global(#reader-content h1)`류를 `.md-mode :global(…)`로 앵커링, ID `md-reader-content`로 개명, `#progress-bar` `fixed→absolute`(셸 탭바 위로 겹치지 않게). hljs 토큰 CSS: `.hljs-comment→--text-faint`, `.hljs-string→--c-filter`, `.hljs-number→--c-num`, `.hljs-keyword/built_in→--accent`, `.hljs-attr→--c-date`, `.hljs-title→--text`. 리더 타이포 변수(`--reader-width/--reader-font`)는 `.md-mode` 스코프에서만 정의. 코드블록 언어가 `csv/tsv/json`이면 "CSV로 열기"/"jq로 열기" 버튼 추가(`sendTo`).
6. **Toolbar**: 테마 버튼 제거, 파일 열기/제목 인라인 편집/편집모드/내보내기/검색·TOC 토글/타이포 팝오버 유지.
7. **`MdMode.svelte` 조립**: 드롭존·라이트박스·진행률 바 포함. `handleKeydown`의 `inInput` 판정을 xsv `inEditable`(`App.svelte:1373-1378`, `isContentEditable` 포함)로 교체. `isDirty`는 `mdState.dirty`(자동 저장 창 800ms 동안만 true — CSV와 달리 영속 dirty 개념 없음, 탭에 저장 배지 없어도 정상). `beforeunload` 가드는 셸이 `status[*].isDirty`로 통합 등록.

### P8. 도구 간 연결
- `sendTo` 구현(덮어쓰기 confirm → `receive` → 모드 전환).
- CSV→jq: `buildMatrix(ds, view, sel, {scope, includeHeader:true})`(`export.ts:18`) → 객체 배열 JSON → `{kind:'text'}`. CSV 툴바 도구 메뉴 + 컨텍스트 메뉴에 "jq로 보내기(전체/보이는 부분/선택)".
- jq→CSV: `{kind:'table', header, rows}` → CsvMode `receive`가 `finalize`→`loadText` 동등 경로(`applyParsed`)로 적용(텍스트 직렬화 금지).
- MD→CSV/jq: 코드블록 텍스트를 `{kind:'text'}`로.
- 신규 e2e 그룹 **'도구 간 연결'**(문서 있을 때 confirm 포함) + **'모드 단축키 격리'**(jq 활성 시 `/`가 CSV 필터로 새지 않음).

### P9. e2e 외부 요청 감시 완화
`tests/e2e.mjs:52-62`를 `ALLOWED_CDNS = {sheetjs, jq(jsdelivr jq-web), mermaid, katex, hljs(cdnjs)}` + `cdnHits` 맵으로. 판정부: 218(허용 목록 밖 0건 — 의미 그대로), 219·854-856(`cdnTotal()===0`), 874-886·1925-1928(`cdnHits.sheetjs.length===1`). 파일 상단 주석 갱신. 콘솔 에러 0 규칙(`63-66,221,1930`)은 유지.

### P10. 문서
README: "런타임 의존성 0개"(234-247)→"CSV 경로 외부 요청 0건, 번들 의존성 marked·dompurify", 구조 트리(142), 크기(133), 네트워크 정책(7-9,105,210), 3모드·연결·단축키·오프라인 시 코드 하이라이트/jq/Mermaid 불가 명시. jq `docs/*.md` 중 유효한 것(autocomplete-analysis 2편)은 `docs/jq/`로 복사.

---

## 회귀 위험 지점 (구현 중 반드시 확인)

| # | 위험 | 방어 |
|---|---|---|
| 1 | 비활성 모드가 캡처 단계 키를 가로챔(`/`,`?`,Ctrl+F) | 모드 리스너 제거, 셸이 활성 모드에만 `handleKeydown` 위임. 다이얼로그 열림 시 위임 중단 |
| 2 | 그리드 스크롤·크기 소실 | `visibility`+`inert` 스택, `remeasure()` 보험 |
| 3 | e2e 전역 셀렉터 중복 매치 | `mounted` 래치(활성화 전 미마운트) |
| 4 | 콘솔 에러 0 규칙 위반(jq-web Emscripten, 이식 코드 `console.*`) | 전수 제거 + `Module.print/printErr` 주입. 잔존 시 사용자 결정 |
| 5 | `currentDoc=null` 불변식 우회 | `openText/receive`는 `loadText` 경로 강제 |
| 6 | 모드 간 `Dataset/View/Selection/Find` 인스턴스 공유 | 모드별 `new`, 코드 리뷰 체크 |
| 7 | `xsv.regexMode`/`findRegex` 키 공유로 Alt+R 전이 | 모드 접두 키 |
| 8 | jq 워커 청크가 `dist/assets/`로 빠져 `file://`에서 깨짐 | `?worker&inline`, 빌드 후 `ls dist` 1파일 확인 |
| 9 | jq 자동완성 컨텍스트 추론 사망(`instance` null throw) | `jq-engine.ts:257` 가드 완화 |
| 10 | md `:global` 스타일·`position:fixed` 진행바가 다른 모드로 누출 | `.md-mode` 앵커링, `absolute` |
| 11 | md Mermaid·hljs가 테마 전환에 미반응 | `shell.theme` 구독 |
| 12 | 번들 비대화로 e2e 부팅 10초 타임아웃(`e2e.mjs:213`) | 단계마다 dist 크기 기록(목표 500KB 이내) |
| 13 | `svelte.config.js` `runes:true` 전역 강제 | md 컴포넌트에 `export let`/`$:` 잔존 여부 전수 확인 |

---

## 검증

1. **매 단계**: `npm run verify` (svelte-check → vitest → build → puppeteer e2e(file://) → edge). P2·P6은 e2e/edge **무수정** 통과가 합격 조건.
2. **빌드 산출물**: `ls dist` → `index.html` 1개. `rg -c scanDocument dist/index.html > 0`(워커 인라인). 크기 기록.
3. **jq 단위 테스트** 4파일 green, `autocomplete/word.ts`·`md/lib/db.ts` 신규 단위 테스트.
4. **신규 e2e 4그룹**: 모드 전환(상태·scrollTop 보존) / 파일 종류 자동 전환 / 도구 간 연결(confirm 포함) / 모드 단축키 격리. 외부 요청은 허용 CDN 목록 밖 0건, 부팅 시 CDN 0건, CSV 경로 SheetJS 정확히 1건.
5. **수동 QA 체크리스트**: jq 자동완성 12항목·Transform 8항목(P7-jq §6·§7), md 기능 목록(P7-md), 오프라인(네트워크 차단)에서 CSV 전 기능 + md 기본 렌더 동작·코드 하이라이트/jq/Mermaid는 안내 후 우아한 저하, 라이트/다크 양쪽에서 잔여 하드코딩 색 0건.
6. **디자인 회귀**: `npm run e2e:shots`로 CSV 모드 스크린샷을 P0 기준선과 비교.
