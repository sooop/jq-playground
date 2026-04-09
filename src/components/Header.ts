import { Storage } from '../utils/storage';
import { createToolbar } from './Toolbar';
import { SunIcon, MoonIcon, MonitorIcon } from '../icons';

export function createHeader(
  onLoadSample: () => void,
  onToggleCheatsheet: () => void,
  onShowHelp: () => void,
  onToggleSnippets: () => void,
  onOpenCommandPalette?: () => void,
) {
  const header = document.createElement('header');
  header.className = 'header';

  // ── 테마 토글 버튼 (헤더 우측 끝) ──
  const themeBtn = document.createElement('button');
  themeBtn.className = 'toolbar-icon-btn theme-toggle';
  themeBtn.setAttribute('aria-label', '테마 전환');

  const systemDarkMode = window.matchMedia('(prefers-color-scheme: dark)');

  function applyTheme(theme: string) {
    const isDark = theme === 'dark' || (theme === 'system' && systemDarkMode.matches);
    document.documentElement.classList.toggle('dark', isDark);

    if (theme === 'system') {
      themeBtn.innerHTML = MonitorIcon;
      themeBtn.title = '테마: 시스템';
    } else if (theme === 'dark') {
      themeBtn.innerHTML = MoonIcon;
      themeBtn.title = '테마: 다크';
    } else {
      themeBtn.innerHTML = SunIcon;
      themeBtn.title = '테마: 라이트';
    }
  }

  const savedTheme = Storage.getTheme();
  applyTheme(savedTheme);

  systemDarkMode.addEventListener('change', () => {
    if (Storage.getTheme() === 'system') {
      applyTheme('system');
    }
  });

  themeBtn.addEventListener('click', () => {
    const cur = Storage.getTheme();
    const next = cur === 'light' ? 'dark' : cur === 'dark' ? 'system' : 'light';
    Storage.saveTheme(next);
    applyTheme(next);
  });

  // ── Toolbar ──
  const toolbar = createToolbar({
    onLoadSample,
    onToggleSnippets,
    onToggleCheatsheet,
    onShowHelp,
    onOpenManual: () => window.open('https://jqlang.github.io/jq/manual/', '_blank'),
    onOpenCommandPalette: onOpenCommandPalette ?? (() => {}),
  });

  // 테마 버튼을 toolbar 우측 actions에 삽입
  const toolbarActions = toolbar.querySelector('.toolbar-actions') as HTMLElement;
  toolbarActions.insertBefore(themeBtn, toolbarActions.firstChild);

  header.appendChild(toolbar);
  return header;
}
