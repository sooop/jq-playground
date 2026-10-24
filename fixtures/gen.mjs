#!/usr/bin/env node
/**
 * 성능 검증용 CSV 생성기.
 *
 *   node fixtures/gen.mjs [행수] [열수] > fixtures/big.csv
 *   node fixtures/gen.mjs 100000 25 > fixtures/big.csv
 *
 * 실제 데이터처럼 숫자·날짜·문자열·빈 값·인용이 필요한 값이 섞이게 만든다.
 * 결정적(고정 시드)이라 실행마다 같은 파일이 나온다.
 */

const rowCount = Number(process.argv[2] ?? 100_000)
const colCount = Number(process.argv[3] ?? 25)

/** xorshift32 — 시드 고정 난수 */
let seed = 0x2f6e2b1
function rnd() {
  seed ^= seed << 13
  seed ^= seed >>> 17
  seed ^= seed << 5
  return ((seed >>> 0) % 1_000_000) / 1_000_000
}
const pick = (a) => a[Math.floor(rnd() * a.length)]

const FAMILY = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '한', '오', '서']
const GIVEN = ['하늘', '준호', '서연', '민준', '다은', '재현', '미르', '소진', '지우', '현우']
const STATUS = ['배송완료', '배송중', '결제대기', '취소', '반품', '보류']
const CITY = ['서울', '부산', '인천', '대구', '대전', '광주', '수원', '울산', '창원', '고양']
const PRODUCT = [
  '무선 이어폰',
  'USB-C 허브',
  '모니터 27" QHD', // 인용 필요 (따옴표 포함)
  '기계식 키보드',
  '노트북 스탠드',
  '케이블, 1.5m', // 인용 필요 (콤마 포함)
  '웹캠 1080p',
  '외장 SSD 1TB',
  '마우스패드',
  '노이즈캔슬링 헤드폰',
]

/** CSV 필드 인용 */
function q(v) {
  const s = String(v)
  return /[",\n\r]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s
}

// 헤더: 기본 7개 + 나머지는 타입이 순환하는 추가 칼럼
const base = ['주문번호', '고객명', '상품', '수량', '단가', '주문일', '상태']
const header = []
for (let c = 0; c < colCount; c++) {
  if (c < base.length) header.push(base[c])
  else {
    const k = c - base.length
    const kind = k % 4
    header.push(
      kind === 0 ? `수치_${k}` : kind === 1 ? `날짜_${k}` : kind === 2 ? `코드_${k}` : `비고_${k}`,
    )
  }
}

const out = []
out.push(header.map(q).join(','))

for (let r = 0; r < rowCount; r++) {
  const row = new Array(colCount)
  for (let c = 0; c < colCount; c++) {
    if (c < base.length) {
      switch (c) {
        case 0:
          row[c] = `ORD-${String(100000 + r)}`
          break
        case 1:
          row[c] = pick(FAMILY) + pick(GIVEN)
          break
        case 2:
          row[c] = pick(PRODUCT)
          break
        case 3:
          row[c] = String(1 + Math.floor(rnd() * 9))
          break
        case 4:
          row[c] = String((1 + Math.floor(rnd() * 400)) * 1000)
          break
        case 5: {
          const d = new Date(Date.UTC(2025, 0, 1) + Math.floor(rnd() * 400) * 86400000)
          row[c] = d.toISOString().slice(0, 10)
          break
        }
        default:
          row[c] = pick(STATUS)
      }
      continue
    }
    const k = c - base.length
    switch (k % 4) {
      case 0:
        // 5%는 빈 값 — 정렬에서 빈 값 처리를 검증하려고
        row[c] = rnd() < 0.05 ? '' : (rnd() * 10000).toFixed(2)
        break
      case 1: {
        const d = new Date(Date.UTC(2024, 0, 1) + Math.floor(rnd() * 700) * 86400000)
        row[c] = d.toISOString().slice(0, 10)
        break
      }
      case 2:
        row[c] = pick(CITY) + '-' + String(Math.floor(rnd() * 1000)).padStart(3, '0')
        break
      default:
        row[c] = rnd() < 0.1 ? '' : pick(PRODUCT) + ' ' + pick(CITY)
    }
  }
  out.push(row.map(q).join(','))

  // 메모리 폭발을 막기 위해 주기적으로 비운다
  if (out.length >= 5000) {
    process.stdout.write(out.join('\n') + '\n')
    out.length = 0
  }
}
if (out.length > 0) process.stdout.write(out.join('\n') + '\n')
