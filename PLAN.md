# PLAN: jq 쿼리 실행을 Web Worker로 오프로딩

## 배경 및 목적

현재 `jq-engine.js`의 `execute()`는 jq-web WebAssembly를 **메인 스레드에서 직접 실행**한다.
대용량 JSON 데이터 처리 시 UI가 동결(Long Task)되는 문제가 있다.

기존 코드에 남긴 주석:
> "Load jq in main thread (Worker has WASM path issues)"

이 문제는 Emscripten이 blob: URL 컨텍스트에서 `.wasm` 파일의 상대 경로를 찾지 못하기 때문이다.

**해결 방법**: `importScripts()` 호출 _전에_ Emscripten의 `Module.locateFile` 훅을 설정하면 `.wasm` 파일을 CDN 절대 URL로 요청하도록 우회할 수 있다.

이미 `jq-functions.js`에 Blob URL 방식의 인라인 워커(`createKeyExtractionWorker`)가 존재하며, 이 패턴은 `file://` 프로토콜과 단일 HTML 빌드 모두에서 정상 작동함이 확인되었다. 동일 패턴으로 jq 실행 전용 워커를 추가한다.

---

## 수정 파일 목록

| 파일 | 변경 유형 | 상세 |
|---|---|---|
| `src/core/jq-functions.js` | 상수 + 함수 2개 추가 | `JQ_WORKER_CODE`, `createJqWorker()`, `terminateJqWorker()` |
| `src/core/jq-engine.js` | 전체 재작성 (public 시그니처 유지) | 워커 기반 execute, 폴백, 요청 추적 |
| `src/App.js` | 1줄 추가 | `beforeunload`에서 `jqEngine.terminate()` 호출 |

---

## 1. `src/core/jq-functions.js` 추가 내용

기존 `terminateKeyExtractionWorker` 함수 뒤에 추가.

```javascript
const JQ_CDN_BASE = 'https://cdn.jsdelivr.net/npm/jq-web@0.6.2/';
const JQ_CDN_JS = JQ_CDN_BASE + 'jq.js';

const JQ_WORKER_CODE = `
  // importScripts() 전에 Module.locateFile 설정 — blob: origin에서 WASM 경로 해결
  self.Module = {
    locateFile: function(filename) {
      return '${JQ_CDN_BASE}' + filename;
    }
  };

  importScripts('${JQ_CDN_JS}');

  let jqInstance = null;
  let initError = null;

  // 워커 시작 시 즉시 초기화 (첫 쿼리 지연 방지)
  const initPromise = (function() {
    try {
      const jqRef = (typeof self.jq !== 'undefined') ? self.jq : null;
      if (!jqRef) throw new Error('jq not available after importScripts');
      const p = jqRef.promised ? jqRef.promised : jqRef;
      return Promise.resolve(p).then(function(inst) {
        jqInstance = inst;
        self.postMessage({ type: 'ready' });
      }).catch(function(err) {
        initError = err;
        self.postMessage({ type: 'init_error', message: err.message });
      });
    } catch(err) {
      initError = err;
      self.postMessage({ type: 'init_error', message: err.message });
      return Promise.reject(err);
    }
  })();

  self.onmessage = function(e) {
    var msg = e.data;
    if (msg.type !== 'execute') return;
    var id = msg.id, input = msg.input, query = msg.query;

    initPromise.then(function() {
      if (initError || !jqInstance) {
        self.postMessage({ type: 'error', id: id,
          message: 'Worker init failed: ' + (initError ? initError.message : 'no instance') });
        return;
      }
      var startTime = performance.now();
      try {
        var parsed = JSON.parse(input);
        Promise.resolve(jqInstance.json(parsed, query)).then(function(result) {
          self.postMessage({ type: 'result', id: id, result: result,
            executionTime: performance.now() - startTime });
        }).catch(function(err) {
          var t = performance.now() - startTime;
          if (err.message && err.message.includes('Unexpected end of JSON input')) {
            self.postMessage({ type: 'result', id: id, result: [], executionTime: t });
          } else {
            self.postMessage({ type: 'error', id: id, message: err.message });
          }
        });
      } catch(err) {
        var t2 = performance.now() - startTime;
        if (err.message && err.message.includes('Unexpected end of JSON input')) {
          self.postMessage({ type: 'result', id: id, result: [], executionTime: t2 });
        } else {
          self.postMessage({ type: 'error', id: id, message: err.message });
        }
      }
    }).catch(function(err) {
      self.postMessage({ type: 'error', id: id,
        message: 'Worker initialization error: ' + err.message });
    });
  };
`;

/**
 * jq 쿼리 실행용 인라인 Web Worker 생성.
 * Blob URL 방식으로 file:// 프로토콜 및 단일 파일 빌드와 호환.
 * @returns {Worker}
 */
export function createJqWorker() {
  const blob = new Blob([JQ_WORKER_CODE], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  worker._blobUrl = url;
  return worker;
}

/**
 * jq 워커를 종료하고 blob URL을 해제한다.
 * @param {Worker} worker
 */
export function terminateJqWorker(worker) {
  if (worker) {
    worker.terminate();
    if (worker._blobUrl) URL.revokeObjectURL(worker._blobUrl);
  }
}
```

> **템플릿 리터럴 주의**: `JQ_WORKER_CODE` 문자열 정의 시 `${JQ_CDN_BASE}`, `${JQ_CDN_JS}`는 JS가 보간하여 CDN URL 문자열로 치환된다. 워커 코드 내부에는 별도의 `${}` 표현식이 없으므로 이중 보간 문제 없음.

---

## 2. `src/core/jq-engine.js` 전체 재작성

