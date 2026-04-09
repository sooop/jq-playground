import type { ComponentElement, InputPanelApi, QueryPanelApi, OutputPanelElement, SaveQueryModalApi, HelpModalApi, PanelToggleApi, FormatResult, ExecuteResult } from './types';
import { createHeader } from './components/Header';
import { createInputPanel } from './components/InputPanel';
import { createQueryPanel } from './components/QueryPanel';
import { createOutputPanel } from './components/OutputPanel';
import { createSaveQueryModal, createHelpModal } from './components/Modal';
import { createCheatsheet } from './components/Cheatsheet';
import { createSnippets } from './components/Snippets';
import { jqEngine } from './core/jq-engine';
import { extractKeys } from './core/jq-functions';
import { Storage } from './utils/storage';
import { registerKeymap, initKeymap } from './utils/keymap';
import { createCommandPalette } from './components/CommandPalette';
import type { CommandPaletteApi } from './components/CommandPalette';

const RESIZE_STORAGE_KEY = 'jq-panel-resize';

/**
 * Root application controller. Wires together all panels, the jq engine,
 * and storage. Created and initialized once from `main.js`.
 */
export class App {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private inputPanel: ComponentElement<InputPanelApi> | null = null;
  private queryPanel: ComponentElement<QueryPanelApi> | null = null;
  private outputPanel: OutputPanelElement | null = null;
  private modal: ComponentElement<SaveQueryModalApi> | null = null;
  private helpModal: ComponentElement<HelpModalApi> | null = null;
  private cheatsheet: ComponentElement<PanelToggleApi> | null = null;
  private snippets: ComponentElement<PanelToggleApi> | null = null;
  private executionGeneration = 0;
  private commandPalette: { element: HTMLElement; api: CommandPaletteApi } | null = null;

  constructor() {
  }

