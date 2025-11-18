export function createHeader(onLoadSample, onToggleCheatsheet) {
  const header = document.createElement('div');
  header.className = 'header';
  header.innerHTML = `
    <h1>jq Playground</h1>
    <div class="header-actions">
      <button id="loadSampleBtn">Load Sample</button>
      <button id="toggleSyntaxBtn">Syntax</button>
      <a href="https://jqlang.github.io/jq/manual/" target="_blank" style="text-decoration: none;">
        <button>Manual</button>
      </a>
    </div>
  `;

  header.querySelector('#loadSampleBtn').addEventListener('click', onLoadSample);
  header.querySelector('#toggleSyntaxBtn').addEventListener('click', onToggleCheatsheet);

  return header;
}
