export function createSaveQueryModal(onSave) {
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

  const nameInput = modal.querySelector('#queryName');
  const queryTextarea = modal.querySelector('#queryToSave');
  const cancelBtn = modal.querySelector('#cancelBtn');
  const saveBtn = modal.querySelector('#saveBtn');

  // Public methods
  const api = {
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

  nameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveBtn.click();
    }
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      api.hide();
    }
  });

  modal.api = api;
  return modal;
}