  /**
   * Mount all components into `#app` and set up event wiring.
   * @returns {Promise<void>}
   */
  async init() {
    const app = document.getElementById('app');

    // Initialize jq engine
    try {
      await jqEngine.init();
    } catch (error) {
      app.innerHTML = `<div style="padding: 20px; color: #d33;">Failed to initialize: ${error.message}</div>`;
      return;
    }

    // Initialize storage (IndexedDB + migration)
    await Storage.init();

    // Create components
    const header = createHeader(
      () => this.loadSample(),
      () => this.cheatsheet.api.toggle(),
      () => this.helpModal.api.show(),
      () => this.snippets.api.toggle(),
      () => this.openCommandPalette(),
    );

    this.inputPanel = createInputPanel(
      () => this.executeQuery(),
      () => this.executeQuery(true)
    ) as unknown as ComponentElement<InputPanelApi>;
    this.queryPanel = createQueryPanel(
      () => this.executeQuery(),
      (query) => this.modal.api.show(query),
      () => this.manualExecute(),
      () => this.getInputKeys()
    ) as unknown as ComponentElement<QueryPanelApi>;
    this.outputPanel = createOutputPanel() as unknown as OutputPanelElement;

    // Set up auto-play toggle callback
    this.outputPanel.onAutoPlayToggle = (enabled) => {
      if (enabled) {
        this.executeQuery();
      }
      this.inputPanel.api.setAutoPlayIndicator(enabled);
    };

    this.modal = createSaveQueryModal((name, query) => {
      this.queryPanel.api.saveQuery(name, query);
    }) as unknown as ComponentElement<SaveQueryModalApi>;

    this.helpModal = createHelpModal() as unknown as ComponentElement<HelpModalApi>;

    this.cheatsheet = createCheatsheet((query) => {
      const queryTextarea = this.queryPanel.querySelector('#query') as HTMLTextAreaElement;
      const current = queryTextarea.value;
      queryTextarea.value = current.trim() === '' ? query : current + ' | ' + query;
      queryTextarea.focus();
      this.executeQuery();
    }) as unknown as ComponentElement<PanelToggleApi>;

    this.snippets = createSnippets((query) => {
      const queryTextarea = this.queryPanel.querySelector('#query') as HTMLTextAreaElement;
      queryTextarea.value = query;
      queryTextarea.focus();
      this.executeQuery();
    }) as unknown as ComponentElement<PanelToggleApi>;

    // Build layout
    const container = document.createElement('div');
    container.className = 'container';

    const main = document.createElement('div');
    main.className = 'main';

    const topPanel = document.createElement('div');
    topPanel.className = 'top-panel';
    topPanel.appendChild(this.inputPanel);

    // Horizontal resizer between input and query
    const hResizer = document.createElement('div');
    hResizer.className = 'resizer horizontal';
    topPanel.appendChild(hResizer);

    topPanel.appendChild(this.queryPanel);

    main.appendChild(topPanel);

    // Vertical resizer between top and output
    const vResizer = document.createElement('div');
    vResizer.className = 'resizer vertical';
    main.appendChild(vResizer);

    main.appendChild(this.outputPanel);

    // Initialize resizers
    this.initResizers(topPanel, main, hResizer, vResizer);
    this.restorePanelSizes(topPanel, main);

    container.appendChild(header);
    container.appendChild(main);

    // Command Palette 마운트
    this.commandPalette = createCommandPalette();
    app.appendChild(container);
    app.appendChild(this.modal);
    app.appendChild(this.helpModal);
    app.appendChild(this.snippets);
    app.appendChild(this.cheatsheet);
    app.appendChild(this.commandPalette.element);

    // Initialize auto-play chip indicator
    this.inputPanel.api.setAutoPlayIndicator(this.outputPanel.api.isAutoPlayEnabled());

    // Format change listener - Worker에 formatResult 요청
    this.outputPanel.querySelector('#formatSelect').addEventListener('change', async () => {
      const format = this.outputPanel.api.getFormat();
      // Worker에 캐싱된 결과로 포맷 변환 요청 시도
      try {
        const result = await jqEngine.formatResult(format) as FormatResult;
        if (result.format === 'json') {
          this.outputPanel.api.showFormattedResult(result.resultText, 'json');
        } else if (result.format === 'csv') {
          this.outputPanel.api.showFormattedResult(result.html, 'csv', result.csv);
        }
      } catch {
        // Worker 실패 시 폴백: 저장된 결과로 직접 변환 시도 후 재실행
        if (format !== 'json') {
          const lastText = this.outputPanel.api.getLastResultText();
          if (lastText) {
            try {
              const parsedData = JSON.parse(lastText);
              this.outputPanel.api.showResult(parsedData, format);
              return;
            } catch { /* 파싱 실패 시 재실행으로 진행 */ }
          }
        }
        this.executeQuery(true);
      }
    });

    // ── 글로벌 단축키 등록 ──
    registerKeymap({
      id: 'toggle-autoplay',
      keys: 'Ctrl+Shift+E',
      label: 'Auto-play 토글',
      handler: () => this.outputPanel.api.toggleAutoPlay(),
    });

    registerKeymap({
      id: 'open-command-palette',
      keys: 'Ctrl+K',
      label: '커맨드 팔레트 열기',
      handler: () => this.openCommandPalette(),
    });

    registerKeymap({
      id: 'focus-input',
      keys: 'Ctrl+1',
      label: 'Input 패널 포커스',
      handler: () => this.focusPanel('input'),
    });

    registerKeymap({
      id: 'focus-query',
      keys: 'Ctrl+2',
      label: 'Query 패널 포커스',
      handler: () => this.focusPanel('query'),
    });

    registerKeymap({
      id: 'focus-output',
      keys: 'Ctrl+3',
      label: 'Output 패널 포커스',
      handler: () => this.focusPanel('output'),
    });

    registerKeymap({
      id: 'cycle-panels',
      keys: 'F6',
      label: '다음 패널로 포커스',
      handler: () => this.cyclePanels(1),
    });

    registerKeymap({
      id: 'cycle-panels-reverse',
      keys: 'Shift+F6',
      label: '이전 패널로 포커스',
      handler: () => this.cyclePanels(-1),
    });

    registerKeymap({
      id: 'show-shortcuts',
      keys: '?',
      label: '단축키 목록',
      when: () => !document.querySelector('.modal-overlay.show'),
      handler: () => this.helpModal.api.show(),
    });

    // 단일 글로벌 keydown 디스패처 초기화
    initKeymap();

    // 패널 포커스 이벤트로 --accent-current 전역 동기화 (마우스/키보드 모두)
    const panelAccentMap: Record<string, string> = {
      'input-panel':  'var(--accent-input)',
      'query-panel':  'var(--accent-query)',
      'output-panel': 'var(--accent-output)',
    };
    document.addEventListener('focusin', (e) => {
      const target = e.target as HTMLElement;
      const panelEl = target.closest<HTMLElement>('.panel');
      if (!panelEl) return;
      for (const [cls, accentVar] of Object.entries(panelAccentMap)) {
        if (panelEl.classList.contains(cls)) {
          document.documentElement.style.setProperty('--accent-current', accentVar);
          break;
        }
      }
    });

    // Flush storage and cleanup on page unload
    window.addEventListener('beforeunload', () => {
      Storage.flushAll();
      // Terminate Workers to clean up resources
      this.queryPanel.api.terminateWorker?.();
      jqEngine.terminate();
    });
  }

