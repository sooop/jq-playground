const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export function validateFileSize(file) {
  if (file.size > MAX_FILE_SIZE) {
    const maxMB = (MAX_FILE_SIZE / 1024 / 1024).toFixed(1);
    const currentMB = (file.size / 1024 / 1024).toFixed(1);
    throw new Error(`파일이 너무 큽니다. 최대 ${maxMB}MB까지만 허용됩니다. (현재: ${currentMB}MB)`);
  }
  return true;
}

export function readFile(file) {
  return new Promise((resolve, reject) => {
    try {
      validateFileSize(file);
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(new Error('파일 읽기 실패'));
      reader.readAsText(file);
    } catch (error) {
      reject(error);
    }
  });
}

export function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/plain; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
