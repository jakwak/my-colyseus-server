const pm2 = require('pm2');
const fs = require('fs');
const path = require('path');

class ColyseusMonitor {
  constructor() {
    this.appName = 'colyseus';
    this.logPath = path.join(__dirname, 'logs');
    this.maxRestartAttempts = 5;
    this.restartCooldown = 30000; // 30초
    this.lastRestartTime = 0;
    this.restartCount = 0;
  }

  // PM2 연결
  connect() {
    return new Promise((resolve, reject) => {
      pm2.connect((err) => {
        if (err) {
          console.error('PM2 연결 실패:', err);
          reject(err);
        } else {
          console.log('PM2 연결 성공');
          resolve();
        }
      });
    });
  }

  // 서버 상태 확인
  async checkServerStatus() {
    return new Promise((resolve, reject) => {
      pm2.describe(this.appName, (err, processes) => {
        if (err) {
          console.error('서버 상태 확인 실패:', err);
          reject(err);
        } else {
          const process = processes[0];
          if (process) {
            resolve({
              status: process.pm2_env.status,
              restart_time: process.pm2_env.restart_time,
              memory: process.monit.memory,
              cpu: process.monit.cpu,
              uptime: process.pm2_env.pm_uptime
            });
          } else {
            resolve(null);
          }
        }
      });
    });
  }

  // 서버 재시작
  async restartServer() {
    const now = Date.now();
    if (now - this.lastRestartTime < this.restartCooldown) {
      console.log('재시작 쿨다운 중...');
      return false;
    }

    if (this.restartCount >= this.maxRestartAttempts) {
      console.error('최대 재시작 시도 횟수 초과');
      return false;
    }

    return new Promise((resolve, reject) => {
      pm2.restart(this.appName, (err) => {
        if (err) {
          console.error('서버 재시작 실패:', err);
          reject(err);
        } else {
          this.lastRestartTime = now;
          this.restartCount++;
          console.log(`서버 재시작 성공 (${this.restartCount}/${this.maxRestartAttempts})`);
          resolve(true);
        }
      });
    });
  }

  // 로그 파일 모니터링
  checkLogFiles() {
    const logFiles = [
      path.join(this.logPath, 'colyseus-error.log'),
      path.join(this.logPath, 'colyseus-out.log'),
      path.join(this.logPath, 'colyseus-combined.log')
    ];

    for (const logFile of logFiles) {
      if (fs.existsSync(logFile)) {
        const stats = fs.statSync(logFile);
        const fileSize = stats.size;
        const lastModified = stats.mtime;

        console.log(`로그 파일: ${path.basename(logFile)}`);
        console.log(`  크기: ${(fileSize / 1024).toFixed(2)} KB`);
        console.log(`  마지막 수정: ${lastModified.toLocaleString()}`);
      }
    }
  }

  // 메모리 사용량 확인
  async checkMemoryUsage() {
    const status = await this.checkServerStatus();
    if (status && status.memory) {
      const memoryMB = status.memory / 1024 / 1024;
      console.log(`메모리 사용량: ${memoryMB.toFixed(2)} MB`);
      
      if (memoryMB > 250) {
        console.warn('메모리 사용량이 높습니다!');
        return true;
      }
    }
    return false;
  }

  // 서버가 응답하지 않는지 확인
  async checkServerResponsiveness() {
    const status = await this.checkServerStatus();
    if (status) {
      const uptime = Date.now() - status.uptime;
      const isStuck = uptime > 60000 && status.status === 'online'; // 1분 이상 응답 없음
      
      if (isStuck) {
        console.warn('서버가 응답하지 않습니다!');
        return true;
      }
    }
    return false;
  }

  // 모니터링 루프
  async startMonitoring() {
    try {
      await this.connect();
      
      setInterval(async () => {
        try {
          console.log('\n=== 서버 상태 체크 ===');
          console.log(`시간: ${new Date().toLocaleString()}`);
          
          const status = await this.checkServerStatus();
          if (!status) {
            console.log('서버가 실행되지 않음');
            await this.restartServer();
            return;
          }

          console.log(`상태: ${status.status}`);
          console.log(`재시작 횟수: ${status.restart_time}`);
          
          // 메모리 사용량 체크
          const highMemory = await this.checkMemoryUsage();
          
          // 서버 응답성 체크
          const unresponsive = await this.checkServerResponsiveness();
          
          // 로그 파일 체크
          this.checkLogFiles();
          
          // 문제가 있으면 재시작
          if (highMemory || unresponsive || status.status === 'stopped' || status.status === 'errored') {
            console.log('문제 감지! 서버 재시작 시도...');
            await this.restartServer();
          }
          
        } catch (error) {
          console.error('모니터링 중 오류:', error);
        }
      }, 30000); // 30초마다 체크

    } catch (error) {
      console.error('모니터링 시작 실패:', error);
      pm2.disconnect();
    }
  }

  // 수동 재시작
  async manualRestart() {
    try {
      await this.connect();
      await this.restartServer();
      pm2.disconnect();
    } catch (error) {
      console.error('수동 재시작 실패:', error);
    }
  }
}

// CLI 명령어 처리
const args = process.argv.slice(2);
const monitor = new ColyseusMonitor();

if (args.includes('--restart')) {
  monitor.manualRestart();
} else if (args.includes('--status')) {
  monitor.connect().then(() => {
    monitor.checkServerStatus().then(status => {
      console.log('서버 상태:', status);
      pm2.disconnect();
    });
  });
} else {
  // 기본 모니터링 모드
  monitor.startMonitoring();
}