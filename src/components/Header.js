import { Storage } from '../utils/storage.js';

export function createHeader(onLoadSample, onToggleCheatsheet, onShowHelp) {
  const header = document.createElement('div');
  header.className = 'header';
  header.innerHTML = `
    <h1>jq Playground</h1>
    <div class="header-actions">
      <button id="themeToggleBtn" class="theme-toggle" title="Toggle dark mode">☀️</button>
      <button id="helpBtn">Help</button>
      <button id="loadSampleBtn">Load Sample</button>
      <button id="toggleSyntaxBtn">Syntax</button>
      <a href="https://jqlang.github.io/jq/manual/" target="_blank" style="text-decoration: none;">
        <button>Manual</button>
      </a>
    </div>
  `;

  const themeToggleBtn = header.querySelector('#themeToggleBtn');

  // Get system dark mode preference
  const systemDarkMode = window.matchMedia('(prefers-color-scheme: dark)');

  // Apply theme based on setting
  function applyTheme(theme) {
    const isDark = theme === 'dark' || (theme === 'system' && systemDarkMode.matches);
    document.documentElement.classList.toggle('dark', isDark);

    // Update button icon
    if (theme === 'system') {
      themeToggleBtn.textContent = '💻';
      themeToggleBtn.title = 'Theme: System';
    } else if (theme === 'dark') {
      themeToggleBtn.textContent = '🌙';
      themeToggleBtn.title = 'Theme: Dark';
    } else {
      themeToggleBtn.textContent = '☀️';
      themeToggleBtn.title = 'Theme: Light';
    }
  }

  // Initialize theme from storage
  const savedTheme = Storage.getTheme();
  applyTheme(savedTheme);

  // Listen for system theme changes (only when theme is 'system')
  systemDarkMode.addEventListener('change', () => {
    if (Storage.getTheme() === 'system') {
      applyTheme('system');
    }
  });

  // Theme toggle handler: light -> dark -> system -> light
  themeToggleBtn.addEventListener('click', () => {
    const currentTheme = Storage.getTheme();
    let nextTheme;

    if (currentTheme === 'light') {
      nextTheme = 'dark';
    } else if (currentTheme === 'dark') {
      nextTheme = 'system';
    } else {
      nextTheme = 'light';
    }

    Storage.saveTheme(nextTheme);
    applyTheme(nextTheme);
  });

  header.querySelector('#helpBtn').addEventListener('click', onShowHelp);
  header.querySelector('#loadSampleBtn').addEventListener('click', onLoadSample);
  header.querySelector('#toggleSyntaxBtn').addEventListener('click', onToggleCheatsheet);

  return header;
}
