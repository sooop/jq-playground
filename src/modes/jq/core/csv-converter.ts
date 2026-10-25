const MAX_DEPTH = 10;

type Flat = Record<string, string | number | boolean>

function flatten(obj: unknown, prefix = '', depth = 0): Flat {
  const flattened: Flat = {};
  if (obj === null || typeof obj !== 'object') return flattened;
  const src = obj as Record<string, unknown>;

  for (const key in src) {
    const value = src[key];
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
      flattened[newKey] = value as string | number | boolean;
    }
  }
  return flattened;
}

export interface Matrix {
  header: string[];
  rows: string[][];
}

/**
 * JSON 값을 표 형태의 header/rows 매트릭스로 변환한다.
 * 배열이 아니면 단일 행으로 감싼다. 행 수 제한은 없다 — DataGrid의 가상 스크롤이 담당한다.
 */
export function jsonToMatrix(data: unknown): Matrix {
  const wasArray = Array.isArray(data);
  const list = wasArray ? (data as unknown[]) : [data];

  if (list.length === 0) {
    return { header: [], rows: [] };
  }

  const flatRows = list.map(item => flatten(item));
  const header = [...new Set(flatRows.flatMap(row => Object.keys(row)))].sort();

  const rows = flatRows.map(row =>
    header.map(key => (row[key] !== undefined ? String(row[key]) : ''))
  );

  return { header, rows };
}

/** 필드 하나를 RFC-4180 규칙으로 인용한다. */
function quoteField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

export function matrixToCSV(header: string[], rows: string[][]): string {
  if (header.length === 0) return '';
  let csv = header.map(k => quoteField(k)).join(',') + '\n';
  for (const row of rows) {
    csv += row.map(v => quoteField(v)).join(',') + '\n';
  }
  return csv;
}

/** 폴백 경로 호환용 (Worker 없이 직접 JSON → CSV 텍스트 변환) */
export function jsonToCSV(data: unknown): string {
  const { header, rows } = jsonToMatrix(data);
  return matrixToCSV(header, rows);
}
