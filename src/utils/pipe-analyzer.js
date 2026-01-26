/**
 * jq Pipe Chain Analyzer
 * Parses pipe segments considering bracket/parenthesis depth
 */
export class PipeAnalyzer {
  /**
   * Analyze query at cursor position
   * @param {string} query - Full query
   * @param {number} cursor - Cursor position
   * @returns {Object} Analysis result
   */
  static analyze(query, cursor) {
    const beforeCursor = query.substring(0, cursor);
    const segments = this.splitByPipes(beforeCursor);
    const lastSegment = segments[segments.length - 1] || '';

    // Analyze function context in last segment
    const funcContext = this.analyzeFunctionContext(lastSegment);

    return {
      segments,
      currentSegment: lastSegment,
      completedQuery: segments.slice(0, -1).join(' | '),
      depth: segments.length - 1,
      ...funcContext
    };
  }

  /**
   * Split query by pipes considering parenthesis depth
   * @param {string} query - Query string
   * @returns {string[]} Array of segments
   */
  static splitByPipes(query) {
    const segments = [];
    let current = '';
    let parenDepth = 0;
    let bracketDepth = 0;
    let inString = false;
    let stringChar = '';

    for (let i = 0; i < query.length; i++) {
      const char = query[i];
      const prevChar = query[i - 1];

      // String handling
      if ((char === '"' || char === "'") && prevChar !== '\\') {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
        }
      }

      if (!inString) {
        if (char === '(') parenDepth++;
        else if (char === ')') parenDepth--;
        else if (char === '[') bracketDepth++;
        else if (char === ']') bracketDepth--;

        // Only split on pipe at depth 0
        if (char === '|' && parenDepth === 0 && bracketDepth === 0) {
          if (current.trim()) segments.push(current.trim());
          current = '';
          continue;
        }
      }

      current += char;
    }

    if (current.trim()) segments.push(current.trim());
    return segments;
  }

  /**
   * Analyze function context in a segment
   * Detects patterns like map(.field), select(.field > 0), etc.
   * @param {string} segment - Current segment
   * @returns {Object} Function context info
   */
  static analyzeFunctionContext(segment) {
    // Match functions that operate on each element: map(.field), select(.field), sort_by(.field), etc.
    // Pattern: function_name( followed by optional whitespace, then a field path starting with .
    const funcMatch = segment.match(
      /^(map|select|sort_by|group_by|unique_by|min_by|max_by|map_values|any|all|first|last|until|while|recurse_down)\s*\(\s*(\.[\w.[\]]*)?$/
    );

    if (funcMatch) {
      return {
        isInsideFunction: true,
        functionName: funcMatch[1],
        fieldPath: funcMatch[2] || '.'
      };
    }

    // Check for nested function calls like: map(select(.field
    const nestedMatch = segment.match(
      /(?:map|select|sort_by|group_by|unique_by|min_by|max_by|map_values)\s*\([^)]*(?:map|select|sort_by|group_by|unique_by|min_by|max_by|map_values)\s*\(\s*(\.[\w.[\]]*)?$/
    );

    if (nestedMatch) {
      return {
        isInsideFunction: true,
        functionName: 'nested',
        fieldPath: nestedMatch[1] || '.'
      };
    }

    // Not inside a function, extract field path from segment
    const fieldMatch = segment.match(/^\s*(\.[\w.[\]]*)?$/);

    return {
      isInsideFunction: false,
      functionName: null,
      fieldPath: fieldMatch ? (fieldMatch[1] || segment) : segment
    };
  }

  /**
   * Check if segment has array access
   * @param {string} segment - Segment to check
   * @returns {boolean}
   */
  static hasArrayAccess(segment) {
    return /\[\]|\[\d+\]/.test(segment);
  }

  /**
   * Get the transformation applied by a segment
   * @param {string} segment - Segment to analyze
   * @returns {Object} Transformation info
   */
  static getSegmentTransformation(segment) {
    const trimmed = segment.trim();

    // Array iteration
    if (trimmed === '.[]' || trimmed.endsWith('[]')) {
      return { type: 'iterate', unwrapsArray: true };
    }

    // Array indexing
    if (/\[\d+\]$/.test(trimmed)) {
      return { type: 'index', unwrapsArray: true };
    }

    // map produces array
    if (trimmed.startsWith('map(') || trimmed.startsWith('map_values(')) {
      return { type: 'map', producesArray: true };
    }

    // select filters but preserves structure
    if (trimmed.startsWith('select(')) {
      return { type: 'filter', preservesStructure: true };
    }

    // group_by produces array of arrays
    if (trimmed.startsWith('group_by(')) {
      return { type: 'group', producesNestedArray: true };
    }

    // sort_by preserves array
    if (trimmed.startsWith('sort_by(') || trimmed.startsWith('unique_by(')) {
      return { type: 'sort', preservesArray: true };
    }

    // Field access
    if (trimmed.startsWith('.')) {
      return { type: 'field', accessesField: true };
    }

    return { type: 'unknown' };
  }
}
