# jq-playground 향후 개선 제안

이 문서는 현재 구현에서 제외된 개선 제안들을 정리한 것입니다.
추후 기능 추가 시 참고 자료로 활용하세요.

---

## UI/UX 개선

### 쿼리 에디터 문법 하이라이팅
**우선순위**: 중

현재 QueryPanel은 일반 `<textarea>`를 사용합니다. CodeMirror나 Monaco Editor를 도입하면:
- jq 문법 하이라이팅
- 괄호/중괄호 매칭
- 자동 들여쓰기
- 줄 번호 표시
- 다중 커서 편집

**구현 고려사항**:
- 번들 크기 증가 (CodeMirror ~100KB, Monaco ~2MB)
- jq 언어 모드가 기본 제공되지 않아 커스텀 정의 필요
- 기존 자동완성 시스템과의 통합 필요

---

### 패널 크기 저장
**우선순위**: 낮음

현재 패널 리사이즈 위치가 새로고침 시 초기화됩니다.

**구현 방법**:
```javascript
// Storage에 추가
static getPanelSizes() {
  return JSON.parse(localStorage.getItem('jq-panel-sizes') || '{}');
}

static setPanelSizes(sizes) {
  localStorage.setItem('jq-panel-sizes', JSON.stringify(sizes));
}

// App.js 리사이저 핸들러에서
Storage.setPanelSizes({
  horizontal: horizontalRatio,
  vertical: verticalRatio
});
```

---

### 실행 취소/다시 실행 (Undo/Redo)
**우선순위**: 중

입력과 쿼리에 대한 실행 취소 기능.

**구현 방법**:
1. 히스토리 스택 관리 (최대 50개 상태)
2. `Ctrl+Z` / `Ctrl+Shift+Z` 단축키
3. 각 입력 변경마다 상태 저장 (debounce 적용)

**주의사항**:
- 메모리 사용량 관리 필요
- textarea의 기본 undo와 충돌 가능성

---

### 쿼리 템플릿/스니펫
**우선순위**: 낮음

자주 사용하는 jq 패턴을 템플릿으로 제공.

**예시 템플릿**:
```javascript
const TEMPLATES = [
  { name: 'Filter by key', template: '.[] | select(.${1:key} == "${2:value}")' },
  { name: 'Group by', template: 'group_by(.${1:key}) | map({key: .[0].${1:key}, items: .})' },
  { name: 'Unique values', template: '[.[] | .${1:key}] | unique' },
];
```

**구현 요소**:
- 템플릿 선택 UI (드롭다운 또는 모달)
- 플레이스홀더 (`${1:key}`) 탭 이동 지원
- 사용자 정의 템플릿 저장

---

### 비교 뷰 (Diff View)
**우선순위**: 낮음

이전 결과와 현재 결과를 나란히 비교.

**구현 방법**:
1. 결과 히스토리 유지 (최근 2개)
2. 토글 버튼으로 비교 뷰 활성화
3. diff 라이브러리 사용 (jsdiff 등)

---

## 접근성 (Accessibility)

### ARIA 레이블 추가
**우선순위**: 중

현재 구현에서 누락된 접근성 속성들:

```html
<!-- 버튼에 aria-label 추가 -->
<button aria-label="Format JSON" title="Format JSON (Ctrl+Shift+F)">Format</button>

<!-- 자동완성에 role 추가 -->
<ul role="listbox" aria-label="Autocomplete suggestions">
  <li role="option" aria-selected="true">select</li>
</ul>

<!-- 패널에 landmark 추가 -->
<section role="region" aria-label="JSON Input">
```

---

### 키보드 포커스 인디케이터
**우선순위**: 중

포커스 상태의 시각적 표시 강화:

```css
:focus-visible {
  outline: 2px solid var(--accent-color);
  outline-offset: 2px;
}

button:focus-visible {
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.3);
}
```

---

### 모달 포커스 트랩
**우선순위**: 중

모달 열림 시 포커스가 모달 내에 유지되어야 합니다.

```javascript
function trapFocus(modal) {
  const focusableElements = modal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const firstEl = focusableElements[0];
  const lastEl = focusableElements[focusableElements.length - 1];

  modal.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;

    if (e.shiftKey && document.activeElement === firstEl) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  });
}
```

---

## 모바일/반응형

### 터치 친화적 리사이저
**우선순위**: 중

현재 4px 너비의 리사이저는 터치 기기에서 조작이 어렵습니다.

**개선안**:
```css
.resizer {
  width: 4px;
  /* 터치 영역 확장 */
  position: relative;
}

.resizer::before {
  content: '';
  position: absolute;
  top: 0;
  left: -10px;
  right: -10px;
  bottom: 0;
  /* 실제 터치 영역: 24px */
}

@media (pointer: coarse) {
  .resizer {
    width: 8px;
    background: var(--border-color);
  }
}
```

---

### 세분화된 브레이크포인트
**우선순위**: 낮음

현재 768px 단일 브레이크포인트만 존재합니다.

**제안 브레이크포인트**:
- `480px`: 모바일 세로
- `768px`: 태블릿 세로 / 모바일 가로
- `1024px`: 태블릿 가로 / 작은 데스크톱
- `1280px`: 일반 데스크톱

---

## 기타

### alert() 대신 모달 사용
**우선순위**: 낮음

브라우저 기본 `alert()`를 커스텀 모달로 교체하여 일관된 UI 제공.

현재 alert 사용 위치:
- `QueryPanel.js`: 저장 시 유효성 검사 실패
- `file-handler.js`: 파일 크기/형식 오류

---

### 삭제 전 확인 대화상자
**우선순위**: 낮음

입력/쿼리 Clear 버튼 클릭 시 확인 요청:

```javascript
clearBtn.addEventListener('click', () => {
  if (textarea.value.trim() && !confirm('Clear all content?')) {
    return;
  }
  textarea.value = '';
});
```

또는 커스텀 확인 모달 사용.

---

### 드래그 앤 드롭 시각적 피드백 강화
**우선순위**: 낮음

현재 텍스트 오버레이만 표시됩니다.

**개선안**:
```css
.drop-overlay {
  background: rgba(37, 99, 235, 0.1);
  border: 3px dashed var(--accent-color);
  display: flex;
  align-items: center;
  justify-content: center;
}

.drop-overlay::before {
  content: '📄';
  font-size: 48px;
  margin-bottom: 16px;
}
```

---

## 우선순위 요약

| 우선순위 | 항목 |
|----------|------|
| **중** | 문법 하이라이팅, Undo/Redo, ARIA 레이블, 포커스 인디케이터, 포커스 트랩, 터치 리사이저 |
| **낮음** | 패널 크기 저장, 템플릿/스니펫, Diff View, 브레이크포인트, alert 교체, 삭제 확인, 드롭 피드백 |

---

*마지막 업데이트: 2026-01-22*
