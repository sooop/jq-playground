/**
 * Virtual Scroller for large text output.
 * Only renders visible lines + buffer, using a fixed line-height monospace layout.
 *
 * ┌─ scroll-container (overflow-y: auto, fixed height) ──────┐
 * │ ┌─ spacer (height = totalLines × lineHeight) ────────┐   │
 * │ │  ┌─ content-viewport (absolute positioning) ────┐   │   │
 * │ │  │  visible lines + buffer                      │   │   │
 * │ │  └─────────────────────────────────────────────┘   │   │
 * │ └─────────────────────────────────────────────────────┘   │
 * └───────────────────────────────────────────────────────────┘
 */

const LINE_HEIGHT = 18; // px, matches monospace font
const BUFFER_LINES = 30; // extra lines above/below viewport
const ACTIVATION_THRESHOLD = 5000; // lines; below this, render directly

export class VirtualScroller {
  /**
   * @param {HTMLElement} container - The scroll container element
   */
  constructor(container) {
    this.container = container;
    this.lines = [];
    this.totalLines = 0;
    this.active = false; // whether virtual scrolling is active

    // DOM elements
    this.spacer = document.createElement('div');
    this.spacer.style.position = 'relative';
    this.spacer.style.width = '100%';

    this.viewport = document.createElement('div');
    this.viewport.className = 'virtual-viewport';
    this.viewport.style.position = 'absolute';
    this.viewport.style.left = '0';
    this.viewport.style.right = '0';
    this.viewport.style.willChange = 'transform';

    this.spacer.appendChild(this.viewport);

    // State
    this._startLine = 0;
    this._endLine = 0;
    this._rafId = null;
    this._searchHighlightLines = null; // Set<number> of highlighted line indices
    this._searchQuery = null;
    this._currentMatchIndex = -1;
    this._allMatches = []; // [{lineIndex, start, end, text}]

    // Scroll handler
    this._onScroll = () => {
      if (this._rafId) return;
      this._rafId = requestAnimationFrame(() => {
        this._rafId = null;
        this._render();
      });
    };
  }

  /**
   * Set lines and activate/deactivate virtual scrolling.
   * @param {string[]} lines - Array of text lines
   */
  setLines(lines) {
    this.lines = lines;
    this.totalLines = lines.length;
    this._searchQuery = null;
    this._allMatches = [];
    this._currentMatchIndex = -1;

    if (this.totalLines >= ACTIVATION_THRESHOLD) {
      this._activate();
    } else {
      this._deactivate();
    }
  }

  /**
   * Set text content (will split into lines).
   * @param {string} text - Full text content
   */
  setText(text) {
    this.setLines(text.split('\n'));
  }

