const os = require('os');

/**
 * COLYSEUS CLOUD WARNING:
 * ----------------------
 * PLEASE DO NOT UPDATE THIS FILE MANUALLY AS IT MAY CAUSE DEPLOYMENT ISSUES
 */

// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'colyseus',
      script: 'npm',
      args: 'start',
      cwd: '/Users/ondalssam/Desktop/my-colyseus-server',
      instances: 1,
      autorestart: true,
      watch: true,
      max_memory_restart: '1G',
      wait_ready: true,              // 준비 완료 신호 대기
      listen_timeout: 10000,         // 10초 대기
      kill_timeout: 5000,            // 종료 대기 시간
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
      env: { 
        NODE_ENV: 'development', 
        PORT: 2567 
      },
      error_file: './logs/colyseus-error.log',    // 에러 로그 파일
      out_file: './logs/colyseus-out.log',        // 출력 로그 파일
      log_file: './logs/colyseus-combined.log',   // 통합 로그 파일
      time: true,                                  // 로그에 타임스탬프 추가
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'    // 로그 날짜 형식
    }
  ]
};

