import { createHeader } from './components/Header.js';
import { createInputPanel } from './components/InputPanel.js';
import { createQueryPanel } from './components/QueryPanel.js';
import { createOutputPanel } from './components/OutputPanel.js';
import { createSaveQueryModal, createHelpModal } from './components/Modal.js';
import { createCheatsheet } from './components/Cheatsheet.js';
import { jqEngine } from './core/jq-engine.js';
import { extractKeys } from './core/jq-functions.js';
import { Storage } from './utils/storage.js';

export class App {
  constructor() {
    this.debounceTimer = null;
    this.inputPanel = null;
    this.queryPanel = null;
    this.outputPanel = null;
    this.modal = null;
    this.helpModal = null;
    this.cheatsheet = null;
  }

  async init() {
    const app = document.getElementById('app');

    // Initialize jq engine
    try {
      await jqEngine.init();
    } catch (error) {
      app.innerHTML = `<div style="padding: 20px; color: #d33;">Failed to initialize: ${error.message}</div>`;
      return;
    }

    // Create components
    const header = createHeader(
      () => this.loadSample(),
      () => this.cheatsheet.api.toggle(),
      () => this.helpModal.api.show()
    );

    this.inputPanel = createInputPanel(() => this.executeQuery());
    this.queryPanel = createQueryPanel(
      () => this.executeQuery(),
      (query) => this.modal.api.show(query),
      () => this.manualExecute(),
      () => this.getInputKeys()
    );
    this.outputPanel = createOutputPanel();

    // Set up auto-play toggle callback
    this.outputPanel.onAutoPlayToggle = (enabled) => {
      if (enabled) {
        this.executeQuery();
      }
    };

    this.modal = createSaveQueryModal((name, query) => {
      this.queryPanel.api.saveQuery(name, query);
    });

    this.helpModal = createHelpModal();

    this.cheatsheet = createCheatsheet((query) => {
      const queryTextarea = this.queryPanel.querySelector('#query');
      const current = queryTextarea.value;
      queryTextarea.value = current.trim() === '' ? query : current + ' | ' + query;
      queryTextarea.focus();
      this.executeQuery();
    });

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

    container.appendChild(header);
    container.appendChild(this.cheatsheet);
    container.appendChild(main);

    app.appendChild(container);
    app.appendChild(this.modal);
    app.appendChild(this.helpModal);

    // Format change listener - force execute even if paused
    this.outputPanel.querySelector('#formatSelect').addEventListener('change', () => {
      this.executeQuery(true);
    });

    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Ctrl+Shift+E: Toggle auto-play
      if (e.ctrlKey && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        this.outputPanel.api.toggleAutoPlay();
        // Callback will be triggered automatically
      }
    });

    // Flush storage on page unload
    window.addEventListener('beforeunload', () => {
      Storage.flushAll();
    });

    // Initial execution
    this.executeQuery();
  }

  manualExecute() {
    // Execute once without changing auto-play state
    this.executeQuery(true);
  }

  executeQuery(forceExecute = false) {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(async () => {
      // Check auto-play status unless force execute
      if (!forceExecute && !this.outputPanel.api.isAutoPlayEnabled()) {
        return;
      }

      const input = this.inputPanel.querySelector('#input').value.trim();
      const query = this.queryPanel.api.getQuery();
      const format = this.outputPanel.api.getFormat();

      if (!input) {
        this.outputPanel.api.clear();
        return;
      }

      if (!query) {
        this.outputPanel.api.clear();
        return;
      }

      this.outputPanel.api.showLoading();

      try {
        const { result, executionTime } = await jqEngine.execute(input, query);
        this.queryPanel.api.addToHistory(query);
        this.outputPanel.api.showResult(result, format, executionTime);
      } catch (error) {
        this.outputPanel.api.showError(error.message);
      }
    }, 500);
  }

  initResizers(topPanel, main, hResizer, vResizer) {
    // Horizontal resizer (between input and query)
    let isResizingH = false;
    hResizer.addEventListener('mousedown', (e) => {
      isResizingH = true;
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });

    // Vertical resizer (between top and output)
    let isResizingV = false;
    vResizer.addEventListener('mousedown', (e) => {
      isResizingV = true;
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
      isResizingH = false;
      isResizingV = false;
      document.body.style.cursor = '';
    });
  }

  getInputKeys() {
    try {
      const input = this.inputPanel.querySelector('#input').value.trim();
      if (!input) return [];
      const data = JSON.parse(input);
      return extractKeys(data);
    } catch (e) {
      return [];
    }
  }

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

    this.inputPanel.querySelector('#input').value = JSON.stringify(sampleData, null, 2);
    this.queryPanel.querySelector('#query').value = '.users[] | select(.city == "Seoul")';
    this.executeQuery();
  }
}
