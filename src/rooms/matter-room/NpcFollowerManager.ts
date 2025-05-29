import Matter from 'matter-js'
import { Npc } from '../schema/MatterRoomState'
import { defoldToMatter, matterToDefold, createNpcBody, CATEGORY_NPC, SCREEN_WIDTH, SCREEN_HEIGHT } from './physics'
import { MapSchema } from '@colyseus/schema'

const MARGIN = 40;
function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

export class NpcFollowerManager {
  private world: Matter.World
  private npcs: MapSchema<Npc>
  public leaderId: string
  private myNpcIds: Set<string> = new Set() // 이 매니저가 생성한 NPC ID들
  private npcDirs: Map<string, { x: number; y: number }> = new Map() // 각 NPC별 현재 방향
  
  // 직접 수정 가능한 속성들
  formationAngle: number = Math.PI / 4 // 45도 각도 (0 ~ π/2)
  baseDistance: number = 50 // 기본 간격 (50 ~ 300)
  speedMultiplier: number = 0.8 // 리더 대비 속도 비율 (0.1 ~ 2.0)
  formationSpacing: number = 50 // V자형 내 NPC 간 간격 (20 ~ 200)

  constructor(world: Matter.World, npcs: MapSchema<Npc>, leaderId: string) {
    this.world = world
    this.npcs = npcs
    this.leaderId = leaderId
  }

  spawnFollowers(count: number, size: number) {
    const leader = this.npcs.get(this.leaderId)
    if (!leader) {
      // console.log(`[FOLLOWER] 리더 NPC(state) 없음: leaderId=${this.leaderId}`);
      return
    }

    // 리더의 현재 위치를 기준으로 V자형 배치
    const leaderBody = this.world.bodies.find((b) => b.label === this.leaderId)
    if (!leaderBody) {
      // console.log(`[FOLLOWER] 리더 NPC(body) 없음: leaderId=${this.leaderId}`);
      return
    }

    const leaderPos = leaderBody.position
    const leaderAngle = leaderBody.angle

    // V자형의 각 측면에 NPC 배치
    const sideCount = Math.floor(count / 2)
    
    // 왼쪽/오른쪽 index를 0~sideCount-1로 동일하게 사용
    for (let i = 0; i < sideCount; i++) {
      // 왼쪽
      const angleL = leaderAngle + Math.PI + this.formationAngle
      const distanceL = this.baseDistance + (i * this.formationSpacing)
      const xL = leaderPos.x + Math.cos(angleL) * distanceL
      const yL = leaderPos.y + Math.sin(angleL) * distanceL
      this.createFollower(xL, yL, size, `${this.leaderId}_follower_left_${i}`)
      // 오른쪽
      const angleR = leaderAngle + Math.PI - this.formationAngle
      const distanceR = this.baseDistance + (i * this.formationSpacing)
      const xR = leaderPos.x + Math.cos(angleR) * distanceR
      const yR = leaderPos.y + Math.sin(angleR) * distanceR
      this.createFollower(xR, yR, size, `${this.leaderId}_follower_right_${i}`)
    }
    // console.log(`[FOLLOWER] 팔로워 생성 완료: leaderId=${this.leaderId}, count=${count}, myNpcIds=[${Array.from(this.myNpcIds).join(',')}]`);
  }

  private createFollower(x: number, y: number, size: number, id: string) {
    // 화면 영역 내로 좌표 보정
    const clampedX = clamp(x, MARGIN, SCREEN_WIDTH - MARGIN);
    const clampedY = clamp(y, MARGIN, SCREEN_HEIGHT - MARGIN);
    const body = createNpcBody(this.world, id, clampedX, clampedY, size / 2)

    const npc = new Npc()
    npc.id = id
    npc.x = clampedX
    npc.y = clampedY
    npc.owner_id = 'server'
    npc.size = size
    this.npcs.set(id, npc)
    this.myNpcIds.add(id) // 생성한 NPC ID 추가
    // 최초 방향은 임의로 (1,0) 전방
    this.npcDirs.set(id, { x: 1, y: 0 })
    // console.log(`[FOLLOWER] 팔로워 생성: id=${id}, x=${x}, y=${y}`);
  }

