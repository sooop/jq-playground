import { createHeader } from './components/Header.js';
import { createInputPanel } from './components/InputPanel.js';
import { createQueryPanel } from './components/QueryPanel.js';
import { createOutputPanel } from './components/OutputPanel.js';
import { createSaveQueryModal } from './components/Modal.js';
import { jqEngine } from './core/jq-engine.js';

export class App {
  constructor() {
    this.debounceTimer = null;
    this.inputPanel = null;
    this.queryPanel = null;
    this.outputPanel = null;
    this.modal = null;
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
      () => this.queryPanel.api.toggleCheatsheet()
    );

    this.inputPanel = createInputPanel(() => this.executeQuery());
    this.queryPanel = createQueryPanel(
      () => this.executeQuery(),
      (query) => this.modal.api.show(query)
    );
    this.outputPanel = createOutputPanel();

    this.modal = createSaveQueryModal((name, query) => {
      this.queryPanel.api.saveQuery(name, query);
    });

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

    // Format change listener
    this.outputPanel.querySelector('#formatSelect').addEventListener('change', () => {
      this.executeQuery();
    });

    // Initial execution
    this.executeQuery();
  }

  executeQuery() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(async () => {
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
