const SNIPPETS = [
  {
    id: 'search-key',
    title: 'Search-Key',
    desc: 'JSON 구조를 모를 때 키 이름으로 경로/값을 찾습니다',
    query: `"item" as $pattern |
[ paths as $p |
    select($p | last | tostring | match($pattern;"i")) |
    {($p | join(".")): getpath($p)}
] | map(to_entries[0]) | from_entries`
  },
  {
    id: 'search-key-or-value',
    title: 'Search-Key or Value',
    desc: '키 이름 또는 값이 패턴과 일치하는 항목을 선택합니다',
    query: `"kwd" as $pattern |
select(
    any(
        paths(scalars) as $p |
        (
            ($p | last | tostring | test($pattern; "i"))
            or
            ((getpath($p) | type == "string") and (getpath($p) | test($pattern; "i")))
        )
    )
)`
  },
  {
    id: 'filter-value',
    title: 'Filter-Value',
    desc: '배열 스트림에서 특정 값 패턴이 포함된 항목을 필터링합니다',
    query: `"kwd" as $pattern |
select(
  any(
    paths(scalars) as $p |
    ((getpath($p) | tostring | test($pattern;"i")) // false)
  )
)`
  },
  {
    id: 'filter-key-value-detail',
    title: 'Filter-Key·Value (Detail)',
    desc: '배열 스트림에서 키/값 모두 검색 후 매칭 경로·키·값·매칭유형을 반환합니다',
    query: `"product_name" as $pattern |
{
    matches: [
        paths(scalars) as $p |
        select(
            ($p | last | tostring | test($pattern; "i"))
            or
            ((getpath($p) | type == "string") and (getpath($p) | test($pattern; "i")))
        ) |
        {
            path: ($p | join(".")),
            key: ($p | last | tostring),
            value: getpath($p),
            matched_on: (
                if ($p | last | tostring | test($pattern; "i"))
                then "key"
                else "value"
                end
            )
        }
    ]
} |
select(.matches | length > 0)`
  }
];

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function createSnippets(onQuerySelect) {
  const container = document.createElement('div');
  container.className = 'snippets-container';

  const itemsHTML = SNIPPETS.map(snippet => `
    <div class="snippet-item" data-id="${snippet.id}">
      <div class="snippet-header">
        <span class="snippet-title">${escapeHtml(snippet.title)}</span>
        <span class="snippet-desc">${escapeHtml(snippet.desc)}</span>
      </div>
      <pre class="snippet-code"><code>${escapeHtml(snippet.query)}</code></pre>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="snippets-panel">
      <div class="snippets-content">
        ${itemsHTML}
      </div>
    </div>
  `;

  const panel = container.querySelector('.snippets-panel');

  container.querySelectorAll('.snippet-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.id;
      const snippet = SNIPPETS.find(s => s.id === id);
      if (snippet) onQuerySelect(snippet.query);
    });
  });

  container.api = {
    toggle: () => panel.classList.toggle('open'),
    close: () => panel.classList.remove('open'),
    open: () => panel.classList.add('open')
  };

  return container;
}
