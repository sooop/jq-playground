import { VirtualScroller } from '../utils/virtual-scroller';
import {
  createPreprocessClient,
  checkSizeGuard,
  needsSizeConfirm,
  needsSizeWarning,
  suggestDefaultOptions,
} from '../utils/json-preprocess-client';
import type { JsonCandidateMeta } from '../utils/json-preprocessor';
import type { ComponentElement, TransformModalApi } from '../types';

const PREVIEW_FULL_MAX = 200 * 1024;
const PREVIEW_TRUNCATE_AT = 2 * 1024 * 1024;
const PREVIEW_SHOW_BYTES = 50 * 1024;
const DEBOUNCE_MS = 300;
const LOADING_HINT_MS = 500;

export function createTransformModal(onApply?: (undo: (() => void) | null) => void) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay transform-modal-overlay';
  overlay.id = 'transformModal';
  overlay.innerHTML = `
    <div class="modal transform-modal">
      <div class="modal-header">
        <div class="modal-title">JSON Transform</div>
        <button type="button" class="modal-close-btn" id="transformCloseBtn" title="닫기">×</button>
      </div>
      <div class="transform-body">
        <div class="transform-source-row">
          <label class="modal-label" for="transformSource">Source</label>
          <textarea id="transformSource" class="transform-source" placeholder="텍스트를 붙여넣거나 Input에서 불러옵니다..." spellcheck="false"></textarea>
        </div>
        <div class="transform-toggles">
          <label class="transform-toggle"><input type="checkbox" id="extractToggle" checked> Extract JSON</label>
          <label class="transform-toggle"><input type="checkbox" id="unstringifyToggle"> Unstringify</label>
        </div>
        <div class="transform-status" id="transformStatus"></div>
        <div class="transform-candidates-section">
          <div class="transform-section-label">Candidates <span id="candidateCount"></span></div>
          <div class="transform-candidate-list" id="candidateList"></div>
        </div>
        <div class="transform-preview-section">
          <div class="transform-section-label">Preview</div>
          <div class="transform-preview-wrap">
            <div class="transform-loading hidden" id="transformLoading">
              <span class="transform-spinner"></span>
              <span id="transformLoadingText">처리 중…</span>
            </div>
            <pre class="transform-preview" id="transformPreview"></pre>
          </div>
        </div>
      </div>
      <div class="modal-actions transform-actions">
        <button type="button" id="transformCopyBtn" disabled>Copy</button>
        <button type="button" class="primary" id="transformApplyBtn" disabled>Apply to Input</button>
        <button type="button" id="transformCancelBtn">Cancel</button>
      </div>
    </div>
  `;

  const sourceTa = overlay.querySelector<HTMLTextAreaElement>('#transformSource')!;
  const extractToggle = overlay.querySelector<HTMLInputElement>('#extractToggle')!;
  const unstringifyToggle = overlay.querySelector<HTMLInputElement>('#unstringifyToggle')!;
  const statusEl = overlay.querySelector<HTMLElement>('#transformStatus')!;
  const candidateList = overlay.querySelector<HTMLElement>('#candidateList')!;
  const candidateCount = overlay.querySelector<HTMLElement>('#candidateCount')!;
  const previewEl = overlay.querySelector<HTMLElement>('#transformPreview')!;
  const previewWrap = overlay.querySelector<HTMLElement>('.transform-preview-wrap')!;
  const loadingEl = overlay.querySelector<HTMLElement>('#transformLoading')!;
  const loadingText = overlay.querySelector<HTMLElement>('#transformLoadingText')!;
  const copyBtn = overlay.querySelector<HTMLButtonElement>('#transformCopyBtn')!;
  const applyBtn = overlay.querySelector<HTMLButtonElement>('#transformApplyBtn')!;
  const cancelBtn = overlay.querySelector<HTMLButtonElement>('#transformCancelBtn')!;
  const closeBtn = overlay.querySelector<HTMLButtonElement>('#transformCloseBtn')!;

  const client = createPreprocessClient();
  const virtualScroller = new VirtualScroller(previewEl);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let loadingHintTimer: ReturnType<typeof setTimeout> | null = null;
  let scanGeneration = 0;
  let currentJobId = 0;
  let lastScanText = '';
  let lastScanOptions = { extract: true, unstringify: false };
  let candidates: JsonCandidateMeta[] = [];
  let selectedIndex: number | null = null;
  let formattedPreview = '';
  let fullFormatted = '';
  let previewTruncated = false;

  function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function getInputTextarea(): HTMLTextAreaElement | null {
    return document.querySelector<HTMLTextAreaElement>('#input');
  }

  function setLoading(loading: boolean) {
    loadingEl.classList.toggle('hidden', !loading);
    extractToggle.disabled = loading;
    unstringifyToggle.disabled = loading;
    copyBtn.disabled = loading || !fullFormatted;
    applyBtn.disabled = loading || !fullFormatted;
    if (loading) {
      loadingHintTimer = setTimeout(() => {
        loadingText.textContent = '대용량 처리 중…';
      }, LOADING_HINT_MS);
    } else if (loadingHintTimer) {
      clearTimeout(loadingHintTimer);
      loadingHintTimer = null;
      loadingText.textContent = '처리 중…';
    }
  }

  function renderStatus(warnings: string[]) {
    const parts: string[] = [];
    if (needsSizeWarning(sourceTa.value)) {
      parts.push('<span class="transform-warn">5MB 이상 — 미리보기가 제한됩니다.</span>');
    }
    warnings.forEach(w => {
      parts.push(`<span class="transform-info">${escapeHtml(w)}</span>`);
    });
    statusEl.innerHTML = parts.join(' ');
  }

  function renderCandidates() {
    candidateCount.textContent = candidates.length ? `(${candidates.length})` : '';
    if (candidates.length === 0) {
      candidateList.innerHTML = '<div class="transform-empty">후보 없음</div>';
      return;
    }

    candidateList.innerHTML = candidates.map(c => `
      <label class="transform-candidate-item ${selectedIndex === c.index ? 'selected' : ''}">
        <input type="radio" name="transformCandidate" value="${c.index}" ${selectedIndex === c.index ? 'checked' : ''}>
        <span class="transform-candidate-meta">#${c.index + 1} · L${c.line} · ${c.kind}</span>
        <span class="transform-candidate-preview">${escapeHtml(c.preview)}</span>
      </label>
    `).join('');

    candidateList.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach(radio => {
      radio.addEventListener('change', () => {
        selectedIndex = parseInt(radio.value, 10);
        renderCandidates();
        loadPreview(selectedIndex);
      });
    });
  }

  function renderPreviewText(text: string) {
    previewTruncated = false;
    fullFormatted = text;
    formattedPreview = text;

    if (text.length > PREVIEW_TRUNCATE_AT) {
      formattedPreview = text.slice(0, PREVIEW_SHOW_BYTES);
      previewTruncated = true;
    }

    if (formattedPreview.length > PREVIEW_FULL_MAX) {
      virtualScroller.setText(formattedPreview);
      previewEl.classList.add('virtual-active');
    } else {
      previewEl.classList.remove('virtual-active');
      virtualScroller.setText('');
      previewEl.textContent = formattedPreview;
    }

    if (previewTruncated) {
      const note = document.createElement('div');
      note.className = 'transform-preview-note';
      note.textContent = `미리보기 ${Math.round(PREVIEW_SHOW_BYTES / 1024)}KB만 표시됩니다. 복사/적용 시 전체 ${Math.round(text.length / 1024)}KB가 사용됩니다.`;
      previewWrap.querySelector('.transform-preview-note')?.remove();
      previewWrap.appendChild(note);
    } else {
      previewWrap.querySelector('.transform-preview-note')?.remove();
    }

    copyBtn.disabled = !fullFormatted;
    applyBtn.disabled = !fullFormatted;
  }

  async function loadPreview(index: number) {
    if (index < 0 || !lastScanText) return;
    setLoading(true);
    try {
      const formatted = await client.format(currentJobId, index, lastScanText, lastScanOptions);
      renderPreviewText(formatted);
    } catch (err) {
      previewEl.textContent = (err as Error).message;
      fullFormatted = '';
      copyBtn.disabled = true;
      applyBtn.disabled = true;
    } finally {
      setLoading(false);
    }
  }

  async function runScan() {
    const text = sourceTa.value;
    const options = {
      extract: extractToggle.checked,
      unstringify: unstringifyToggle.checked,
    };

    if (!options.extract && !options.unstringify) {
      candidates = [];
      selectedIndex = null;
      fullFormatted = '';
      renderCandidates();
      previewEl.textContent = '';
      statusEl.innerHTML = '<span class="transform-warn">Extract 또는 Unstringify를 선택하세요.</span>';
      copyBtn.disabled = true;
      applyBtn.disabled = true;
      return;
    }

    const guard = checkSizeGuard(text);
    if (!guard.ok) {
      statusEl.innerHTML = `<span class="transform-warn">${escapeHtml(guard.reason)}</span>`;
      candidates = [];
      renderCandidates();
      return;
    }

    const gen = ++scanGeneration;
    setLoading(true);
    fullFormatted = '';
    formattedPreview = '';

    try {
      const result = await client.scan(text, options);
      if (gen !== scanGeneration) return;

      currentJobId = result.jobId;
      lastScanText = text;
      lastScanOptions = options;
      candidates = result.candidates;
      renderStatus(result.warnings);

      if (candidates.length > 0) {
        selectedIndex = candidates[0].index;
      } else {
        selectedIndex = null;
        previewEl.textContent = '';
      }

      renderCandidates();

      if (selectedIndex !== null) {
        await loadPreview(selectedIndex);
      }
    } catch (err) {
      if (gen !== scanGeneration) return;
      if ((err as Error).message === 'Cancelled') return;
      statusEl.innerHTML = `<span class="transform-warn">${escapeHtml((err as Error).message)}</span>`;
    } finally {
      if (gen === scanGeneration) setLoading(false);
    }
  }

  function scheduleScan() {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runScan(), DEBOUNCE_MS);
  }

  const api: TransformModalApi = {
    async show(opts = {}) {
      const inputTa = getInputTextarea();
      const inputText = opts.initialText ?? (opts.source !== 'empty' && inputTa ? inputTa.value : '');
      let text = inputText;
      let usedClipboard = false;

      if (!text.trim() && opts.source !== 'empty') {
        try {
          const clip = await navigator.clipboard.readText();
          if (clip.trim()) {
            text = clip;
            usedClipboard = true;
          }
        } catch {
          // 클립보드 접근 불가
        }
      }

      sourceTa.value = text;

      const suggested = suggestDefaultOptions(text);
      extractToggle.checked = opts.extract ?? true;
      unstringifyToggle.checked = opts.unstringify ?? suggested.unstringify;

      if (needsSizeConfirm(text)) {
        if (!confirm('입력이 10MB를 초과합니다. 처리에 시간이 걸릴 수 있습니다. 계속하시겠습니까?')) {
          return;
        }
      }

      const guard = checkSizeGuard(text);
      if (!guard.ok) {
        alert(guard.reason);
        return;
      }

      overlay.classList.add('show');
      candidates = [];
      selectedIndex = null;
      fullFormatted = '';
      renderCandidates();
      previewEl.textContent = '';
      statusEl.innerHTML = usedClipboard
        ? '<span class="transform-info">Input이 비어 있어 클립보드 내용을 불러왔습니다.</span>'
        : '';
      scheduleScan();
      sourceTa.focus();
    },

    hide() {
      scanGeneration++;
      client.cancel();
      overlay.classList.remove('show');
    },
  };

  extractToggle.addEventListener('change', scheduleScan);
  unstringifyToggle.addEventListener('change', scheduleScan);
  sourceTa.addEventListener('input', scheduleScan);

  copyBtn.addEventListener('click', async () => {
    if (!fullFormatted) return;
    try {
      await navigator.clipboard.writeText(fullFormatted);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    } catch {
      alert('클립보드 복사에 실패했습니다.');
    }
  });

  applyBtn.addEventListener('click', () => {
    if (!fullFormatted) return;
    const inputTa = getInputTextarea();
    if (!inputTa) return;

    const snapshot = inputTa.value;
    inputTa.value = fullFormatted;
    inputTa.dispatchEvent(new Event('input', { bubbles: true }));

    onApply?.(() => {
      inputTa.value = snapshot;
      inputTa.dispatchEvent(new Event('input', { bubbles: true }));
    });
    api.hide();
  });

  const close = () => api.hide();
  cancelBtn.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && overlay.classList.contains('show')) {
      close();
    }
  });

  const el = overlay as unknown as ComponentElement<TransformModalApi>;
  el.api = api;
  return el;
}
