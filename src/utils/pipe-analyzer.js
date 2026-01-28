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

    // Analyze object construction context
    const objectContext = this.analyzeObjectConstruction(lastSegment);

    // Calculate completedQuery (all segments before current)
    const completedSegments = segments.slice(0, -1);
    const completedQuery = completedSegments.join(' | ');

    // Calculate effectiveContextQuery (handles 'as $var' bindings)
    const effectiveContextQuery = this.calculateEffectiveContextQuery(completedSegments);

    return {
      segments,
      currentSegment: lastSegment,
      completedQuery,
      effectiveContextQuery,
      depth: segments.length - 1,
      ...funcContext,
      ...objectContext
    };
  }

  /**
   * Parse 'EXPR as $var' binding pattern
   * @param {string} segment - Segment to parse
   * @returns {Object|null} Binding info or null
   */
  static parseAsBinding(segment) {
    // Match "EXPR as $var" pattern - capture EXPR and variable name
    const match = segment.match(/^(.+?)\s+as\s+(\$\w+)\s*$/);
    return match ? { expression: match[1].trim(), variable: match[2] } : null;
  }

  /**
   * Calculate effective context query by handling 'as $var' bindings
   * In jq, "EXPR as $var" binds EXPR result to $var but passes original input through
   * So for context, we need the query BEFORE the 'as' segment
   * @param {string[]} completedSegments - Array of completed segments
   * @returns {string} Effective context query
   */
  static calculateEffectiveContextQuery(completedSegments) {
    if (completedSegments.length === 0) return '';

    // Check if last completed segment has 'as $var' binding
    const lastSegment = completedSegments[completedSegments.length - 1];
    const binding = this.parseAsBinding(lastSegment);

    if (binding) {
      // Remove the entire 'as' segment - context is from segments before it
      const effectiveSegments = completedSegments.slice(0, -1);
      return effectiveSegments.join(' | ');
    }

    return completedSegments.join(' | ');
  }

  /**
   * Analyze object construction syntax in a segment
   * Detects patterns like {name, age}, {key: .field}, {name, username: .name}
   * @param {string} segment - Current segment
   * @returns {Object} Object construction context
   */
  static analyzeObjectConstruction(segment) {
    const result = {
      isInsideObjectConstruction: false,
      isAfterColon: false,
      isShorthandPosition: false,
      incompleteField: ''
    };

    // Find the last unmatched opening brace
    let braceDepth = 0;
    let lastOpenBraceIndex = -1;
    let inString = false;
    let stringChar = '';

    for (let i = 0; i < segment.length; i++) {
      const char = segment[i];
      const prevChar = segment[i - 1];

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
        if (char === '{') {
          braceDepth++;
          lastOpenBraceIndex = i;
        } else if (char === '}') {
          braceDepth--;
          if (braceDepth === 0) lastOpenBraceIndex = -1;
        }
      }
    }

    // Not inside object construction
    if (braceDepth <= 0 || lastOpenBraceIndex === -1) {
      return result;
    }

    result.isInsideObjectConstruction = true;

    // Analyze content after the last opening brace
    const insideBrace = segment.substring(lastOpenBraceIndex + 1);

    // Find position after last comma or at start
    let lastCommaOrStart = -1;
    let colonCount = 0;
    let parenDepth = 0;

    for (let i = 0; i < insideBrace.length; i++) {
      const char = insideBrace[i];

      if (char === '(') parenDepth++;
      else if (char === ')') parenDepth--;
      else if (parenDepth === 0) {
        if (char === ',') {
          lastCommaOrStart = i;
          colonCount = 0; // Reset colon count after comma
        } else if (char === ':') {
          colonCount++;
        }
      }
    }

    // Get content after last comma (or from start)
    const currentField = insideBrace.substring(lastCommaOrStart + 1).trim();

    // Check if we're after a colon in the current field
    const colonInCurrentField = currentField.includes(':');

    if (colonInCurrentField) {
      result.isAfterColon = true;
      // Extract what's after the colon
      const afterColon = currentField.substring(currentField.indexOf(':') + 1).trim();
      // Check if it starts with '.' for field access
      if (afterColon.startsWith('.')) {
        const fieldMatch = afterColon.match(/^\.([\w]*)/);
        result.incompleteField = fieldMatch ? fieldMatch[1] : '';
      }
    } else {
      // No colon in current position - shorthand position
      result.isShorthandPosition = true;
      // Extract the incomplete field name (e.g., "na" from "{na" or "{age, na")
      const fieldMatch = currentField.match(/^(\w*)$/);
      result.incompleteField = fieldMatch ? fieldMatch[1] : '';
    }

    return result;
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
    // Pattern: function_name( followed by optional whitespace, then a field path or object construction
    const funcMatch = segment.match(
      /^(map|select|sort_by|group_by|unique_by|min_by|max_by|map_values|any|all|first|last|until|while|recurse_down)\s*\(\s*([.{].*)?$/
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
      /(?:map|select|sort_by|group_by|unique_by|min_by|max_by|map_values)\s*\([^)]*(?:map|select|sort_by|group_by|unique_by|min_by|max_by|map_values)\s*\(\s*([.{].*)?$/
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
   * Extract all variables defined in query before cursor position
   * @param {string} query - Full query
   * @param {number} cursor - Cursor position (only scan before this)
   * @returns {string[]} Variable names ['$var1', '$var2', ...]
   */
  static extractVariables(query, cursor) {
    const beforeCursor = query.substring(0, cursor);
    const variables = new Set();

    // 1. as $var pattern (e.g., .price as $p)
    const asMatches = beforeCursor.matchAll(/\bas\s+(\$\w+)/g);
    for (const m of asMatches) variables.add(m[1]);

    // 2. Destructuring: as {key: $var, ...} or as [$a, $b]
    const destructObjMatches = beforeCursor.matchAll(/\bas\s*\{([^}]+)\}/g);
    for (const m of destructObjMatches) {
      const inner = m[1];
      const varMatches = inner.matchAll(/:\s*(\$\w+)/g);
      for (const vm of varMatches) variables.add(vm[1]);
    }

    const destructArrMatches = beforeCursor.matchAll(/\bas\s*\[([^\]]+)\]/g);
    for (const m of destructArrMatches) {
      const inner = m[1];
      const varMatches = inner.matchAll(/(\$\w+)/g);
      for (const vm of varMatches) variables.add(vm[1]);
    }

    // 3. Built-in variables (always available)
    variables.add('$ENV');
    variables.add('$__loc__');

    return [...variables];
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
