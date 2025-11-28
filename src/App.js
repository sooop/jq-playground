import { createHeader } from './components/Header.js';
import { createInputPanel } from './components/InputPanel.js';
import { createQueryPanel } from './components/QueryPanel.js';
import { createOutputPanel } from './components/OutputPanel.js';
import { createSaveQueryModal, createHelpModal } from './components/Modal.js';
import { jqEngine } from './core/jq-engine.js';

export class App {
  constructor() {
    this.debounceTimer = null;
    this.inputPanel = null;
    this.queryPanel = null;
    this.outputPanel = null;
    this.modal = null;
    this.helpModal = null;
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
      () => this.queryPanel.api.toggleCheatsheet(),
      () => this.helpModal.api.show()
    );

    this.inputPanel = createInputPanel(() => this.executeQuery());
    this.queryPanel = createQueryPanel(
      () => this.executeQuery(),
      (query) => this.modal.api.show(query),
      () => this.manualExecute()
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

    // Build layout
    const container = document.createElement('div');
    container.className = 'container';

    const main = document.createElement('div');
    main.className = 'main';

    const topPanel = document.createElement('div');
    topPanel.className = 'top-panel';
    topPanel.appendChild(this.inputPanel);
    topPanel.appendChild(this.queryPanel);

    main.appendChild(topPanel);
    main.appendChild(this.outputPanel);

    container.appendChild(header);
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
        const result = await jqEngine.execute(input, query);
        this.queryPanel.api.addToHistory(query);
        this.outputPanel.api.showResult(result, format);
      } catch (error) {
        this.outputPanel.api.showError(error.message);
      }
    }, 500);
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
