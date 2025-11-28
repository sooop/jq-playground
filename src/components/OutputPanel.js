import { jsonToHTML, jsonToCSV } from '../core/csv-converter.js';
import { downloadText } from '../core/file-handler.js';

export function createOutputPanel() {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="panel-header">
      <span class="panel-title">Output</span>
      <div class="panel-actions">
        <button id="autoPlayBtn" class="auto-play-btn active" title="Toggle auto-execute (Ctrl+Shift+E)">▶</button>
        <select id="formatSelect">
          <option value="json">JSON</option>
          <option value="csv">CSV</option>
        </select>
        <button id="copyBtn">Copy</button>
        <button id="downloadBtn">Download</button>
      </div>
    </div>
    <div class="error-banner" id="errorBanner"></div>
    <div class="panel-content">
      <div class="output-content" id="output"></div>
    </div>
  `;

  const output = panel.querySelector('#output');
  const errorBanner = panel.querySelector('#errorBanner');
  const autoPlayBtn = panel.querySelector('#autoPlayBtn');
  const formatSelect = panel.querySelector('#formatSelect');
  const copyBtn = panel.querySelector('#copyBtn');
  const downloadBtn = panel.querySelector('#downloadBtn');

  let lastResultData = null;
  let errorTimeout = null;
  let autoPlayEnabled = true;

  // Public methods
  const api = {
    showLoading: () => {
      output.innerHTML = '<span class="loading">Processing...</span>';
    },

    showResult: (data, format) => {
      lastResultData = data;
      const isArray = Array.isArray(data);

      if (format === 'json') {
        output.textContent = JSON.stringify(data, null, 2);
      } else if (format === 'csv') {
        output.innerHTML = jsonToHTML(data, isArray);
      }

      api.hideError();
    },

    showError: (message, autoHideDuration = 5000) => {
      errorBanner.textContent = message;
      errorBanner.classList.add('show');

      if (errorTimeout) clearTimeout(errorTimeout);

      if (autoHideDuration !== false) {
        errorTimeout = setTimeout(() => {
          api.hideError();
        }, autoHideDuration);
      }

      output.textContent = '';
      lastResultData = null;
    },

    hideError: () => {
      if (errorTimeout) clearTimeout(errorTimeout);
      errorBanner.classList.remove('show');
    },

    getFormat: () => formatSelect.value,

    clear: () => {
      output.textContent = '';
      lastResultData = null;
      api.hideError();
    },

    isAutoPlayEnabled: () => autoPlayEnabled,

    toggleAutoPlay: () => {
      autoPlayEnabled = !autoPlayEnabled;
      if (autoPlayEnabled) {
        autoPlayBtn.classList.add('active');
        autoPlayBtn.textContent = '▶';
        autoPlayBtn.title = 'Pause auto-execute (Ctrl+Shift+E)';
      } else {
        autoPlayBtn.classList.remove('active');
        autoPlayBtn.textContent = '⏸';
        autoPlayBtn.title = 'Resume auto-execute (Ctrl+Shift+E)';
      }

      // Trigger callback when auto-play is enabled
      if (autoPlayEnabled && panel.onAutoPlayToggle) {
        panel.onAutoPlayToggle(autoPlayEnabled);
      }

      return autoPlayEnabled;
    }
  };

  // Event listeners
  autoPlayBtn.addEventListener('click', () => {
    api.toggleAutoPlay();
  });

  copyBtn.addEventListener('click', () => {
    const format = formatSelect.value;
    let text;

    if (format === 'csv' && lastResultData) {
      text = jsonToCSV(lastResultData);
    } else {
      text = output.textContent;
    }

    navigator.clipboard.writeText(text).then(() => {
      const originalText = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = originalText;
      }, 1500);
    });
  });

  downloadBtn.addEventListener('click', () => {
    const format = formatSelect.value;
    let text;

    if (format === 'json') {
      text = output.textContent;
    } else if (format === 'csv') {
      if (lastResultData) {
        text = jsonToCSV(lastResultData);
      } else {
        api.showError('데이터가 없습니다.');
        return;
      }
    }

    const filename = `output.${format === 'json' ? 'json' : 'csv'}`;
    downloadText(text, filename);
  });

  panel.api = api;
  return panel;
}