public API(`execute`, `executeForContext`, `executeForContextWithTimeout`)의 시그니처는 변경하지 않는다.

### 변경 요약

| 항목 | 변경 내용 |
|---|---|
| import 추가 | `createJqWorker`, `terminateJqWorker` from `./jq-functions.js` |
| constructor | `worker`, `workerReady`, `workerFailed`, `pendingRequests`, `requestIdCounter`, `messageQueue` 필드 추가 |
| `init()` | 기존 메인 스레드 초기화 후 `_initWorker()` 호출 |
| `_initWorker()` | 워커 생성, onmessage/onerror 설정 |
| `_handleWorkerMessage()` | `ready`, `init_error`, `result`, `error` 메시지 처리 |
| `execute()` | 워커 사용 가능 시 `_executeInWorker()`, 아니면 `_executeMainThread()` |
| `_executeInWorker()` | 요청 ID 발급 → pendingRequests 등록 → postMessage (또는 messageQueue 보관) |
| `_executeMainThread()` | 기존 execute() 로직 그대로 이동 |
| `terminate()` | 워커 종료 + 미완료 Promise 전부 reject |
| `executeForContext` 관련 | 변경 없음 (메인 스레드 유지) |

### 새 클래스 구조

```javascript
import { createJqWorker, terminateJqWorker } from './jq-functions.js';

class JqEngine {
  constructor() {
    this.instance = null;            // 메인 스레드 인스턴스 (executeForContext + 폴백)
    this.worker = null;
    this.workerReady = false;
    this.workerFailed = false;
    this.pendingRequests = new Map(); // id → { resolve, reject }
    this.requestIdCounter = 0;
    this.messageQueue = [];           // ready 전 수신 메시지 임시 보관
  }

  async init() {
    // 1) 메인 스레드 인스턴스 초기화 (기존 코드 동일)
    // 2) _initWorker() 호출 (실패해도 예외 전파 안 함)
  }

  _initWorker() {
    // createJqWorker() → onmessage/onerror 설정
    // 실패 시 workerFailed = true
  }

  _handleWorkerMessage(e) {
    // type: 'ready'       → workerReady=true, messageQueue 플러시
    // type: 'init_error'  → workerFailed=true, 대기 중인 Promise 전부 reject
    // type: 'result'      → pending.resolve({ result, executionTime })
    // type: 'error'       → pending.reject(new Error(message))
    // id 없거나 pendingRequests에 없으면 무시 (진부한 응답)
  }

  async execute(input, query) {
    if (this.worker && !this.workerFailed) return this._executeInWorker(input, query);
    return this._executeMainThread(input, query);
  }

  _executeInWorker(input, query) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestIdCounter;
      this.pendingRequests.set(id, { resolve, reject });
      const msg = { type: 'execute', id, input, query };
      this.workerReady ? this.worker.postMessage(msg) : this.messageQueue.push(msg);
    });
  }

  async _executeMainThread(input, query) { /* 기존 execute() 로직 */ }

  terminate() {
    // terminateJqWorker(this.worker)
    // pendingRequests 전부 reject
    // 상태 초기화
  }

  // 기존 메서드 변경 없음:
  async executeForContext(input, partialQuery, maxDepth = 8) { ... }
  _extractKeysDeep(obj, path, depth, maxDepth, keys) { ... }
  async executeForContextWithTimeout(input, partialQuery, timeout = 2000) { ... }
}

export const jqEngine = new JqEngine();
```

---

## 3. `src/App.js` — 1줄 추가

```javascript
// 변경 전
window.addEventListener('beforeunload', () => {
  Storage.flushAll();
  this.queryPanel.api.terminateWorker?.();
});

// 변경 후
window.addEventListener('beforeunload', () => {
  Storage.flushAll();
  this.queryPanel.api.terminateWorker?.();
  jqEngine.terminate();  // ← 추가
});
```

---

## 주요 설계 결정

| 항목 | 결정 및 이유 |
|---|---|
| WASM 경로 해결 | `importScripts()` 전 `self.Module = { locateFile }` 설정 |
| 워커 생성 방식 | Blob URL — 기존 key extraction worker와 동일 패턴, file:// 호환 |
| jq 초기화 시점 | Eager (워커 시작 즉시) — 첫 쿼리 지연 최소화 |
| ready 전 요청 | `messageQueue`에 보관 → ready 수신 시 일괄 플러시 |
| 진부한 결과 | request ID 기반 무시 — 이미 교체된 요청의 응답은 drop |
| 워커 오류 시 | `workerFailed=true` → 이후 모든 요청을 메인 스레드로 폴백 |
| `executeForContext` | 메인 스레드 유지 — 2초 타임아웃 이미 존재, 자동완성 캐시로 호출 빈도 낮음 |
| 단일 HTML 빌드 | Blob URL은 vite-plugin-singlefile과 호환 (이미 검증된 패턴) |

---

## 검증 방법

1. **기능 회귀 확인**: `npm run dev` 실행 → 기존 기능(자동완성, 히스토리, CSV 출력, 치트시트) 정상 작동 확인
2. **워커 확인**: DevTools → Application → Service Workers / Workers 탭에서 jq 워커 인스턴스 확인
3. **성능 확인**: 1MB+ JSON 입력 후 쿼리 실행 → Performance 탭에서 메인 스레드 Long Task 감소 확인
4. **단일 파일 빌드**: `npm run build` → `dist/index.html`을 `file://` URL로 직접 열기 → 동일 테스트
5. **폴백 테스트**: DevTools Network 탭에서 CDN 차단 → 페이지 리로드 → 메인 스레드 폴백으로 작동 확인
