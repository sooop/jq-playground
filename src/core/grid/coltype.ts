export type ColType = 'number' | 'date' | 'string';

/** 숫자로 볼 수 있는 값인지. 천 단위 콤마, 선행 +/-, 백분율, 통화기호를 허용한다. */
export function looksNumeric(v: string): boolean {
  if (v === '') return false;
  const s = v.replace(/[,\s ]/g, '').replace(/^[$€£¥₩+]/, '').replace(/%$/, '');
  if (s === '' || s === '-' || s === '.') return false;
  return Number.isFinite(Number(s));
}

/** 숫자 파싱 — 정렬 키 계산에 쓴다. 숫자로 볼 수 없으면 NaN. */
export function parseNumeric(v: string): number {
  if (v === '') return NaN;
  let s = v.replace(/[,\s ]/g, '');
  let mul = 1;
  if (s.startsWith('(') && s.endsWith(')')) {
    s = s.slice(1, -1);
    mul = -1;
  }
  s = s.replace(/^[$€£¥₩+]/, '');
  if (s.endsWith('%')) {
    s = s.slice(0, -1);
    mul *= 0.01;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n * mul : NaN;
}

const DATE_RE = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** 날짜로 볼 수 있는 값인지. ISO 및 `2024/01/02`, `2024.01.02` 형태만 인정한다. */
export function looksDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  return !Number.isNaN(Date.parse(v.replace(/[./]/g, '-').replace(' ', 'T')));
}

/** 날짜 파싱 — 정렬 키용 epoch ms. 파싱 실패 시 NaN. */
export function parseDate(v: string): number {
  if (!DATE_RE.test(v)) return NaN;
  return Date.parse(v.replace(/[./]/g, '-').replace(' ', 'T'));
}

/**
 * 칼럼 타입 추론. 비어 있지 않은 값을 최대 `sampleLimit`개 훑어 90% 이상이 한 타입이면 그 타입.
 * 전 구간을 균등 샘플링해서(앞부분만 보지 않는다) 앞쪽 특이값에 속지 않게 한다.
 */
export function detectColType(
  rows: readonly string[][],
  col: number,
  sampleLimit = 200
): ColType {
  const n = rows.length;
  if (n === 0) return 'string';
  const step = Math.max(1, Math.floor(n / sampleLimit));
  let seen = 0;
  let num = 0;
  let date = 0;
  for (let i = 0; i < n && seen < sampleLimit; i += step) {
    const v = rows[i][col];
    if (v === undefined || v === '') continue;
    seen++;
    if (looksNumeric(v)) num++;
    else if (looksDate(v)) date++;
  }
  if (seen === 0) return 'string';
  if (num / seen >= 0.9) return 'number';
  if (date / seen >= 0.9) return 'date';
  return 'string';
}

/** 전체 헤더에 대해 열별 타입을 추론한다. */
export function detectColTypes(header: readonly string[], rows: readonly string[][]): ColType[] {
  return header.map((_, i) => detectColType(rows, i));
}
