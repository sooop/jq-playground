export interface PopoverHandle {
  el: HTMLElement;
  close: () => void;
  reposition: () => void;
}

/**
 * anchor 근처에 fixed 포지션 팝오버를 연다. 바깥 클릭/Escape로 닫힌다.
 * 내용은 호출부가 `el`에 채운 뒤 `reposition()`을 호출해 최종 크기 기준으로 배치해야 한다.
 */
export function openPopover(anchor: HTMLElement, className: string): PopoverHandle {
  const el = document.createElement('div');
  el.className = className;
  document.body.appendChild(el);

  function reposition() {
    const rect = anchor.getBoundingClientRect();
    const top = Math.min(rect.bottom + 4, window.innerHeight - el.offsetHeight - 8);
    const left = Math.min(rect.left, window.innerWidth - el.offsetWidth - 8);
    el.style.position = 'fixed';
    el.style.top = Math.max(4, top) + 'px';
    el.style.left = Math.max(4, left) + 'px';
    el.style.zIndex = '3000';
  }

  function close() {
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    el.remove();
  }
  function onOutside(e: MouseEvent) {
    if (!el.contains(e.target as Node) && e.target !== anchor && !anchor.contains(e.target as Node)) {
      close();
    }
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  }

  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKey, true);

  return { el, close, reposition };
}
