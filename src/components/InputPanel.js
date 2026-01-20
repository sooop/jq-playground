import { readFile } from '../core/file-handler.js';
import { handleTabKey } from '../utils/keyboard.js';

export function createInputPanel(onInputChange) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="panel-header">
      <span class="panel-title">Input</span>
      <div class="panel-actions">
        <button id="formatJsonBtn" title="Format JSON (Ctrl+Shift+F)">Format</button>
        <button id="clearInputBtn">Clear</button>
        <button id="loadFileBtn">Load File</button>
        <input type="file" id="fileInput" accept=".json,.txt" style="display: none;">
      </div>
    </div>
    <div class="panel-content">
      <textarea id="input" placeholder="Paste JSON here or drag & drop a file...">{
  "users": [
    {"name": "Alice", "age": 30, "city": "Seoul"},
    {"name": "Bob", "age": 25, "city": "Busan"}
  ]
}</textarea>
      <div class="drag-overlay" id="dragOverlay">Drop file here</div>
    </div>
  `;

  const textarea = panel.querySelector('#input');
  const fileInput = panel.querySelector('#fileInput');
  const panelContent = panel.querySelector('.panel-content');
  const dragOverlay = panel.querySelector('#dragOverlay');

  // Format JSON function
  const formatJson = () => {
    const value = textarea.value.trim();
    if (!value) return;

    try {
      const parsed = JSON.parse(value);
      textarea.value = JSON.stringify(parsed, null, 4);
      onInputChange();
    } catch (error) {
      alert('Invalid JSON: ' + error.message);
    }
  };

  // Event listeners
  textarea.addEventListener('input', onInputChange);
  textarea.addEventListener('keydown', (e) => {
    // Ctrl+Shift+F: Format JSON
    if (e.ctrlKey && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      formatJson();
      return;
    }
    handleTabKey(e);
  });

  panel.querySelector('#formatJsonBtn').addEventListener('click', formatJson);

  panel.querySelector('#clearInputBtn').addEventListener('click', () => {
    textarea.value = '';
    onInputChange();
  });

  panel.querySelector('#loadFileBtn').addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const content = await readFile(file);
      textarea.value = content;
      onInputChange();
    } catch (error) {
      alert(error.message);
    }
    e.target.value = '';
  });

  // Drag and drop
  panelContent.addEventListener('dragover', (e) => {
    e.preventDefault();
    dragOverlay.classList.add('active');
  });

  panelContent.addEventListener('dragleave', (e) => {
    if (e.target === panelContent) {
      dragOverlay.classList.remove('active');
    }
  });

  panelContent.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragOverlay.classList.remove('active');

    const file = e.dataTransfer.files[0];
    if (!file) return;

    try {
      const content = await readFile(file);
      textarea.value = content;
      onInputChange();
    } catch (error) {
      alert(error.message);
    }
  });

  return panel;
}