  /** 커맨드 팔레트 열기 */
  openCommandPalette() {
    this.commandPalette?.api.open();
  }

  /** 패널 accent를 전역 --accent-current에 반영 */
  private syncAccentCurrent(panelEl: HTMLElement | null) {
    if (!panelEl) return;
    const accent = getComputedStyle(panelEl).getPropertyValue('--panel-accent').trim();
    if (accent) {
      document.documentElement.style.setProperty('--accent-current', accent);
    }
  }

  /** Ctrl+1/2/3 으로 해당 패널 textarea/content에 포커스 */
  focusPanel(panel: 'input' | 'query' | 'output') {
    const selectors = {
      input:  '#input',
      query:  '#query',
      output: '.panel-content .output-content, .panel-content .virtual-viewport',
    };
    const panelSelectors = {
      input:  '.input-panel',
      query:  '.query-panel',
      output: '.output-panel',
    };
    const el = document.querySelector<HTMLElement>(selectors[panel]);
    const panelEl = document.querySelector<HTMLElement>(panelSelectors[panel]);
    this.syncAccentCurrent(panelEl);
    el?.focus();
  }

  /** F6 / Shift+F6 으로 패널 순환 */
  cyclePanels(dir: 1 | -1) {
    const panels = [
      document.querySelector<HTMLElement>('#input'),
      document.querySelector<HTMLElement>('#query'),
      document.querySelector<HTMLElement>('.output-content, .virtual-viewport'),
    ].filter(Boolean) as HTMLElement[];

    const active = document.activeElement as HTMLElement;
    let idx = panels.findIndex(p => p === active || p?.contains(active));
    idx = ((idx + dir) + panels.length) % panels.length;
    panels[idx]?.focus();
  }

  /** Execute once without changing auto-play state. */
  manualExecute() {
    this.executeQuery(true);
  }

