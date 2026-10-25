/**
 * JSON 포맷 전용 워커 — `JSON.parse` + `JSON.stringify` 를 메인 스레드 밖에서 돌린다.
 * 수 MB 입력에서 이 한 쌍이 수백 ms 를 먹어 타이핑이 끊기기 때문이다.
 *
 * Blob URL 워커라 단일 HTML(file://) 빌드에서도 동작한다. 30초 놀면 스스로 종료한다.
 */

const IDLE_MS = 30_000
const CODE =
  'self.onmessage=function(e){try{self.postMessage({ok:JSON.stringify(JSON.parse(e.data),null,4)})}' +
  'catch(err){self.postMessage({err:err.message})}};'

let worker: Worker | null = null
let url: string | null = null
let idle: ReturnType<typeof setTimeout> | null = null

function getWorker(): Worker {
  if (idle !== null) clearTimeout(idle)
  if (!worker) {
    url = URL.createObjectURL(new Blob([CODE], { type: 'text/javascript' }))
    worker = new Worker(url)
  }
  idle = setTimeout(() => terminateFormatWorker(), IDLE_MS)
  return worker
}

export function terminateFormatWorker(): void {
  if (worker) {
    worker.terminate()
    worker = null
  }
  if (url) {
    URL.revokeObjectURL(url)
    url = null
  }
  if (idle !== null) {
    clearTimeout(idle)
    idle = null
  }
}

/** 유효한 JSON이면 4칸 들여쓰기로 다시 만든다. 아니면 reject. */
export function formatJsonInWorker(jsonString: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = getWorker()
    w.onmessage = (e: MessageEvent<{ ok?: string; err?: string }>) => {
      if (e.data.err) reject(new Error(e.data.err))
      else resolve(e.data.ok ?? '')
    }
    w.onerror = () => reject(new Error('포맷 워커 오류'))
    w.postMessage(jsonString)
  })
}
