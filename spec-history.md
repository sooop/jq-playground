# History Feature Specification

## Overview
Input/Query 영구 저장 및 복원 기능을 IndexedDB 기반으로 구현. localStorage에서 IndexedDB로 마이그레이션하여 대용량 데이터 관리 및 개별 삭제 지원.

## 1. Input History

### 목적
사용자가 입력한 JSON 데이터를 자동으로 저장하고 나중에 다시 불러올 수 있도록 지원. 파일명, 크기, 마지막 사용 시간 등 메타데이터를 함께 관리.

### 기능
- **자동 저장**: 입력 변경 시 2초 debounce 후 IndexedDB에 저장
- **파일명 트래킹**: 파일 업로드 시 파일명 자동 기록
- **History 목록**: 드롭다운에서 최근 50개 항목 표시 (최근 사용 순)
- **검색**: 파일명 또는 내용으로 필터링
- **개별/전체 삭제**: 각 항목 삭제 또는 전체 히스토리 초기화
- **LRU 관리**: 최대 300개 유지, 초과 시 오래된 항목 자동 삭제
- **세션 복원**: 앱 시작 시 마지막 입력 자동 복원

### UI
- Input 패널 헤더에 "History" 버튼 추가 (src/components/InputPanel.js:62)
- 드롭다운 리스트 표시: 파일명, 크기(KB), 내용 미리보기, 날짜
- 검색 입력창 및 "Clear All" 버튼

### 데이터 구조
```javascript
{
  id: auto-increment,
  content: string,
  fileName: string | null,
  size: number (bytes),
  timestamp: ISO string,
  lastUsed: ISO string
}
```

## 2. Query History 개선

### 추가 기능
- **개별 삭제**: 각 히스토리 항목에 × 버튼 추가
- **전체 삭제**: "Clear All" 버튼으로 전체 히스토리 초기화
- **ID 관리**: IndexedDB의 auto-increment ID로 정확한 삭제 지원

### 변경사항
- localStorage 배열 방식에서 IndexedDB 레코드로 전환
- 최대 100개 유지 (LIMITS.QUERY_HISTORY)
- 타임스탬프 기반 오래된 항목 자동 삭제

### UI
- 각 히스토리 항목에 삭제 버튼 표시 (src/components/QueryPanel.js:452-456)
- History 드롭다운 헤더에 "Clear All" 버튼 추가

## 3. IndexedDB Storage Layer

### 구조
**새 파일**: `src/utils/indexeddb-storage.js`
- 범용 IndexedDB wrapper 클래스
- CRUD 연산, 정렬, 페이지네이션, LRU 지원

**DB 설정** (src/utils/storage.js:880-904):
```javascript
{
  name: 'jq-playground',
  version: 1,
  stores: {
    'input-history': { keyPath: 'id', autoIncrement: true },
    'query-history': { keyPath: 'id', autoIncrement: true },
    'saved-queries': { keyPath: 'id' },
    'settings': { keyPath: 'key' }
  }
}
```

### 마이그레이션
- localStorage에서 IndexedDB로 일회성 자동 마이그레이션 (src/utils/storage.js:948-981)
- `jq-migration-done` 플래그로 중복 방지
- 실패 시 localStorage fallback

### Fallback 처리
- IndexedDB 미지원 브라우저는 localStorage 사용
- `Storage.useIndexedDB` 플래그로 분기 처리
- 기존 localStorage 메서드 유지 (legacy methods)

## 4. 초기화 동작 변경

### Before
```javascript
// 앱 로드 시 샘플 데이터 자동 입력 및 실행
this.executeQuery();
```

### After
```javascript
// 마지막 입력 복원 (src/App.js:133-141)
const lastInput = await Storage.getLastInput();
if (lastInput && lastInput.content) {
  this.inputPanel.querySelector('#input').value = lastInput.content;
}
// 초기 실행 없음 - 빈 상태로 시작
```

### 샘플 데이터 제거
- Input/Query textarea의 기본값 제거
- Placeholder만 표시

## 5. 스타일 추가

**새 스타일** (src/styles/components.css:479-625):
- `.input-history-item`: 입력 히스토리 항목 레이아웃
- `.delete-history-item`, `.delete-input-history`: 삭제 버튼
- `.clear-all-btn`: 전체 삭제 버튼 (빨간색)
- `.history-query`: 쿼리 텍스트 flex 레이아웃

## Technical Notes

### Debouncing
- Input 저장: 2초 (src/utils/storage.js:1013)
- Query 저장: 0.5초 (src/utils/storage.js:1217)

### LRU 구현
- `getOldest()` 메서드로 가장 오래된 항목 조회
- `_enforceLimitInputHistory()`, `_enforceLimitQueryHistory()`에서 자동 정리

### 에러 처리
- 모든 IndexedDB 작업은 try-catch로 감싸 console.warn/error 출력
- 초기화 실패 시 자동으로 localStorage로 fallback
