/**
 * 텍스트에서 유효한 JSON 객체들을 추출합니다.
 * @param {string} text - 추출할 텍스트
 * @returns {string|null} - 추출된 JSON 문자열 (여러 개면 배열, 하나면 단일 객체, 없으면 null)
 */
export function extractJson(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const jsonObjects = [];
  let depth = 0;
  let startIndex = -1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '{') {
      if (depth === 0) {
        startIndex = i;
      }
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0 && startIndex !== -1) {
        // 가능한 JSON 객체 발견
        const candidate = text.substring(startIndex, i + 1);
        try {
          const parsed = JSON.parse(candidate);
          jsonObjects.push(parsed);
        } catch {
          // 유효하지 않은 JSON, 무시
        }
        startIndex = -1;
      }
    }
  }

  if (jsonObjects.length === 0) {
    return null;
  }

  if (jsonObjects.length === 1) {
    return JSON.stringify(jsonObjects[0], null, 2);
  }

  return JSON.stringify(jsonObjects, null, 2);
}

/**
 * 텍스트가 JSON 추출이 필요한지 확인합니다.
 * @param {string} text - 확인할 텍스트
 * @returns {boolean} - JSON 추출이 필요하면 true
 */
export function needsJsonExtraction(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }

  // 이미 유효한 JSON이면 추출 불필요
  try {
    JSON.parse(text.trim());
    return false;
  } catch {
    // JSON이 아니지만 { }가 포함되어 있으면 추출 필요
    return text.includes('{') && text.includes('}');
  }
}

/**
 * JSON 문자열을 포맷팅합니다. 유효하지 않으면 원본을 반환합니다.
 * @param {string} text - 포맷팅할 텍스트
 * @returns {string} - 포맷팅된 JSON 또는 원본 텍스트
 */
export function tryFormatJson(text) {
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}