  /**
   * Debounced query execution. Skips execution if auto-play is disabled
   * unless `forceExecute` is true.
   * @param {boolean} [forceExecute=false]
   */
  executeQuery(forceExecute = false) {
    clearTimeout(this.debounceTimer ?? undefined);

    const SIZE_3MB = 3 * 1024 * 1024;
    const SIZE_500KB = 500 * 1024;

    // Use .length (O(1) property) instead of Blob to avoid blocking the main thread.
    // For ASCII/JSON, length ≈ byte size. Good enough for debounce heuristics.
    const inputLength = (this.inputPanel.querySelector('#input') as HTMLInputElement).value.length;

    let debounceDelay;
    if (inputLength > SIZE_3MB) {
      debounceDelay = 1000;
    } else if (inputLength > SIZE_500KB) {
      debounceDelay = 500;
    } else {
      debounceDelay = 300;
    }

    this.debounceTimer = setTimeout(async () => {
      // Check auto-play status unless force execute
      if (!forceExecute && !this.outputPanel.api.isAutoPlayEnabled()) {
        return;
      }

      // Read value inside the timer — deferred off the synchronous event path.
      // No .trim() and no Blob: both create O(n) string copies on the main thread.
      // JSON.parse in the worker handles surrounding whitespace fine.
      const input = (this.inputPanel.querySelector('#input') as HTMLInputElement).value;
      const inputSize = input.length;

      // Disable auto-execute if input exceeds 3MB (unless forced)
      if (inputSize > SIZE_3MB && !forceExecute) {
        if (this.outputPanel.api.isAutoPlayEnabled()) {
          this.outputPanel.api.toggleAutoPlay();
          this.inputPanel.api.setAutoPlayIndicator(false);
          this.outputPanel.api.showError(
            '자동실행 비활성화: 입력 크기가 3MB를 초과합니다. 수동 실행 버튼을 사용하세요.',
            false
          );
        }
        return;
      }

      const query = this.queryPanel.api.getQuery();

      if (!input) {
        this.outputPanel.api.clear();
        return;
      }

      if (!query) {
        this.outputPanel.api.clear();
        return;
      }

      this.outputPanel.api.showLoading();

      // Stale 결과 방지: generation 카운터
      this.executionGeneration = (this.executionGeneration || 0) + 1;
      const thisGeneration = this.executionGeneration;

      try {
        const { resultText, executionTime } = await jqEngine.execute(input, query) as ExecuteResult;

        // Stale 체크: 이 사이에 새 실행이 시작되었으면 무시
        if (thisGeneration !== this.executionGeneration) return;

        // execute 완료 후 포맷을 읽어야 한다.
        // execute await 중 사용자가 포맷을 변경했을 경우,
        // 변경된 포맷으로 결과를 표시해야 하기 때문.
        const format = this.outputPanel.api.getFormat();

        this.queryPanel.api.addToHistory(query);

        // Worker가 resultText(stringify된 JSON)를 반환
        if (format === 'json') {
          this.outputPanel.api.showResultText(resultText, 'json', executionTime);
        } else if (format === 'csv') {
          // CSV 포맷: Worker에 formatResult 요청
          try {
            const csvResult = await jqEngine.formatResult('csv') as FormatResult;
            if (thisGeneration !== this.executionGeneration) return;
            this.outputPanel.api.showFormattedResult(csvResult.html, 'csv', csvResult.csv, executionTime);
          } catch {
            // Worker formatResult 실패 시 메인스레드에서 CSV 직접 생성
            if (thisGeneration !== this.executionGeneration) return;
            try {
              const parsedData = JSON.parse(resultText);
              this.outputPanel.api.showResult(parsedData, 'csv', executionTime);
            } catch {
              this.outputPanel.api.showResultText(resultText, 'json', executionTime);
            }
          }
        }
      } catch (error) {
        if (thisGeneration !== this.executionGeneration) return;
        this.outputPanel.api.showError(error.message);
      }
    }, debounceDelay);
  }

