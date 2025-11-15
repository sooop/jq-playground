/**
 * jq Playground - Web Worker
 * 메인 스레드의 jq 처리를 백그라운드에서 실행
 */

let jqInstance = null;

// jq-web 라이브러리 로드
importScripts('https://cdn.jsdelivr.net/npm/jq-web@0.5.1/jq.wasm.js');

// Worker 초기화
async function initWorker() {
    try {
        jqInstance = await jq.promised;
        self.postMessage({ type: 'ready' });
    } catch (error) {
        self.postMessage({ type: 'error', message: 'Worker 초기화 실패: ' + error.message });
    }
}

// 메인 스레드로부터 메시지 수신
self.onmessage = async function(event) {
    const { input, query, format } = event.data;

    if (!jqInstance) {
        self.postMessage({ type: 'error', message: 'jq 엔진이 초기화되지 않음' });
        return;
    }

    try {
        // JSON 파싱
        const parsedInput = JSON.parse(input);

        // jq 쿼리 실행
        const result = await jqInstance.json(parsedInput, query);

        // 결과 직렬화 (포맷별로)
        let output;
        if (format === 'json') {
            output = JSON.stringify(result, null, 2);
        } else {
            // CSV는 메인 스레드에서 처리하므로 JSON 결과만 반환
            output = JSON.stringify(result);
        }

        self.postMessage({
            type: 'success',
            output: output,
            format: format,
            resultData: result  // CSV 변환용 원본 데이터
        });
    } catch (error) {
        self.postMessage({
            type: 'error',
            message: error.message
        });
    }
};

// Worker 초기화 시작
initWorker();
