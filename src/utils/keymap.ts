/**
 * 중앙 Keymap 레지스트리
 * 모든 글로벌 단축키를 단일 진입점으로 관리.
 * 사용법:
 *   import { registerKeymap, initKeymap } from './utils/keymap';
 *   registerKeymap({ id: 'my-action', keys: 'Ctrl+K', label: '팔레트 열기', handler: fn });
 *   initKeymap(); // App.ts init에서 한 번만 호출
 */

export interface KeymapEntry {
  id: string;
  /** 'Ctrl+K', 'Ctrl+1', 'F6', '?' 등 */
  keys: string;
  label: string;
  description?: string;
  scope?: 'global' | 'panel';
  /** 진입 조건: true를 반환할 때만 실행 */
  when?: () => boolean;
  handler: (e: KeyboardEvent) => void;
}

const registry: KeymapEntry[] = [];

export function registerKeymap(entry: KeymapEntry) {
  // 중복 등록 방지
  const idx = registry.findIndex(e => e.id === entry.id);
  if (idx >= 0) {
    registry[idx] = entry;
  } else {
    registry.push(entry);
  }
}

export function getRegistry(): Readonly<KeymapEntry[]> {
  return registry;
}

/** 키 이벤트가 등록된 단축키와 일치하는지 검사 */
function matchesKey(e: KeyboardEvent, keys: string): boolean {
  const parts = keys.split('+');
  const key = parts[parts.length - 1];

  const needsCtrl  = parts.includes('Ctrl')  || parts.includes('Meta');
  const needsShift = parts.includes('Shift');
  const needsAlt   = parts.includes('Alt');

  // Ctrl 또는 Cmd(Meta) 중 하나라도 있으면 매칭
  if (needsCtrl  && !(e.ctrlKey || e.metaKey)) return false;
  if (needsShift && !e.shiftKey) return false;
  if (needsAlt   && !e.altKey)   return false;

  // Ctrl/Meta가 필요하지 않은데 눌려있으면 매칭 안 함 (? 단독키 보호 등)
  if (!needsCtrl && (e.ctrlKey || e.metaKey)) return false;

  return e.key === key || e.code === `Key${key.toUpperCase()}`;
}

/** textarea/input 포커스 여부 */
function isEditing(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
}

/**
 * window에 단일 keydown 리스너를 달고 등록된 keymap을 디스패치한다.
 * App.ts init()에서 한 번만 호출.
 */
export function initKeymap() {
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    for (const entry of registry) {
      if (!matchesKey(e, entry.keys)) continue;

      // 편집 중에는 '?' 같은 단독 문자 키 단축키 무시
      if (isEditing() && !e.ctrlKey && !e.metaKey && !e.altKey && !e.key.startsWith('F')) {
        continue;
      }

      // 조건 체크
      if (entry.when && !entry.when()) continue;

      e.preventDefault();
      entry.handler(e);
      break; // 첫 번째 매칭만 실행
    }
  }, { capture: true });
}