  /**
   * Attach mouse-drag listeners to the horizontal and vertical resizer elements.
   * @param {HTMLElement} topPanel
   * @param {HTMLElement} main
   * @param {HTMLElement} hResizer
   * @param {HTMLElement} vResizer
   */
  initResizers(topPanel, main, hResizer, vResizer) {
    // Horizontal resizer (between input and query)
    let isResizingH = false;
    hResizer.addEventListener('mousedown', (e) => {
      isResizingH = true;
      hResizer.classList.add('active');
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });

    // Vertical resizer (between top and output)
    let isResizingV = false;
    vResizer.addEventListener('mousedown', (e) => {
      isResizingV = true;
      vResizer.classList.add('active');
      document.body.style.cursor = 'row-resize';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (isResizingH) {
        const rect = topPanel.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const percentage = (offsetX / rect.width) * 100;
        if (percentage > 20 && percentage < 80) {
          topPanel.style.gridTemplateColumns = `${percentage}% 4px ${100 - percentage}%`;
        }
      } else if (isResizingV) {
        const rect = main.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;
        const percentage = (offsetY / rect.height) * 100;
        if (percentage > 20 && percentage < 80) {
          main.style.gridTemplateRows = `${percentage}% 4px ${100 - percentage}%`;
        }
      }
    });

    document.addEventListener('mouseup', () => {
      if (isResizingH || isResizingV) {
        this.savePanelSizes(topPanel, main);
      }
      if (isResizingH) hResizer.classList.remove('active');
      if (isResizingV) vResizer.classList.remove('active');
      isResizingH = false;
      isResizingV = false;
      document.body.style.cursor = '';
    });
  }

  /**
   * Persist current panel split ratios to localStorage.
   * @param {HTMLElement} topPanel
   * @param {HTMLElement} main
   */
  savePanelSizes(topPanel, main) {
    try {
      const hColumns = topPanel.style.gridTemplateColumns;
      const vRows = main.style.gridTemplateRows;

      const hMatch = hColumns.match(/^([\d.]+)%/);
      const vMatch = vRows.match(/^([\d.]+)%/);

      const sizes = {
        horizontal: hMatch ? parseFloat(hMatch[1]) : 50,
        vertical: vMatch ? parseFloat(vMatch[1]) : 50
      };

      localStorage.setItem(RESIZE_STORAGE_KEY, JSON.stringify(sizes));
    } catch (e) {
      console.error('Failed to save panel sizes:', e);
    }
  }

  /**
   * Restore panel split ratios from localStorage.
   * @param {HTMLElement} topPanel
   * @param {HTMLElement} main
   */
  restorePanelSizes(topPanel, main) {
    try {
      const saved = localStorage.getItem(RESIZE_STORAGE_KEY);
      if (saved) {
        const { horizontal, vertical } = JSON.parse(saved);

        if (horizontal && horizontal >= 20 && horizontal <= 80) {
          topPanel.style.gridTemplateColumns = `${horizontal}% 4px ${100 - horizontal}%`;
        }

        if (vertical && vertical >= 20 && vertical <= 80) {
          main.style.gridTemplateRows = `${vertical}% 4px ${100 - vertical}%`;
        }
      }
    } catch (e) {
      console.error('Failed to restore panel sizes:', e);
    }
  }

  /**
   * Extract top-level and nested keys from the current input JSON.
   * Returns an empty array if the input is absent or invalid.
   * @returns {string[]}
   */
  getInputKeys() {
    try {
      const input = (this.inputPanel.querySelector('#input') as HTMLInputElement).value;
      if (!input) return [];
      const data = JSON.parse(input);
      return extractKeys(data);
    } catch (e) {
      return [];
    }
  }

  /** Populate the input and query panels with a built-in sample dataset. */
  loadSample() {
    const sampleData = {
      "users": [
        {"name": "Alice", "age": 30, "city": "Seoul", "hobbies": ["reading", "coding"]},
        {"name": "Bob", "age": 25, "city": "Busan", "hobbies": ["gaming"]},
        {"name": "Charlie", "age": 35, "city": "Seoul", "hobbies": ["music", "sports", "travel"]}
      ],
      "metadata": {
        "timestamp": "2025-11-14",
        "version": "1.0"
      }
    };

    (this.inputPanel.querySelector('#input') as HTMLInputElement).value = JSON.stringify(sampleData, null, 2);
    (this.queryPanel.querySelector('#query') as HTMLTextAreaElement).value = '.users[] | select(.city == "Seoul")';
    this.executeQuery();
  }
}
