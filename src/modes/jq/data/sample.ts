/** 내장 샘플 — 처음 열었을 때 "무엇을 넣는 곳인지" 보여주는 용도 */
export const SAMPLE_INPUT = JSON.stringify(
  {
    users: [
      { name: 'Alice', age: 30, city: 'Seoul', hobbies: ['reading', 'coding'] },
      { name: 'Bob', age: 25, city: 'Busan', hobbies: ['gaming'] },
      { name: 'Charlie', age: 35, city: 'Seoul', hobbies: ['music', 'sports', 'travel'] },
    ],
    metadata: { timestamp: '2025-11-14', version: '1.0' },
  },
  null,
  2,
)

export const SAMPLE_QUERY = '.users[] | select(.city == "Seoul")'
