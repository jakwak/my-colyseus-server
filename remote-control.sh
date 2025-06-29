#!/bin/bash

# Colyseus 서버 원격 제어 스크립트
# 사용법: ./remote-control.sh [명령어]

SERVER_NAME="colyseus"
SERVER_DIR="/Users/ondalssam/Desktop/my-colyseus-server"
LOG_DIR="$SERVER_DIR/logs"

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 로그 함수
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 서버 상태 확인
check_status() {
    log_info "서버 상태 확인 중..."
    pm2 describe $SERVER_NAME 2>/dev/null
    if [ $? -eq 0 ]; then
        log_success "서버가 실행 중입니다."
    else
        log_error "서버가 실행되지 않습니다."
    fi
}

# 서버 시작
start_server() {
    log_info "서버 시작 중..."
    cd $SERVER_DIR
    pm2 start ecosystem.config.js --only $SERVER_NAME
    if [ $? -eq 0 ]; then
        log_success "서버가 성공적으로 시작되었습니다."
    else
        log_error "서버 시작에 실패했습니다."
    fi
}

# 서버 재시작
restart_server() {
    log_info "서버 재시작 중..."
    pm2 restart $SERVER_NAME
    if [ $? -eq 0 ]; then
        log_success "서버가 성공적으로 재시작되었습니다."
    else
        log_error "서버 재시작에 실패했습니다."
    fi
}

# 서버 중지
stop_server() {
    log_info "서버 중지 중..."
    pm2 stop $SERVER_NAME
    if [ $? -eq 0 ]; then
        log_success "서버가 중지되었습니다."
    else
        log_error "서버 중지에 실패했습니다."
    fi
}

# 서버 삭제
delete_server() {
    log_warning "서버를 완전히 삭제합니다. 계속하시겠습니까? (y/N)"
    read -r response
    if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
        log_info "서버 삭제 중..."
        pm2 delete $SERVER_NAME
        if [ $? -eq 0 ]; then
            log_success "서버가 삭제되었습니다."
        else
            log_error "서버 삭제에 실패했습니다."
        fi
    else
        log_info "삭제가 취소되었습니다."
    fi
}

# 로그 확인
show_logs() {
    log_info "최근 로그 확인 중..."
    if [ -d "$LOG_DIR" ]; then
        echo "=== 에러 로그 ==="
        tail -n 20 "$LOG_DIR/colyseus-error.log" 2>/dev/null || echo "에러 로그 파일이 없습니다."
        echo ""
        echo "=== 출력 로그 ==="
        tail -n 20 "$LOG_DIR/colyseus-out.log" 2>/dev/null || echo "출력 로그 파일이 없습니다."
        echo ""
        echo "=== 통합 로그 ==="
        tail -n 20 "$LOG_DIR/colyseus-combined.log" 2>/dev/null || echo "통합 로그 파일이 없습니다."
    else
        log_error "로그 디렉토리가 존재하지 않습니다."
    fi
}

# 실시간 로그 모니터링
monitor_logs() {
    log_info "실시간 로그 모니터링 시작 (Ctrl+C로 종료)..."
    if [ -d "$LOG_DIR" ]; then
        tail -f "$LOG_DIR/colyseus-combined.log" 2>/dev/null || tail -f "$LOG_DIR/colyseus-out.log"
    else
        log_error "로그 디렉토리가 존재하지 않습니다."
    fi
}

# 메모리 사용량 확인
check_memory() {
    log_info "메모리 사용량 확인 중..."
    pm2 monit --no-daemon &
    MONIT_PID=$!
    sleep 5
    kill $MONIT_PID 2>/dev/null
}

# 시스템 정보
system_info() {
    log_info "시스템 정보 확인 중..."
    echo "=== 시스템 정보 ==="
    echo "CPU 사용량: $(top -l 1 | grep "CPU usage" | awk '{print $3}')"
    echo "메모리 사용량: $(top -l 1 | grep "PhysMem" | awk '{print $2}')"
    echo "디스크 사용량: $(df -h / | tail -1 | awk '{print $5}')"
    echo ""
    echo "=== PM2 프로세스 ==="
    pm2 list
}

# 자동 복구
auto_recovery() {
    log_info "자동 복구 모드 시작..."
    while true; do
        if ! pm2 describe $SERVER_NAME >/dev/null 2>&1; then
            log_warning "서버가 중단되었습니다. 자동 재시작 중..."
            start_server
        fi
        
        # 메모리 사용량 체크
        MEMORY_USAGE=$(pm2 describe $SERVER_NAME 2>/dev/null | grep "memory" | awk '{print $4}' | sed 's/MB//')
        if [ ! -z "$MEMORY_USAGE" ] && [ "$MEMORY_USAGE" -gt 250 ]; then
            log_warning "메모리 사용량이 높습니다 (${MEMORY_USAGE}MB). 재시작 중..."
            restart_server
        fi
        
        sleep 30
    done
}

# 도움말
show_help() {
    echo "Colyseus 서버 원격 제어 스크립트"
    echo ""
    echo "사용법: $0 [명령어]"
    echo ""
    echo "명령어:"
    echo "  status      - 서버 상태 확인"
    echo "  start       - 서버 시작"
    echo "  restart     - 서버 재시작"
    echo "  stop        - 서버 중지"
    echo "  delete      - 서버 완전 삭제"
    echo "  logs        - 최근 로그 확인"
    echo "  monitor     - 실시간 로그 모니터링"
    echo "  memory      - 메모리 사용량 확인"
    echo "  info        - 시스템 정보"
    echo "  auto        - 자동 복구 모드"
    echo "  help        - 이 도움말 표시"
    echo ""
    echo "예시:"
    echo "  $0 status"
    echo "  $0 restart"
    echo "  $0 logs"
}

# 메인 로직
case "${1:-help}" in
    status)
        check_status
        ;;
    start)
        start_server
        ;;
    restart)
        restart_server
        ;;
    stop)
        stop_server
        ;;
    delete)
        delete_server
        ;;
    logs)
        show_logs
        ;;
    monitor)
        monitor_logs
        ;;
    memory)
        check_memory
        ;;
    info)
        system_info
        ;;
    auto)
        auto_recovery
        ;;
    help|*)
        show_help
        ;;
esac