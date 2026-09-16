import { VirtualScroller } from '../utils/virtual-scroller';
import {
  createPreprocessClient,
  checkSizeGuard,
  needsSizeConfirm,
  needsSizeWarning,
} from '../utils/json-preprocess-client';
import type { JsonCandidateMeta } from '../utils/json-preprocessor';
import {
  allKeys,
  pruneOrphans,
  withAncestors,
  type StringifiedNode,
} from '../utils/stringified-fields';
import type { ComponentElement, TransformModalApi } from '../types';

const PREVIEW_FULL_MAX = 200 * 1024;
const PREVIEW_TRUNCATE_AT = 2 * 1024 * 1024;
const PREVIEW_SHOW_BYTES = 50 * 1024;
const DEBOUNCE_MS = 300;
const PREVIEW_DEBOUNCE_MS = 120;
const LOADING_HINT_MS = 500;

// 필드 목록 가상 스크롤
const ROW_HEIGHT = 24;
const ROW_OVERSCAN = 8;
const FIELD_INDENT = 14;

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
          <label class="transform-toggle" id="preserveFormatLabel" title="선택한 필드의 구간만 교체하고 나머지 공백·줄바꿈은 그대로 둡니다"><input type="checkbox" id="preserveFormatToggle"> 원본 포맷 유지</label>
        </div>
        <div class="transform-status" id="transformStatus"></div>
        <div class="transform-candidates-section" id="candidatesSection">
          <div class="transform-section-label">Candidates <span id="candidateCount"></span></div>
          <div class="transform-candidate-list" id="candidateList"></div>
        </div>
        <div class="transform-fields-section" id="fieldsSection">
          <div class="transform-section-label">
            Stringified values <span id="fieldCount"></span>
            <span class="transform-field-actions">
              <button type="button" id="fieldSelectAllBtn">전체선택</button>
              <button type="button" id="fieldClearAllBtn">전체해제</button>
            </span>
          </div>
          <div class="transform-field-list" id="fieldList">
            <div class="transform-field-spacer" id="fieldSpacer">
              <div class="transform-field-rows" id="fieldRows"></div>
            </div>
            <div class="transform-empty" id="fieldEmpty">풀 수 있는 문자열 값이 없습니다</div>
          </div>
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
  const preserveToggle = overlay.querySelector<HTMLInputElement>('#preserveFormatToggle')!;
  const preserveLabel = overlay.querySelector<HTMLElement>('#preserveFormatLabel')!;
  const statusEl = overlay.querySelector<HTMLElement>('#transformStatus')!;
  const candidatesSection = overlay.querySelector<HTMLElement>('#candidatesSection')!;
  const candidateList = overlay.querySelector<HTMLElement>('#candidateList')!;
  const candidateCount = overlay.querySelector<HTMLElement>('#candidateCount')!;
  const fieldList = overlay.querySelector<HTMLElement>('#fieldList')!;
  const fieldSpacer = overlay.querySelector<HTMLElement>('#fieldSpacer')!;
  const fieldRows = overlay.querySelector<HTMLElement>('#fieldRows')!;
  const fieldEmpty = overlay.querySelector<HTMLElement>('#fieldEmpty')!;
  const fieldCount = overlay.querySelector<HTMLElement>('#fieldCount')!;
  const selectAllBtn = overlay.querySelector<HTMLButtonElement>('#fieldSelectAllBtn')!;
  const clearAllBtn = overlay.querySelector<HTMLButtonElement>('#fieldClearAllBtn')!;
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
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  let loadingHintTimer: ReturnType<typeof setTimeout> | null = null;
  let scanGeneration = 0;
  let currentJobId = 0;
  let candidates: JsonCandidateMeta[] = [];
  let selectedIndex: number | null = null;

  let fieldNodes: StringifiedNode[] = [];
  let selectedKeys = new Set<string>();
  let spansAvailable = false;
  let scanWarnings: string[] = [];
  let fieldWarnings: string[] = [];
  let pendingFocusPaths: string[] | null = null;

  let formattedPreview = '';
  let fullFormatted = '';
  let previewTruncated = false;

  function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function getInputTextarea(): HTMLTextAreaElement | null {
    return document.querySelector<HTMLTextAreaElement>('#input');
  }

  function formatBytes(n: number): string {
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)}K`;
    return `${(n / (1024 * 1024)).toFixed(1)}M`;
  }

  function setLoading(loading: boolean) {
    loadingEl.classList.toggle('hidden', !loading);
    extractToggle.disabled = loading;
    preserveToggle.disabled = loading || !spansAvailable;
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

  function renderStatus() {
    const parts: string[] = [];
    if (needsSizeWarning(sourceTa.value)) {
      parts.push('<span class="transform-warn">5MB 이상 — 미리보기가 제한됩니다.</span>');
    }
    if (!spansAvailable && fieldNodes.length > 0) {
      parts.push('<span class="transform-info">이 문서는 원본 포맷 유지를 쓸 수 없어 전체 재직렬화로 출력합니다.</span>');
    }
    [...scanWarnings, ...fieldWarnings].forEach(w => {
      parts.push(`<span class="transform-info">${escapeHtml(w)}</span>`);
    });
    statusEl.innerHTML = parts.join(' ');
  }

  /* ---------------- Candidates ---------------- */

  function renderCandidates() {
    const useExtract = extractToggle.checked;
    candidatesSection.classList.toggle('hidden', !useExtract);
    if (!useExtract) return;

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
        void loadFields();
      });
    });
  }

  /* ---------------- Stringified fields ---------------- */

  function fieldBadge(node: StringifiedNode): string {
    if (node.decode === 'ndjson') return `ndjson ×${node.lineCount ?? 0}`;
    if (node.decode === 'url') return `url ${node.kind}`;
    return node.kind;
  }

  function renderFieldRows() {
    const total = fieldNodes.length;
    fieldEmpty.classList.toggle('hidden', total > 0);
    fieldSpacer.style.height = `${total * ROW_HEIGHT}px`;

    if (total === 0) {
      fieldRows.innerHTML = '';
      return;
    }

    const viewport = fieldList.clientHeight || ROW_HEIGHT * 8;
    const first = Math.max(0, Math.floor(fieldList.scrollTop / ROW_HEIGHT) - ROW_OVERSCAN);
    const last = Math.min(total, Math.ceil((fieldList.scrollTop + viewport) / ROW_HEIGHT) + ROW_OVERSCAN);

    fieldRows.style.transform = `translateY(${first * ROW_HEIGHT}px)`;
    fieldRows.innerHTML = fieldNodes.slice(first, last).map((node, offset) => {
      const idx = first + offset;
      const checked = selectedKeys.has(node.key) ? 'checked' : '';
      const indent = 6 + node.depth * FIELD_INDENT;
      const label = node.fallbackRoot ? '. (문서 전체)' : node.path;
      return `<label class="transform-field-row" style="height:${ROW_HEIGHT}px;padding-left:${indent}px" title="${escapeHtml(node.preview)}">
        <input type="checkbox" data-idx="${idx}" ${checked}>
        <span class="transform-field-path">${escapeHtml(label)}</span>
        <span class="transform-field-badge">${escapeHtml(fieldBadge(node))}</span>
        <span class="transform-field-size">${formatBytes(node.rawSize)}</span>
      </label>`;
    }).join('');
  }

  function renderFieldSection() {
    fieldCount.textContent = fieldNodes.length
      ? `(${selectedKeys.size}/${fieldNodes.length})`
      : '';
    selectAllBtn.disabled = fieldNodes.length === 0;
    clearAllBtn.disabled = fieldNodes.length === 0;
    renderFieldRows();
  }

  function setSelection(next: Set<string>) {
    selectedKeys = next;
    renderFieldSection();
    schedulePreview();
  }

  function defaultSelection(nodes: StringifiedNode[]): Set<string> {
    if (pendingFocusPaths && pendingFocusPaths.length > 0) {
      const wanted = new Set(pendingFocusPaths);
      const picked = new Set(nodes.filter(n => wanted.has(n.path)).map(n => n.key));
      pendingFocusPaths = null;
      if (picked.size > 0) return withAncestors(nodes, picked);
    }
    pendingFocusPaths = null;
    return allKeys(nodes);
  }

  fieldList.addEventListener('scroll', renderFieldRows, { passive: true });

  fieldList.addEventListener('change', (e) => {
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;
    const idx = parseInt(target.dataset['idx'] ?? '', 10);
    const node = fieldNodes[idx];
    if (!node) return;

    const next = new Set(selectedKeys);
    if (target.checked) {
      next.add(node.key);
      setSelection(withAncestors(fieldNodes, next));
    } else {
      next.delete(node.key);
      setSelection(pruneOrphans(fieldNodes, next));
    }
  });

  selectAllBtn.addEventListener('click', () => setSelection(allKeys(fieldNodes)));
  clearAllBtn.addEventListener('click', () => setSelection(new Set()));

  /* ---------------- Preview ---------------- */

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

  function clearPreview() {
    fullFormatted = '';
    formattedPreview = '';
    previewEl.classList.remove('virtual-active');
    virtualScroller.setText('');
    previewEl.textContent = '';
    previewWrap.querySelector('.transform-preview-note')?.remove();
    copyBtn.disabled = true;
    applyBtn.disabled = true;
  }

  async function loadPreview() {
    const gen = scanGeneration;
    setLoading(true);
    try {
      const formatted = await client.render(
        currentJobId,
        [...selectedKeys],
        preserveToggle.checked && spansAvailable
      );
      if (gen !== scanGeneration) return;
      renderPreviewText(formatted);
    } catch (err) {
      if (gen !== scanGeneration) return;
      previewEl.textContent = (err as Error).message;
      clearPreview();
    } finally {
      if (gen === scanGeneration) setLoading(false);
    }
  }

  function schedulePreview() {
    if (previewTimer !== null) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => void loadPreview(), PREVIEW_DEBOUNCE_MS);
  }

  /* ---------------- Scan pipeline ---------------- */

  async function loadFields() {
    const gen = scanGeneration;
    const candidateIndex = extractToggle.checked ? selectedIndex : null;

    if (extractToggle.checked && candidateIndex === null) {
      fieldNodes = [];
      selectedKeys = new Set();
      spansAvailable = false;
      fieldWarnings = [];
      renderFieldSection();
      renderStatus();
      clearPreview();
      return;
    }

    setLoading(true);
    try {
      const result = await client.fields(currentJobId, candidateIndex);
      if (gen !== scanGeneration) return;

      fieldNodes = result.nodes;
      spansAvailable = result.spansAvailable;
      fieldWarnings = result.warnings;
      selectedKeys = defaultSelection(fieldNodes);

      preserveToggle.disabled = !spansAvailable;
      preserveLabel.classList.toggle('disabled', !spansAvailable);

      renderFieldSection();
      renderStatus();
      await loadPreview();
    } catch (err) {
      if (gen !== scanGeneration) return;
      fieldNodes = [];
      selectedKeys = new Set();
      fieldWarnings = [(err as Error).message];
      renderFieldSection();
      renderStatus();
      clearPreview();
    } finally {
      if (gen === scanGeneration) setLoading(false);
    }
  }

  async function runScan() {
    const text = sourceTa.value;
    // Extract를 끄면 후보 목록이 필요 없다. 문서 전체를 대상으로 필드 스캔만 돌린다.
    // (Extract가 켜져 있을 때 unstringify:true는 escape된 span도 후보로 복구해 준다)
    const options = { extract: extractToggle.checked, unstringify: extractToggle.checked };

    const guard = checkSizeGuard(text);
    if (!guard.ok) {
      statusEl.innerHTML = `<span class="transform-warn">${escapeHtml(guard.reason)}</span>`;
      candidates = [];
      fieldNodes = [];
      renderCandidates();
      renderFieldSection();
      clearPreview();
      return;
    }

    const gen = ++scanGeneration;
    setLoading(true);
    clearPreview();

    try {
      const result = await client.scan(text, options);
      if (gen !== scanGeneration) return;

      currentJobId = result.jobId;
      candidates = result.candidates;
      scanWarnings = options.extract ? result.warnings : [];

      selectedIndex = candidates.length > 0 ? candidates[0].index : null;
      renderCandidates();
      renderStatus();

      await loadFields();
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
    debounceTimer = setTimeout(() => void runScan(), DEBOUNCE_MS);
  }

  /* ---------------- Public API ---------------- */

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
      extractToggle.checked = opts.extract ?? true;
      preserveToggle.checked = opts.preserveFormat ?? false;
      pendingFocusPaths = opts.focusPaths ?? null;

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
      fieldNodes = [];
      selectedKeys = new Set();
      spansAvailable = false;
      scanWarnings = [];
      fieldWarnings = [];
      renderCandidates();
      renderFieldSection();
      clearPreview();
      statusEl.innerHTML = usedClipboard
        ? '<span class="transform-info">Input이 비어 있어 클립보드 내용을 불러왔습니다.</span>'
        : '';
      scheduleScan();
      sourceTa.focus();
    },

    hide() {
      scanGeneration++;
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      if (previewTimer !== null) clearTimeout(previewTimer);
      client.cancel();
      overlay.classList.remove('show');
    },
  };

  extractToggle.addEventListener('change', scheduleScan);
  preserveToggle.addEventListener('change', () => schedulePreview());
  sourceTa.addEventListener('input', () => {
    pendingFocusPaths = null;
    scheduleScan();
  });

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
