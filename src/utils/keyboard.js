/**
 * Handle Tab key for textarea indentation
 * @param {KeyboardEvent} e
 */
export function handleTabKey(e) {
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
