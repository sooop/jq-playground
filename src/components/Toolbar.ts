import {
  FileIcon, FolderOpenIcon, SidebarIcon, BookIcon, PaletteIcon,
  HelpCircleIcon, CodeIcon, SearchIcon, CommandIcon
} from '../icons';

export interface ToolbarCallbacks {
  onLoadSample: () => void;
  onToggleSnippets: () => void;
  onToggleCheatsheet: () => void;
  onShowHelp: () => void;
  onOpenManual: () => void;
  onOpenCommandPalette: () => void;
}

export function createToolbar(callbacks: ToolbarCallbacks): HTMLElement {
  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  toolbar.setAttribute('role', 'menubar');
  toolbar.setAttribute('aria-label', '메인 메뉴');

  // ── 로고 영역 ──
  const logo = document.createElement('div');
  logo.className = 'toolbar-logo';
  logo.innerHTML = `${TerminalSvg}<span class="toolbar-logo-text">jq</span>`;

  // ── 메뉴 항목 ──
  const menuItems = [
    {
      id: 'file-menu',
      label: 'File',
      items: [
        { id: 'load-sample',   label: 'Load Sample',   icon: FileIcon,       shortcut: '' },
        { id: 'import-file',   label: 'Import File',   icon: FolderOpenIcon, shortcut: '' },
      ]
    },
    {
      id: 'view-menu',
      label: 'View',
      items: [
        { id: 'toggle-snippets',   label: 'Snippets',   icon: SidebarIcon, shortcut: '' },
        { id: 'toggle-cheatsheet', label: 'Cheatsheet', icon: CodeIcon,    shortcut: '' },
        { id: 'theme-submenu',     label: 'Theme',      icon: PaletteIcon, shortcut: '' },
      ]
    },
    {
      id: 'help-menu',
      label: 'Help',
      items: [
        { id: 'show-help',    label: 'Quick Help',   icon: HelpCircleIcon, shortcut: '?' },
        { id: 'open-manual',  label: 'jq Manual',    icon: BookIcon,       shortcut: '' },
        { id: 'show-shortcuts', label: 'Shortcuts',  icon: SearchIcon,     shortcut: '?' },
      ]
    },
  ];

  const menuBar = document.createElement('nav');
  menuBar.className = 'toolbar-menubar';

  menuItems.forEach(menu => {
    const menuBtn = document.createElement('button');
    menuBtn.className = 'toolbar-menu-btn';
    menuBtn.textContent = menu.label;
    menuBtn.setAttribute('role', 'menuitem');
    menuBtn.setAttribute('aria-haspopup', 'true');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.id = menu.id + '-btn';

    const dropdown = document.createElement('div');
    dropdown.className = 'toolbar-dropdown';
    dropdown.setAttribute('role', 'menu');
    dropdown.setAttribute('aria-labelledby', menuBtn.id);
    dropdown.hidden = true;

    menu.items.forEach(item => {
      const menuItem = document.createElement('button');
      menuItem.className = 'toolbar-dropdown-item';
      menuItem.setAttribute('role', 'menuitem');
      menuItem.dataset.action = item.id;
      menuItem.innerHTML = `
        <span class="toolbar-item-icon">${item.icon}</span>
        <span class="toolbar-item-label">${item.label}</span>
        ${item.shortcut ? `<span class="toolbar-item-shortcut">${item.shortcut}</span>` : ''}
      `;
      dropdown.appendChild(menuItem);
    });

    const wrapper = document.createElement('div');
    wrapper.className = 'toolbar-menu-wrapper';
    wrapper.appendChild(menuBtn);
    wrapper.appendChild(dropdown);
    menuBar.appendChild(wrapper);

    // 드롭다운 토글
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !dropdown.hidden;
      closeAllDropdowns();
      if (!isOpen) {
        openDropdown(menuBtn, dropdown);
      }
    });

    // 드롭다운 항목 클릭 → 액션 처리
    dropdown.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('[data-action]') as HTMLElement;
      if (!item) return;
      handleAction(item.dataset.action);
      closeAllDropdowns();
    });

    // 방향키 네비게이션
    menuBtn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        closeAllDropdowns();
        openDropdown(menuBtn, dropdown);
        (dropdown.querySelector('[role="menuitem"]') as HTMLElement)?.focus();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        navigateSiblingMenu(menuBtn, e.key === 'ArrowRight' ? 1 : -1);
      }
    });

    dropdown.addEventListener('keydown', (e) => {
      const items = Array.from(dropdown.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      const current = document.activeElement as HTMLElement;
      const idx = items.indexOf(current);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[(idx + 1) % items.length]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items[(idx - 1 + items.length) % items.length]?.focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeAllDropdowns();
        menuBtn.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        items[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        items[items.length - 1]?.focus();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        closeAllDropdowns();
        navigateSiblingMenu(menuBtn, e.key === 'ArrowRight' ? 1 : -1);
      }
    });
  });

  // ── 우측 액션 영역 ──
  const actions = document.createElement('div');
  actions.className = 'toolbar-actions';

  // 커맨드 팔레트 버튼
  const paletteBtn = document.createElement('button');
  paletteBtn.className = 'toolbar-icon-btn toolbar-palette-btn';
  paletteBtn.setAttribute('title', '커맨드 팔레트 (Ctrl+K)');
  paletteBtn.setAttribute('aria-label', '커맨드 팔레트 열기');
  paletteBtn.innerHTML = `${CommandIcon}<span class="toolbar-palette-hint">⌘K</span>`;
  paletteBtn.addEventListener('click', callbacks.onOpenCommandPalette);

  actions.appendChild(paletteBtn);

  toolbar.appendChild(logo);
  toolbar.appendChild(menuBar);
  toolbar.appendChild(actions);

  // 외부 클릭 시 닫기
  document.addEventListener('click', () => closeAllDropdowns());

  // ── 내부 유틸 ──

  function openDropdown(btn: HTMLElement, dropdown: HTMLElement) {
    btn.setAttribute('aria-expanded', 'true');
    dropdown.hidden = false;
  }

  function closeAllDropdowns() {
    toolbar.querySelectorAll<HTMLElement>('.toolbar-dropdown').forEach(d => {
      d.hidden = true;
    });
    toolbar.querySelectorAll<HTMLElement>('.toolbar-menu-btn').forEach(b => {
      b.setAttribute('aria-expanded', 'false');
    });
  }

  function navigateSiblingMenu(current: HTMLElement, dir: 1 | -1) {
    const btns = Array.from(toolbar.querySelectorAll<HTMLElement>('.toolbar-menu-btn'));
    const idx = btns.indexOf(current);
    const next = btns[(idx + dir + btns.length) % btns.length];
    if (next) next.click();
  }

  function handleAction(action: string) {
    switch (action) {
      case 'load-sample':       callbacks.onLoadSample();          break;
      case 'import-file':       triggerFileImport();               break;
      case 'toggle-snippets':   callbacks.onToggleSnippets();      break;
      case 'toggle-cheatsheet': callbacks.onToggleCheatsheet();    break;
      case 'show-help':
      case 'show-shortcuts':    callbacks.onShowHelp();            break;
      case 'open-manual':       callbacks.onOpenManual();          break;
    }
  }

  function triggerFileImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.txt,.csv,.tsv,.ndjson';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const textarea = document.querySelector<HTMLTextAreaElement>('#input');
        if (textarea) {
          textarea.value = reader.result as string;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  return toolbar;
}

// 로고용 미니 SVG (아이콘 상수보다 먼저 쓰기 위해 별도 정의)
const TerminalSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>`;
