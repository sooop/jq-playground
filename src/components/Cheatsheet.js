const CHEATSHEET_CATEGORIES = {
  basic: {
    title: 'Basic',
    items: [
      { query: '.', desc: 'Identity - returns input unchanged' },
      { query: '.field', desc: 'Field access' },
      { query: '.[]', desc: 'Array/object iterator' },
      { query: '.[]?', desc: 'Optional iterator (no error if not array)' },
      { query: '.[0]', desc: 'Array index access' },
      { query: '.[-1]', desc: 'Last element (negative index)' },
      { query: '.[1:3]', desc: 'Array slice (from index 1 to 3)' },
      { query: '.field?', desc: 'Optional field (no error if missing)' },
      { query: '..', desc: 'Recursive descent (all values)' },
      { query: '.["field name"]', desc: 'Field with special chars' }
    ]
  },
  filters: {
    title: 'Filters & Selection',
    items: [
      { query: 'select(.age > 25)', desc: 'Filter by condition' },
      { query: 'select(.age >= 18 and .active)', desc: 'Multiple conditions with and' },
      { query: 'select(.status != "deleted")', desc: 'Not equal filter' },
      { query: 'select(.city == "Seoul")', desc: 'Filter by equality' },
      { query: 'select(.name | test("^A"))', desc: 'Filter by regex' },
      { query: 'select(has("field"))', desc: 'Filter if key exists' },
      { query: 'select(.tags | contains(["jq"]))', desc: 'Filter by array content' },
      { query: 'select(.tags | inside(["admin", "user"]))', desc: 'Check if all elements inside' },
      { query: 'map(select(.active))', desc: 'Filter within map' },
      { query: '.[] | select(.price < 100)', desc: 'Iterate and filter' }
    ]
  },
  arrays: {
    title: 'Arrays',
    items: [
      { query: 'map(.name)', desc: 'Transform each element' },
      { query: 'sort', desc: 'Sort array (simple values)' },
      { query: 'sort_by(.age)', desc: 'Sort by field' },
      { query: 'reverse', desc: 'Reverse array' },
      { query: 'unique', desc: 'Remove duplicates' },
      { query: 'unique_by(.id)', desc: 'Unique by field' },
      { query: 'group_by(.category)', desc: 'Group by field' },
      { query: 'flatten', desc: 'Flatten nested arrays' },
      { query: 'flatten(1)', desc: 'Flatten one level deep' },
      { query: 'add', desc: 'Sum array elements' },
      { query: 'min', desc: 'Minimum value' },
      { query: 'max', desc: 'Maximum value' },
      { query: 'min_by(.age)', desc: 'Item with min field' },
      { query: 'max_by(.age)', desc: 'Item with max field' },
      { query: 'first', desc: 'First element' },
      { query: 'last', desc: 'Last element' },
      { query: 'nth(2)', desc: 'Get 3rd element (0-indexed)' },
      { query: 'indices("value")', desc: 'Find all indices of value' },
      { query: 'index("value")', desc: 'Find first index of value' },
      { query: 'range(5)', desc: 'Generate [0,1,2,3,4]' },
      { query: 'range(2; 5)', desc: 'Generate [2,3,4]' },
      { query: '[.[] | .value * 2]', desc: 'Build new array' }
    ]
  },
  objects: {
    title: 'Objects',
    items: [
      { query: '{name, age}', desc: 'Select fields' },
      { query: '{name: .username, years: .age}', desc: 'Rename fields' },
      { query: '{name, newField: .age * 2}', desc: 'Add computed field' },
      { query: 'keys', desc: 'Get object keys (sorted)' },
      { query: 'keys_unsorted', desc: 'Get keys in original order' },
      { query: 'values', desc: 'Get object values' },
      { query: 'has("key")', desc: 'Check if object has key' },
      { query: 'in({key: 1})', desc: 'Check if value in object' },
      { query: 'to_entries', desc: 'Convert to [{key,value}]' },
      { query: 'from_entries', desc: 'Convert from [{key,value}]' },
      { query: 'with_entries(.value += 1)', desc: 'Transform all values' },
      { query: 'with_entries(select(.value > 10))', desc: 'Filter object by value' },
      { query: 'del(.field)', desc: 'Delete field' },
      { query: '. + {newField: "value"}', desc: 'Merge/add fields' },
      { query: '. * {field: "value"}', desc: 'Multiply/merge objects' }
    ]
  },
  strings: {
    title: 'Strings',
    items: [
      { query: 'length', desc: 'String length' },
      { query: 'split(",")', desc: 'Split string by delimiter' },
      { query: 'join(", ")', desc: 'Join array to string' },
      { query: 'ascii_upcase', desc: 'Convert to uppercase' },
      { query: 'ascii_downcase', desc: 'Convert to lowercase' },
      { query: 'startswith("prefix")', desc: 'Check if starts with' },
      { query: 'endswith("suffix")', desc: 'Check if ends with' },
      { query: 'ltrimstr("prefix")', desc: 'Remove prefix' },
      { query: 'rtrimstr("suffix")', desc: 'Remove suffix' },
      { query: 'contains("sub")', desc: 'Check if contains substring' },
      { query: 'test("pattern")', desc: 'Test regex match' },
      { query: 'match("pattern")', desc: 'Get regex match details' },
      { query: 'sub("old"; "new")', desc: 'Replace first occurrence' },
      { query: 'gsub("old"; "new")', desc: 'Replace all occurrences' }
    ]
  },
  types: {
    title: 'Types & Conversion',
    items: [
      { query: 'type', desc: 'Get type: "number", "string", "array", etc.' },
      { query: 'length', desc: 'Length of array/object/string/null' },
      { query: 'tonumber', desc: 'Convert to number' },
      { query: 'tostring', desc: 'Convert to string' },
      { query: 'arrays', desc: 'Select only arrays' },
      { query: 'objects', desc: 'Select only objects' },
      { query: 'iterables', desc: 'Select arrays and objects' },
      { query: 'scalars', desc: 'Select non-iterables' },
      { query: 'nulls', desc: 'Select null values' },
      { query: 'booleans', desc: 'Select boolean values' },
      { query: 'numbers', desc: 'Select numbers' },
      { query: 'strings', desc: 'Select strings' },
      { query: 'values', desc: 'Select non-null values' },
      { query: 'empty', desc: 'Return nothing' }
    ]
  },
  conditionals: {
    title: 'Conditionals & Logic',
    items: [
      { query: 'if .age >= 18 then "adult" else "minor" end', desc: 'If-then-else' },
      { query: 'if .score > 90 then "A" elif .score > 80 then "B" else "C" end', desc: 'Multiple conditions' },
      { query: '.name // "unknown"', desc: 'Alternative operator (default if null/false)' },
      { query: 'select(.value != null)', desc: 'Filter null values' },
      { query: 'if . then "yes" else "no" end', desc: 'Boolean check' },
      { query: 'empty', desc: 'Produce no output' },
      { query: 'not', desc: 'Logical NOT' },
      { query: '. and .', desc: 'Logical AND' },
      { query: '. or .', desc: 'Logical OR' }
    ]
  },
  variables: {
    title: 'Variables & Functions',
    items: [
      { query: '.price as $p | .quantity * $p', desc: 'Assign to variable' },
      { query: '.[] | . as $item | $item.price * $item.qty', desc: 'Variable in iteration' },
      { query: '.items[] | .price as $p | select($p > 100)', desc: 'Use variable in filter' },
      { query: '{a: 1, b: 2} | .a as $x | .b as $y | $x + $y', desc: 'Multiple variables' },
      { query: 'reduce .[] as $item (0; . + $item)', desc: 'Variable in reduce' },
      { query: '[.[] | . as $x | $x * $x]', desc: 'Variable for calculation' },
      { query: '.[] | . as {name: $n, age: $a} | "\($n) is \($a)"', desc: 'Destructure to variables' },
      { query: 'def double: . * 2; .[] | double', desc: 'Define and use function' },
      { query: 'def add(x): . + x; 5 | add(3)', desc: 'Function with parameter' },
      { query: 'def max(a; b): if a > b then a else b end; max(5; 3)', desc: 'Function with multiple params' },
      { query: '. as $root | .items[] | . + {total: $root.tax}', desc: 'Access root from nested' },
      { query: '.[] | {original: ., double: (. * 2)} | . as $obj | $obj', desc: 'Complex variable usage' }
    ]
  },
  math: {
    title: 'Math & Aggregation',
    items: [
      { query: 'add', desc: 'Sum of array elements' },
      { query: 'length', desc: 'Count items in array' },
      { query: '[.[] | .price] | add', desc: 'Sum specific field' },
      { query: '[.[] | .price] | add / length', desc: 'Calculate average' },
      { query: 'group_by(.type) | map({type: .[0].type, count: length})', desc: 'Count by group' },
      { query: 'min', desc: 'Minimum value' },
      { query: 'max', desc: 'Maximum value' },
      { query: 'floor', desc: 'Round down' },
      { query: 'ceil', desc: 'Round up' },
      { query: 'round', desc: 'Round to nearest' },
      { query: 'sqrt', desc: 'Square root' },
      { query: 'any', desc: 'True if any value is true' },
      { query: 'all', desc: 'True if all values are true' }
    ]
  },
  formatting: {
    title: 'Formatting & Output',
    items: [
      { query: '@json', desc: 'Format as JSON string' },
      { query: '@text', desc: 'Raw text output (no quotes)' },
      { query: '@csv', desc: 'Format as CSV' },
      { query: '@tsv', desc: 'Format as TSV' },
      { query: '@html', desc: 'HTML escape' },
      { query: '@uri', desc: 'URL encode' },
      { query: '@base64', desc: 'Base64 encode' },
      { query: '@base64d', desc: 'Base64 decode' }
    ]
  },
  advanced: {
    title: 'Advanced',
    items: [
      { query: 'reduce .[] as $item (0; . + $item)', desc: 'Reduce with accumulator' },
      { query: 'recurse(.children[]?)', desc: 'Recursive traversal' },
      { query: 'walk(if type == "string" then ascii_upcase else . end)', desc: 'Walk and transform all' },
      { query: '[paths(scalars)]', desc: 'All paths to leaf values' },
      { query: 'getpath(["a", "b"])', desc: 'Get value by path array' },
      { query: 'setpath(["a", "b"]; 123)', desc: 'Set value by path array' },
      { query: 'path(.a.b)', desc: 'Get path to field' },
      { query: 'limit(5; .[])', desc: 'Limit output to 5 items' },
      { query: 'first(.[] | select(.active))', desc: 'First matching item' },
      { query: 'until(. > 100; . * 2)', desc: 'Repeat until condition' },
      { query: 'while(. < 100; . * 2)', desc: 'Repeat while condition' },
      { query: 'repeat(. * 2)', desc: 'Infinite repeat (use with limit)' },
      { query: 'try .field catch "default"', desc: 'Try-catch error handling' },
      { query: 'try .field', desc: 'Try without catch (returns empty on error)' },
      { query: '.field // error("missing field")', desc: 'Throw custom error' },
      { query: 'debug', desc: 'Debug output to stderr' },
      { query: 'debug("message")', desc: 'Debug with custom message' }
    ]
  },
  practical: {
    title: 'Practical Patterns',
    items: [
      { query: '[.users[] | {name, email}]', desc: 'Extract specific fields' },
      { query: '.users | map(select(.active)) | sort_by(.name)', desc: 'Filter, sort pipeline' },
      { query: 'group_by(.category) | map({category: .[0].category, items: .})', desc: 'Group and reshape' },
      { query: 'group_by(.type) | map({type: .[0].type, total: map(.amount) | add})', desc: 'Group and sum' },
      { query: '[.[] | select(.tags | contains(["featured"]))]', desc: 'Filter by array contains' },
      { query: '[.[] | select(.tags[] == "featured")]', desc: 'Filter by any array element' },
      { query: '.data | to_entries | map(select(.value > 10)) | from_entries', desc: 'Filter object entries' },
      { query: 'to_entries | sort_by(.value) | from_entries', desc: 'Sort object by values' },
      { query: '[.[] | {(.id): .name}] | add', desc: 'Array to object by id' },
      { query: '.[] | select(.date | test("2024"))', desc: 'Filter by string pattern' },
      { query: '[.[] | .total = (.price * .quantity)]', desc: 'Add calculated field' },
      { query: '.[] | if .price > 100 then . + {expensive: true} else . end', desc: 'Conditional field' },
      { query: 'map(select(.status == "active")) | unique_by(.email) | sort_by(.name)', desc: 'Filter, dedupe, sort' },
      { query: '[.[] | try .field.nested catch null]', desc: 'Safe nested access' },
      { query: '.[] | select(.price) | {name, price}', desc: 'Filter null and extract' },
      { query: '{users: [.users[] | {name, age}], count: (.users | length)}', desc: 'Build new structure' },
      { query: '. as $root | .items[] | . + {tax: $root.taxRate}', desc: 'Use root in nested context' },
      { query: '.[] | .tags as $t | select($t | length > 0)', desc: 'Variable for complex filter' }
    ]
  }
};

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function createCheatsheet(onQuerySelect) {
  const container = document.createElement('div');
  container.className = 'cheatsheet-container';

  // Generate tabs HTML
  const categoryKeys = Object.keys(CHEATSHEET_CATEGORIES);
  const tabsHTML = categoryKeys.map((key, index) =>
    `<button class="cheatsheet-tab ${index === 0 ? 'active' : ''}" data-category="${key}">
      ${CHEATSHEET_CATEGORIES[key].title}
    </button>`
  ).join('');

  // Generate category content HTML
  const categoriesHTML = categoryKeys.map((key, index) => {
    const items = CHEATSHEET_CATEGORIES[key].items;
    const itemsHTML = items.map(item =>
      `<div class="cheatsheet-item" data-query="${escapeHtml(item.query)}">
        <code>${escapeHtml(item.query)}</code>
        <span class="cheatsheet-desc">${item.desc}</span>
      </div>`
    ).join('');

    return `<div class="cheatsheet-category ${index === 0 ? 'active' : ''}" data-category="${key}">
      ${itemsHTML}
    </div>`;
  }).join('');

  container.innerHTML = `
    <div class="cheatsheet">
      <div class="cheatsheet-tabs">
        ${tabsHTML}
      </div>
      <div class="cheatsheet-content">
        ${categoriesHTML}
      </div>
    </div>
  `;

  const cheatsheet = container.querySelector('.cheatsheet');

  // Cheatsheet tab switching
  container.querySelectorAll('.cheatsheet-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const category = tab.dataset.category;

      // Update active tab
      container.querySelectorAll('.cheatsheet-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Update active category
      container.querySelectorAll('.cheatsheet-category').forEach(c => c.classList.remove('active'));
      container.querySelector(`.cheatsheet-category[data-category="${category}"]`).classList.add('active');
    });
  });

  // Cheatsheet items
  container.querySelectorAll('.cheatsheet-item').forEach(item => {
    item.addEventListener('click', () => {
      const query = item.dataset.query;
      onQuerySelect(query);
    });
  });

  // Public API
  container.api = {
    toggle: () => {
      cheatsheet.classList.toggle('open');
    },
    close: () => {
      cheatsheet.classList.remove('open');
    },
    open: () => {
      cheatsheet.classList.add('open');
    }
  };

  return container;
}
