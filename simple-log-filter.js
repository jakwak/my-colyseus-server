const { spawn } = require('child_process');

console.log('🚀 Colyseus 로그 필터 시작 (message 부분만 표시)');
console.log('Ctrl+C로 종료\n');

const pm2Logs = spawn('pm2', ['logs', 'colyseus', '--raw', '--lines', '0']);

pm2Logs.stdout.on('data', (data) => {
  const lines = data.toString().split('\n');
  
  lines.forEach(line => {
    if (line.trim()) {
      try {
        const logEntry = JSON.parse(line);
        if (logEntry.message) {
          // 타임스탬프와 함께 출력
          const timestamp = logEntry.timestamp ? `[${logEntry.timestamp}] ` : '';
          console.log(`${timestamp}${logEntry.message}`);
        }
      } catch (e) {
        // JSON 파싱 실패 시 무시
      }
    }
  });
});

pm2Logs.stderr.on('data', (data) => {
  // stderr는 무시
});

pm2Logs.on('close', (code) => {
  console.log(`\n❌ 로그 스트림 종료 (코드: ${code})`);
});

process.on('SIGINT', () => {
  console.log('\n👋 로그 필터 종료');
  pm2Logs.kill('SIGINT');
  process.exit();
}); 