# jq-playground 기술 스펙

## 프로젝트 개요

브라우저에서 실행되는 jq 쿼리 플레이그라운드 애플리케이션. WebAssembly 기반 jq 엔진을 사용하여 서버 없이 클라이언트에서 JSON 데이터를 처리할 수 있다.

## 기술 스택

### 프론트엔드
| 항목 | 기술 | 버전 |
|------|------|------|
| 언어 | Vanilla JavaScript (ES6+ Modules) | - |
| 스타일링 | Vanilla CSS (모듈화) | - |
| jq 엔진 | jq-web (WebAssembly) | 0.6.2 |

### 빌드 도구
| 항목 | 기술 | 버전 |
|------|------|------|
| 번들러 | Vite | 7.3.1 |
| 단일 파일 빌드 | vite-plugin-singlefile | 2.3.0 |

### 런타임 환경
- 브라우저 (WebAssembly 지원 필수)
- 서버 불필요 (정적 파일 호스팅만으로 배포 가능)

## 프로젝트 구조

```
jq-playground/
├── index.html              # HTML 진입점
├── package.json            # 프로젝트 메타데이터 및 의존성
├── vite.config.js          # Vite 빌드 설정
├── dist/                   # 빌드 출력 디렉토리
│   └── index.html          # 단일 파일 빌드 결과물
└── src/
    ├── main.js             # 애플리케이션 진입점
    ├── App.js              # 메인 애플리케이션 클래스
    ├── components/         # UI 컴포넌트
    │   ├── Header.js       # 헤더 (샘플 로드, 치트시트 토글 등)
    │   ├── InputPanel.js   # JSON 입력 패널
    │   ├── QueryPanel.js   # jq 쿼리 입력 패널
    │   ├── OutputPanel.js  # 결과 출력 패널
    │   ├── Modal.js        # 모달 다이얼로그 (쿼리 저장, 도움말)
    │   └── Cheatsheet.js   # jq 함수 참조 치트시트
    ├── core/               # 핵심 로직
    │   ├── jq-engine.js    # jq WebAssembly 엔진 래퍼
    │   ├── jq-functions.js # jq 내장 함수 목록 및 메타데이터
    │   ├── csv-converter.js # JSON → CSV/HTML 테이블 변환
    │   └── file-handler.js # 파일 읽기/다운로드 유틸리티
    ├── utils/
    │   └── storage.js      # localStorage 래퍼
    └── styles/
        ├── main.css        # 스타일 진입점
        ├── layout.css      # 레이아웃 스타일
        └── components.css  # 컴포넌트 스타일
```

## 핵심 모듈 설명

### jq-engine.js
- jq-web 라이브러리 초기화 및 래핑
- WebAssembly 기반 jq 인스턴스 관리
- Web Worker를 통한 비동기 처리 지원
- 빈 결과 처리 등 예외 상황 핸들링

### QueryPanel.js
- jq 쿼리 입력 및 편집
- **자동완성**: jq 함수명 입력 시 자동완성 제안 (fuzzy matching)
- **쿼리 히스토리**: 실행된 쿼리 자동 저장 (최대 100개)
- **저장된 쿼리**: 즐겨찾기 쿼리 관리 (Import/Export 지원)
- 키보드 단축키 지원 (Ctrl+Enter 실행, Tab 들여쓰기)

### csv-converter.js
- JSON 데이터를 HTML 테이블 또는 CSV로 변환
- 중첩 객체 자동 평탄화 (최대 깊이 10)
- 대용량 데이터 처리 (테이블 1000행 제한, 전체 데이터 다운로드 지원)
- XSS 방지를 위한 HTML 이스케이프

### storage.js
- localStorage 기반 영속 저장소
- 쿼리 히스토리 및 저장된 쿼리 관리

## 주요 기능

### 1. JSON 입력
- 텍스트 직접 입력
- 파일 드래그 앤 드롭 (최대 50MB)
- 샘플 데이터 로드

### 2. jq 쿼리 실행
- 실시간 자동 실행 (debounce 500ms)
- 수동 실행 모드 지원 (Auto-play 토글)
- 키보드 단축키: `Ctrl+Enter` (실행), `Ctrl+Shift+E` (Auto-play 토글)

### 3. 자동완성
- jq 내장 함수 201개 등록
- 입력 타입별 분류 (any, array, object, string, number, item)
- 색상 코드로 입력 타입 구분

### 4. 출력 형식
| 형식 | 설명 |
|------|------|
| JSON | 포맷팅된 JSON 출력 |
| Table | HTML 테이블 (중첩 객체 평탄화) |
| Raw | 원시 텍스트 출력 |

### 5. 데이터 내보내기
- JSON 다운로드
- CSV 다운로드 (테이블 형식)
- 저장된 쿼리 Export/Import (JSON)
- 히스토리 Export/Import (JSON)

### 6. UI/UX
- 반응형 패널 리사이즈 (드래그)
- 접이식 치트시트 사이드바
- 다크/라이트 테마 대응 (시스템 설정 따름)

## 빌드 설정

### Vite 설정 (vite.config.js)
```javascript
export default defineConfig({
  plugins: [viteSingleFile()],  // 단일 HTML 파일로 빌드
  base: './',                   // 상대 경로 사용
  build: {
    outDir: 'dist',
    cssCodeSplit: false,        // CSS 인라인화
    rollupOptions: {
      output: {
        inlineDynamicImports: true  // JS 인라인화
      }
    }
  }
});
```

### 빌드 명령어
```bash
npm run dev      # 개발 서버 (포트 3000)
npm run build    # 프로덕션 빌드
npm run preview  # 빌드 결과물 미리보기
```

## 외부 의존성

### CDN
- **jq-web**: `https://cdn.jsdelivr.net/npm/jq-web@0.6.2/jq.js`

### npm (devDependencies)
- vite: ^7.3.1
- vite-plugin-singlefile: ^2.3.0

## 브라우저 호환성

| 기능 | 요구 사항 |
|------|-----------|
| WebAssembly | Chrome 57+, Firefox 52+, Safari 11+, Edge 16+ |
| ES6 Modules | Chrome 61+, Firefox 60+, Safari 11+, Edge 79+ |
| CSS Grid | Chrome 57+, Firefox 52+, Safari 10.1+, Edge 16+ |

## 제한 사항

- 파일 업로드 최대 크기: 50MB
- 테이블 표시 최대 행 수: 1,000행
- 쿼리 히스토리 최대 개수: 100개
- 중첩 객체 평탄화 최대 깊이: 10단계

## 보안 고려사항

- XSS 방지: 모든 사용자 입력 HTML 이스케이프 처리
- 파일 크기 검증: 업로드 전 파일 크기 확인
- 외부 의존성 최소화: 런타임 의존성은 jq-web만 사용
- 로컬 실행: 모든 데이터 처리가 클라이언트에서 수행됨 (서버 전송 없음)
