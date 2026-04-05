import type { ComponentElement, SaveQueryModalApi, HelpModalApi } from '../types';

export function createSaveQueryModal(onSave: (name: string, query: string) => void) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'saveQueryModal';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-title">Save Query</div>
      <div class="modal-field">
        <label class="modal-label">Name</label>
        <input type="text" class="modal-input" id="queryName" placeholder="Enter query name...">
      </div>
      <div class="modal-field">
        <label class="modal-label">Query</label>
        <textarea class="modal-textarea" id="queryToSave" readonly></textarea>
      </div>
      <div class="modal-actions">
        <button id="cancelBtn">Cancel</button>
        <button class="primary" id="saveBtn">Save</button>
      </div>
    </div>
  `;

  const nameInput = modal.querySelector<HTMLInputElement>('#queryName')!;
  const queryTextarea = modal.querySelector<HTMLTextAreaElement>('#queryToSave')!;
  const cancelBtn = modal.querySelector<HTMLButtonElement>('#cancelBtn')!;
  const saveBtn = modal.querySelector<HTMLButtonElement>('#saveBtn')!;

  // Public methods
  const api: SaveQueryModalApi = {
    show: (query) => {
      queryTextarea.value = query;
      nameInput.value = '';
      modal.classList.add('show');
      nameInput.focus();
    },

    hide: () => {
      modal.classList.remove('show');
    }
  };

  // Event listeners
  cancelBtn.addEventListener('click', () => api.hide());

  saveBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    const query = queryTextarea.value.trim();

    if (!name) {
      alert('Please enter a name for the query');
      return;
    }

    onSave(name, query);
    api.hide();
  });

  nameInput.addEventListener('keypress', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveBtn.click();
    }
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      api.hide();
    }
  });

  const el = modal as unknown as ComponentElement<SaveQueryModalApi>;
  el.api = api;
  return el;
}

export function createHelpModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'helpModal';
  modal.innerHTML = `
    <div class="modal help-modal">
      <div class="modal-title">Keyboard Shortcuts</div>
      <div class="help-content">
        <div class="help-section">
          <h3>Global</h3>
          <div class="shortcut-item">
            <span class="shortcut-key">Ctrl+Shift+E</span>
            <span class="shortcut-desc">Toggle auto-execute (pause/resume)</span>
          </div>
        </div>

        <div class="help-section">
          <h3>Input Panel</h3>
          <div class="shortcut-item">
            <span class="shortcut-key">Ctrl+Shift+F</span>
            <span class="shortcut-desc">Format JSON</span>
          </div>
          <div class="shortcut-item">
            <span class="shortcut-key">Tab</span>
            <span class="shortcut-desc">Indent (4 spaces)</span>
          </div>
          <div class="shortcut-item">
            <span class="shortcut-key">Shift+Tab</span>
            <span class="shortcut-desc">Unindent</span>
          </div>
        </div>

        <div class="help-section">
          <h3>Query Panel</h3>
          <div class="shortcut-item">
            <span class="shortcut-key">Ctrl+Enter</span>
            <span class="shortcut-desc">Execute query manually</span>
          </div>
          <div class="shortcut-item">
            <span class="shortcut-key">Tab</span>
            <span class="shortcut-desc">Indent (4 spaces)</span>
          </div>
          <div class="shortcut-item">
            <span class="shortcut-key">Shift+Tab</span>
            <span class="shortcut-desc">Unindent</span>
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="primary" id="closeHelpBtn">Close</button>
      </div>
    </div>
  `;

  const closeBtn = modal.querySelector<HTMLButtonElement>('#closeHelpBtn')!;

  // Public methods
  const api: HelpModalApi = {
    show: () => {
      modal.classList.add('show');
    },

    hide: () => {
      modal.classList.remove('show');
    }
  };

  // Event listeners
  closeBtn.addEventListener('click', () => api.hide());

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      api.hide();
    }
  });

  // ESC key to close
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && modal.classList.contains('show')) {
      api.hide();
    }
  });

  const el = modal as unknown as ComponentElement<HelpModalApi>;
  el.api = api;
  return el;
}
