const MAX_TABLE_ROWS = 1000;
const MAX_DEPTH = 10;

function flatten(obj, prefix = '', depth = 0) {
  const flattened = {};

  for (const key in obj) {
    const value = obj[key];
    const newKey = prefix ? `${prefix}_${key}` : key;

    if (value === null || value === undefined) {
      flattened[newKey] = '';
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      if (depth < MAX_DEPTH) {
        Object.assign(flattened, flatten(value, newKey, depth + 1));
      } else {
        flattened[newKey] = JSON.stringify(value);
      }
    } else if (Array.isArray(value)) {
      flattened[newKey] = JSON.stringify(value);
    } else {
      flattened[newKey] = value;
    }
  }
  return flattened;
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

export function jsonToHTML(data, isActualArray = true) {
  const wasArray = Array.isArray(data);

  if (!wasArray) {
    data = [data];
  }

  if (data.length === 0) {
    return '<div>No data</div>';
  }

  let warningMsg = '';

  // Slice first, then flatten (optimize for large datasets)
  const totalRows = data.length;
  let displayData = data;

  if (totalRows > MAX_TABLE_ROWS) {
    warningMsg = `<div style="background: #fff3f3; border: 1px solid #ddd; padding: 12px; margin-bottom: 12px; font-size: 12px; color: #d33; border-radius: 4px;">
      ⚠️ 데이터가 너무 많습니다. 테이블에 첫 ${MAX_TABLE_ROWS}행만 표시됩니다. (총 ${totalRows}행)
      <br/>전체 데이터는 <strong>Download</strong> 버튼으로 CSV 파일로 다운로드하세요.
    </div>`;
    displayData = data.slice(0, MAX_TABLE_ROWS);
  }

  // Only flatten the data we'll display (max 1000 rows)
  const rows = [];
  for (const item of displayData) {
    const flattened = flatten(item);
    rows.push(flattened);
  }

  if (rows.length === 0) {
    return '<div>No data</div>';
  }

  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))].sort();

  let html = warningMsg + '<table><thead><tr>';
  keys.forEach(key => {
    html += `<th>${escapeHtml(key)}</th>`;
  });
  html += '</tr></thead><tbody>';

  rows.forEach(row => {
    html += '<tr>';
    keys.forEach(key => {
      const value = row[key] !== undefined ? row[key] : '';
      html += `<td>${escapeHtml(String(value))}</td>`;
    });
    html += '</tr>';
  });

  html += '</tbody></table>';
  return html;
}

export function jsonToCSV(data) {
  if (!Array.isArray(data)) {
    data = [data];
  }

  if (data.length === 0) {
    return '';
  }

  const rows = [];
  for (const item of data) {
    const flattened = flatten(item);
    rows.push(flattened);
  }

  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))].sort();

  let csv = keys.map(k => `"${k.replace(/"/g, '""')}"`).join(',') + '\n';

  rows.forEach(row => {
    const cells = keys.map(key => {
      let value = row[key] !== undefined ? String(row[key]) : '';
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        value = '"' + value.replace(/"/g, '""') + '"';
      }
      return value;
    });
    csv += cells.join(',') + '\n';
  });

  return csv;
}
