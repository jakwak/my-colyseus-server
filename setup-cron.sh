#!/bin/bash

# cron을 통한 자동 모니터링 설정
# 이 스크립트는 매 5분마다 서버 상태를 확인하고 필요시 재시작합니다

SERVER_DIR="/Users/ondalssam/Desktop/my-colyseus-server"
CRON_JOB="*/5 * * * * cd $SERVER_DIR && ./remote-control.sh status > /dev/null 2>&1"

echo "Colyseus 서버 자동 모니터링 cron 작업 설정"
echo ""

# 현재 cron 작업 확인
echo "현재 cron 작업:"
crontab -l 2>/dev/null | grep -v "colyseus" || echo "현재 cron 작업이 없습니다."

echo ""
echo "새로운 cron 작업 추가:"
echo "$CRON_JOB"
echo ""

# 사용자 확인
read -p "이 cron 작업을 추가하시겠습니까? (y/N): " -r response
if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
    # 기존 cron 작업에 추가
    (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
    echo "cron 작업이 성공적으로 추가되었습니다."
    echo ""
    echo "설정된 cron 작업:"
    crontab -l
else
    echo "cron 작업 추가가 취소되었습니다."
fi