  _activate() {
    this.active = true;

    // Clear container and set up virtual scrolling DOM
    this.container.innerHTML = '';
    this.container.style.overflowY = 'auto';
    this.container.appendChild(this.spacer);

    // Set spacer height
    this.spacer.style.height = (this.totalLines * LINE_HEIGHT) + 'px';

    // Bind scroll listener
    this.container.addEventListener('scroll', this._onScroll, { passive: true });

    // Ctrl+A handler — copy all to clipboard
    this._onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        const fullText = this.lines.join('\n');
        navigator.clipboard.writeText(fullText).catch(() => {});
      }
    };
    this.container.addEventListener('keydown', this._onKeyDown);

    // Initial render
    this._render();
  }

  _deactivate() {
    if (this.active) {
      this.container.removeEventListener('scroll', this._onScroll);
      if (this._onKeyDown) {
        this.container.removeEventListener('keydown', this._onKeyDown);
      }
    }
    this.active = false;

    // Direct rendering for small content
    this.container.innerHTML = '';
    if (this.totalLines > 0) {
      this.container.textContent = this.lines.join('\n');
    }
  }

  _render() {
    if (!this.active) return;

    const scrollTop = this.container.scrollTop;
    const viewportHeight = this.container.clientHeight;

    const startLine = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - BUFFER_LINES);
    const visibleLines = Math.ceil(viewportHeight / LINE_HEIGHT);
    const endLine = Math.min(this.totalLines, startLine + visibleLines + BUFFER_LINES * 2);

    // Skip if range unchanged
    if (startLine === this._startLine && endLine === this._endLine) return;
    this._startLine = startLine;
    this._endLine = endLine;

    // Position viewport
    this.viewport.style.top = (startLine * LINE_HEIGHT) + 'px';

    // Render lines
    if (this._searchQuery && this._allMatches.length > 0) {
      this._renderWithHighlight(startLine, endLine);
    } else {
      this._renderPlain(startLine, endLine);
    }
  }

  _renderPlain(startLine, endLine) {
    const fragment = document.createDocumentFragment();
    for (let i = startLine; i < endLine; i++) {
      const lineEl = document.createElement('div');
      lineEl.className = 'vline';
      lineEl.style.height = LINE_HEIGHT + 'px';
      lineEl.style.lineHeight = LINE_HEIGHT + 'px';
      lineEl.textContent = this.lines[i];
      fragment.appendChild(lineEl);
    }
    this.viewport.innerHTML = '';
    this.viewport.appendChild(fragment);
  }

  _renderWithHighlight(startLine, endLine) {
    const fragment = document.createDocumentFragment();
    const visibleMatches = this._allMatches.filter(
      m => m.lineIndex >= startLine && m.lineIndex < endLine
    );

    // Group matches by line
    const matchesByLine = new Map();
    for (const m of visibleMatches) {
      if (!matchesByLine.has(m.lineIndex)) {
        matchesByLine.set(m.lineIndex, []);
      }
      matchesByLine.get(m.lineIndex).push(m);
    }

    for (let i = startLine; i < endLine; i++) {
      const lineEl = document.createElement('div');
      lineEl.className = 'vline';
      lineEl.style.height = LINE_HEIGHT + 'px';
      lineEl.style.lineHeight = LINE_HEIGHT + 'px';

      const lineMatches = matchesByLine.get(i);
      if (lineMatches) {
        const line = this.lines[i];
        let html = '';
        let lastIdx = 0;
        for (const m of lineMatches) {
          html += this._escapeHtml(line.substring(lastIdx, m.start));
          const isCurrent = m.globalIndex === this._currentMatchIndex;
          const cls = isCurrent ? 'search-highlight current' : 'search-highlight';
          html += `<span class="${cls}">${this._escapeHtml(m.text)}</span>`;
          lastIdx = m.end;
        }
        html += this._escapeHtml(line.substring(lastIdx));
        lineEl.innerHTML = html;
      } else {
        lineEl.textContent = this.lines[i];
      }
      fragment.appendChild(lineEl);
    }
    this.viewport.innerHTML = '';
    this.viewport.appendChild(fragment);
  }

  _escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Perform search across all lines.
   * @param {string} query - Search term
   * @returns {{total: number}} Match count info
   */
  search(query) {
    this._allMatches = [];
    this._currentMatchIndex = -1;
    this._searchQuery = query;

    if (!query) {
      this._render();
      return { total: 0 };
    }

    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedQuery, 'gi');
    let globalIdx = 0;

    for (let i = 0; i < this.totalLines; i++) {
      const line = this.lines[i];
      let match;
      regex.lastIndex = 0;
      while ((match = regex.exec(line)) !== null) {
        this._allMatches.push({
          lineIndex: i,
          start: match.index,
          end: match.index + match[0].length,
          text: match[0],
          globalIndex: globalIdx++
        });
      }
    }

    if (this._allMatches.length > 0) {
      this._currentMatchIndex = 0;
    }

    // Force re-render
    this._startLine = -1;
    this._render();

    return { total: this._allMatches.length };
  }

  /**
   * Navigate to next match.
   * @returns {number} Current match index (0-based), or -1
   */
  nextMatch() {
    if (this._allMatches.length === 0) return -1;
    this._currentMatchIndex = (this._currentMatchIndex + 1) % this._allMatches.length;
    this._scrollToCurrentMatch();
    return this._currentMatchIndex;
  }

  /**
   * Navigate to previous match.
   * @returns {number} Current match index (0-based), or -1
   */
  prevMatch() {
    if (this._allMatches.length === 0) return -1;
    this._currentMatchIndex = (this._currentMatchIndex - 1 + this._allMatches.length) % this._allMatches.length;
    this._scrollToCurrentMatch();
    return this._currentMatchIndex;
  }

  _scrollToCurrentMatch() {
    if (this._currentMatchIndex < 0 || this._currentMatchIndex >= this._allMatches.length) return;

    const match = this._allMatches[this._currentMatchIndex];
    const targetScrollTop = match.lineIndex * LINE_HEIGHT - this.container.clientHeight / 2;
    this.container.scrollTop = Math.max(0, targetScrollTop);

    // Force re-render to update highlight
    this._startLine = -1;
    this._render();
  }

  /**
   * Get current match info for display.
   * @returns {{current: number, total: number}|null}
   */
  getMatchInfo() {
    if (this._allMatches.length === 0) return null;
    return {
      current: this._currentMatchIndex + 1,
      total: this._allMatches.length
    };
  }

  /**
   * Get all text (for copy operations).
   * @returns {string}
   */
  getFullText() {
    return this.lines.join('\n');
  }

  /**
   * Clean up event listeners.
   */
  destroy() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
    }
    this.container.removeEventListener('scroll', this._onScroll);
    if (this._onKeyDown) {
      this.container.removeEventListener('keydown', this._onKeyDown);
    }
  }
}
