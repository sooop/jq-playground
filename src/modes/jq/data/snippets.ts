/**
 * 쿼리 스니펫 데이터 — 원본 `components/Snippets.ts` 의 상수만 떼어 왔다.
 * `"qsp"` 는 삽입 후 자동 선택되는 자리표시자다(`ui/SnippetsDialog.svelte`).
 *
 * 카테고리 색은 jq 3색 액센트를 버리고 단일 앰버 체계로 맞췄다 — 구분은 라벨로 한다.
 */

export interface Snippet {
  id: string
  title: string
  desc: string
  category: 'search' | 'filter' | 'transform' | 'aggregate'
  query: string
}

export const SNIPPETS: Snippet[] = [
  {
    id: 'universal-pattern-search',
    title: '범용 패턴 검색',
    desc: '구조를 모르는 JSON에서 키/값이 패턴과 매치되는 모든 {경로: 값}을 추출합니다.',
    category: 'search',
    query: `"qsp" as $pattern |
[ paths(scalars) as $p |
  select(
    (getpath($p) | tostring | (. != "") and test($pattern; "i")) or
    ($p | last | tostring | test($pattern; "i")) // false
  ) |
  { ($p | map(tostring) | join(".")): getpath($p) }
] | add`,
  },
  {
    id: 'flatten-paths',
    title: '모든 경로 평탄화',
    desc: '중첩된 JSON을 {경로: 값} 형태의 한 단계 객체로 펼칩니다.',
    category: 'search',
    query: `[paths(scalars) as $p | {($p | map(tostring) | join(".")): getpath($p)}] | add`,
  },
  {
    id: 'filter-array-by-key',
    title: '배열 필터: 키 매치',
    desc: '배열 요소 중 특정 키 이름이 패턴과 매치되는 항목만 반환합니다.',
    category: 'filter',
    query: `"qsp" as $pattern |
map(select([keys_unsorted[] | test($pattern; "i")] | any))`,
  },
  {
    id: 'filter-array-by-value',
    title: '배열 필터: 값 매치',
    desc: '배열 요소 중 어떤 스칼라 값이라도 패턴과 매치되는 항목만 반환합니다.',
    category: 'filter',
    query: `"qsp" as $pattern |
map(select([.. | scalars | tostring | test($pattern; "i")] | any))`,
  },
  {
    id: 'filter-by-condition',
    title: '배열 필터: 조건식',
    desc: '특정 필드가 조건에 맞는 항목만 골라냅니다. .field를 실제 키로 변경하세요.',
    category: 'filter',
    query: `map(select(.field != null and .field != ""))`,
  },
  {
    id: 'group-by-field',
    title: '필드로 그룹화',
    desc: '배열을 특정 필드 값으로 그룹화하고 카운트와 함께 반환합니다.',
    category: 'aggregate',
    query: `group_by(.field) |
map({ key: .[0].field, count: length, items: . })`,
  },
  {
    id: 'unique-values',
    title: '고유 값 추출',
    desc: '배열의 특정 필드에서 고유한 값만 추출합니다.',
    category: 'aggregate',
    query: `[.[] | .field] | unique`,
  },
  {
    id: 'count-by-field',
    title: '필드 값 빈도 집계',
    desc: '특정 필드의 값별 등장 횟수를 내림차순으로 정렬합니다.',
    category: 'aggregate',
    query: `group_by(.field) |
map({value: .[0].field, count: length}) |
sort_by(-.count)`,
  },
  {
    id: 'pick-fields',
    title: '특정 필드만 선택',
    desc: '배열의 각 요소에서 지정한 필드들만 남깁니다.',
    category: 'transform',
    query: `map({id, name, value})`,
  },
  {
    id: 'rename-field',
    title: '필드명 변환',
    desc: '키 이름을 변경하거나 구조를 재구성합니다.',
    category: 'transform',
    query: `map({
  newName: .oldName,
  label:   .title,
  count:   (.items | length)
})`,
  },
];

export const CATEGORY_LABEL: Record<Snippet['category'], string> = {
  search: 'Search',
  filter: 'Filter',
  aggregate: 'Aggregate',
  transform: 'Transform',
}

export const CATEGORY_ORDER: Snippet['category'][] = ['search', 'filter', 'aggregate', 'transform']
