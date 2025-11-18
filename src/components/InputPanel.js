import { readFile } from '../core/file-handler.js';

export function createInputPanel(onInputChange) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="panel-header">
      <span class="panel-title">Input</span>
      <div class="panel-actions">
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

  // Event listeners
  textarea.addEventListener('input', onInputChange);
  textarea.addEventListener('keydown', handleTabKey);

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

function handleTabKey(e) {
  if (e.key !== 'Tab') return;

  e.preventDefault();
  const TAB_SIZE = 4;
  const INDENT = ' '.repeat(TAB_SIZE);
  const textarea = e.target;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;

  if (start === end) {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const beforeCursor = value.substring(lineStart, start);

    if (e.shiftKey && /^[ \t]*$/.test(beforeCursor)) {
      const match = beforeCursor.match(/^(?:\t|( {1,4}))/);
      if (match) {
        const removed = match[0].length;
        textarea.value = value.substring(0, lineStart) + value.substring(lineStart + removed);
        textarea.selectionStart = textarea.selectionEnd = start - removed;
      }
    } else if (!e.shiftKey) {
      textarea.value = value.substring(0, start) + INDENT + value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + TAB_SIZE;
    }
  } else {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = value.indexOf('\n', end);
    const selectedLines = value.substring(lineStart, lineEnd === -1 ? value.length : lineEnd);

    let newLines;
    let totalOffset = 0;

    if (e.shiftKey) {
      const lines = selectedLines.split('\n');
      newLines = lines.map((line) => {
        const match = line.match(/^( {1,4})/);
        if (match) {
          const removed = match[1].length;
          totalOffset -= removed;
          return line.substring(removed);
        }
        return line;
      }).join('\n');
    } else {
      const lines = selectedLines.split('\n');
      newLines = lines.map(line => INDENT + line).join('\n');
      totalOffset = newLines.length - selectedLines.length;
    }

    textarea.value = value.substring(0, lineStart) + newLines + value.substring(lineEnd === -1 ? value.length : lineEnd);

    if (e.shiftKey) {
      const firstLineRemoved = selectedLines.split('\n')[0].match(/^( {1,4})/) ?
                              selectedLines.split('\n')[0].match(/^( {1,4})/)[1].length : 0;
      textarea.selectionStart = start - (lineStart === start ? firstLineRemoved : 0);
      textarea.selectionEnd = end + totalOffset + (lineStart === start ? firstLineRemoved : 0);
    } else {
      textarea.selectionStart = start + (lineStart === start ? TAB_SIZE : 0);
      textarea.selectionEnd = end + totalOffset;
    }
  }
}