  moveAllFollowers(deltaTime: number) {
    const leader = this.npcs.get(this.leaderId)
    if (!leader) {
      // console.log(`[FOLLOWER] moveAllFollowers: 리더 NPC(state) 없음: leaderId=${this.leaderId}`);
      return
    }

    const leaderBody = this.world.bodies.find((b) => b.label === this.leaderId)
    if (!leaderBody) {
      // console.log(`[FOLLOWER] moveAllFollowers: 리더 NPC(body) 없음: leaderId=${this.leaderId}`);
      return
    }

    const leaderPos = leaderBody.position
    const leaderVelocity = leaderBody.velocity
    const leaderSpeed = Math.sqrt(leaderVelocity.x * leaderVelocity.x + leaderVelocity.y * leaderVelocity.y)
    
    // 리더의 이동 방향 계산
    const leaderDirX = leaderSpeed > 0 ? leaderVelocity.x / leaderSpeed : 0
    const leaderDirY = leaderSpeed > 0 ? leaderVelocity.y / leaderSpeed : 0
    const leaderAngle = Math.atan2(leaderDirY, leaderDirX)

    // 자신이 생성한 NPC만 이동
    for (const id of this.myNpcIds) {
      const npc = this.npcs.get(id)
      if (!npc) {
        // console.log(`[FOLLOWER] moveAllFollowers: 팔로워 NPC(state) 없음: id=${id}`);
        continue
      }

      const followerBody = this.world.bodies.find((b) => b.label === id)
      if (!followerBody) {
        // console.log(`[FOLLOWER] moveAllFollowers: 팔로워 NPC(body) 없음: id=${id}`);
        continue
      }

      const followerPos = followerBody.position
      
      // V자형에서의 상대적 위치 계산 (리더 뒤쪽으로)
      const isLeftSide = id.includes('_follower_left_')
      const formationAngle = isLeftSide ? this.formationAngle : -this.formationAngle
      // index를 항상 follower_left_N, follower_right_N의 N으로 파싱
      const indexMatch = id.match(/_(\d+)$/)
      const index = indexMatch ? parseInt(indexMatch[1]) : 0
      const targetDistance = this.baseDistance + (index * this.formationSpacing)
      const targetAngle = leaderAngle + Math.PI + formationAngle // 리더 뒤쪽으로
      const targetX = leaderPos.x + Math.cos(targetAngle) * targetDistance
      const targetY = leaderPos.y + Math.sin(targetAngle) * targetDistance

      // 벽에 부딪히지 않도록 안전 영역으로 보정
      const safeX = clamp(targetX, MARGIN, SCREEN_WIDTH - MARGIN);
      const safeY = clamp(targetY, MARGIN, SCREEN_HEIGHT - MARGIN);

      // 현재 위치와 목표 위치 사이의 거리 계산
      const dx = safeX - followerPos.x
      const dy = safeY - followerPos.y
      const distanceToTarget = Math.sqrt(dx * dx + dy * dy)

      // 실제 리더와의 거리 계산 (팔로워와 리더의 거리)
      const dxToLeader = leaderPos.x - followerPos.x
      const dyToLeader = leaderPos.y - followerPos.y
      const distToLeader = Math.sqrt(dxToLeader * dxToLeader + dyToLeader * dyToLeader)
      // 목표 간격
      const desiredDist = targetDistance
      // 간격 오차
      const distError = distToLeader - desiredDist
      const distErrorAbs = Math.abs(distError)

      // 속도 조절 (거리에 따라)
      const speed = leaderSpeed * this.speedMultiplier
      // maxSpeed: 기본값과 오차 기반값 중 작은 값, 그리고 상한선(10) 적용
      const maxSpeed = Math.min(
        Math.max(speed * 1.5, distErrorAbs * 0.5),
        10 // 상한선
      )

      // 힘(속도) 계산: 오차가 작으면 힘도 작게, 아주 작으면 0
      let force = distanceToTarget * 0.2 + distError * 0.1;
      if (distErrorAbs < 3 && distanceToTarget < 3) {
        force = 0; // 거의 정지
      } else {
        force = Math.min(force, maxSpeed);
      }

      // 목표 지점으로 이동
      if (distanceToTarget > 5) {
        const angle = Math.atan2(dy, dx);
        const leaderForceX = leaderVelocity.x * this.speedMultiplier;
        const leaderForceY = leaderVelocity.y * this.speedMultiplier;
        Matter.Body.setVelocity(followerBody, {
          x: Math.cos(angle) * force + leaderForceX,
          y: Math.sin(angle) * force + leaderForceY
        });
        Matter.Body.setAngle(followerBody, leaderAngle);
      } else {
        // 오차가 아주 작으면 속도 0으로 고정
        Matter.Body.setVelocity(followerBody, { x: 0, y: 0 });
      }

      // 위치 업데이트
      const defoldPos = matterToDefold(followerBody.position)
      npc.x = defoldPos.x
      npc.y = defoldPos.y
      
      // 방향 업데이트 (WanderManager 방식)
      const dirX = dx / distanceToTarget
      const dirY = dy / distanceToTarget
      npc.dirx = dirX
      npc.diry = dirY
      // 현재 방향 갱신
      this.npcDirs.set(id, { x: dirX, y: dirY })
      // 디버깅: 팔로워 이동 로그
      // console.log(`[FOLLOWER] 팔로워 이동: id=${id}, pos=(${npc.x},${npc.y}), target=(${targetX},${targetY}), dir=(${dirX},${dirY}), leader=(${leaderPos.x},${leaderPos.y})`);
    }
  }

  public getFollowerCount(): number {
    return this.myNpcIds.size;
  }
} 