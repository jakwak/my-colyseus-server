import Matter from 'matter-js'
import { Npc } from '../schema/MatterRoomState'
import {
  defoldToMatter,
  matterToDefold,
  createNpcBody,
  CATEGORY_NPC,
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
} from './physics'
import { MapSchema } from '@colyseus/schema'

const MARGIN = 40
function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val))
}

export class NpcFollowerManager {
  private world: Matter.World
  private npcs: MapSchema<Npc>
  public leaderId: string
  public myNpcIds: Set<string> = new Set() // 이 매니저가 생성한 NPC ID들
  private npcDirs: Map<string, { x: number; y: number }> = new Map() // 각 NPC별 현재 방향
  public formationType: 'v' | 'line' | 'escort' // 대형 타입

  // 직접 수정 가능한 속성들
  formationAngle: number = Math.PI / 4 // 45도 각도 (0 ~ π/2)
  baseDistance: number = 50 // 기본 간격 (50 ~ 300)
  speedMultiplier: number = 0.5 // 리더 대비 속도 비율 (0.1 ~ 2.0)
  formationSpacing: number = 50 // V자형 내 NPC 간 간격 (20 ~ 200)

  constructor(
    world: Matter.World,
    npcs: MapSchema<Npc>,
    leaderId: string,
    formationType: 'v' | 'line' | 'escort' = 'v'
  ) {
    this.world = world
    this.npcs = npcs
    this.leaderId = leaderId
    this.formationType = formationType
  }

  spawnFollowers(count: number, size: number) {
    const leader = this.npcs.get(this.leaderId)
    if (!leader) return

    const leaderBody = this.world.bodies.find((b) => b.label === this.leaderId)
    if (!leaderBody) return

    const leaderPos = leaderBody.position
    const leaderAngle = leaderBody.angle

    if (this.formationType === 'escort') {
      // Escort 모드일 때 NPC 수에 따른 배치
      if (count === 1) {
        // 1개일 때: 리더 앞에 배치
        const distance = this.baseDistance
        const angle = leaderAngle // 리더의 정면
        const x = leaderPos.x + Math.cos(angle) * distance
        const y = leaderPos.y + Math.sin(angle) * distance
        this.createFollower(x, y, size, `${this.leaderId}_follower_front`)
      } else if (count === 2) {
        // 2개일 때: 리더 양옆에 배치
        const distance = this.baseDistance
        // 왼쪽
        const angleL = leaderAngle + Math.PI / 2 // 90도
        const xL = leaderPos.x + Math.cos(angleL) * distance
        const yL = leaderPos.y + Math.sin(angleL) * distance
        this.createFollower(xL, yL, size, `${this.leaderId}_follower_left`)
        // 오른쪽
        const angleR = leaderAngle - Math.PI / 2 // -90도
        const xR = leaderPos.x + Math.cos(angleR) * distance
        const yR = leaderPos.y + Math.sin(angleR) * distance
        this.createFollower(xR, yR, size, `${this.leaderId}_follower_right`)
      } else if (count === 3) {
        // 3개일 때: 리더 앞과 양옆에 배치
        const distance = this.baseDistance
        // 앞
        const angleF = leaderAngle
        const xF = leaderPos.x + Math.cos(angleF) * distance
        const yF = leaderPos.y + Math.sin(angleF) * distance
        this.createFollower(xF, yF, size, `${this.leaderId}_follower_front`)
        // 왼쪽
        const angleL = leaderAngle + Math.PI / 2
        const xL = leaderPos.x + Math.cos(angleL) * distance
        const yL = leaderPos.y + Math.sin(angleL) * distance
        this.createFollower(xL, yL, size, `${this.leaderId}_follower_left`)
        // 오른쪽
        const angleR = leaderAngle - Math.PI / 2
        const xR = leaderPos.x + Math.cos(angleR) * distance
        const yR = leaderPos.y + Math.sin(angleR) * distance
        this.createFollower(xR, yR, size, `${this.leaderId}_follower_right`)
      } else {
        // 4개 이상일 때: 기존 박스 대형 사용
        const perSide = Math.floor(count / 4)
        const boxCount = perSide * 4
        const boxDistance = this.baseDistance + this.formationSpacing * 0.8

        // 박스 대형 배치
        for (let side = 0; side < 4; side++) {
          for (let j = 0; j < perSide; j++) {
            const t = (j + 0.5) / perSide
            let x = 0,
              y = 0
            if (side === 0) {
              // top
              x = -boxDistance + t * 2 * boxDistance
              y = -boxDistance
            } else if (side === 1) {
              // right
              x = boxDistance
              y = -boxDistance + t * 2 * boxDistance
            } else if (side === 2) {
              // bottom
              x = boxDistance - t * 2 * boxDistance
              y = boxDistance
            } else if (side === 3) {
              // left
              x = -boxDistance
              y = boxDistance - t * 2 * boxDistance
            }

            // 리더 진행방향에 맞춰 회전
            const cosA = Math.cos(leaderAngle)
            const sinA = Math.sin(leaderAngle)
            const rx = x * cosA - y * sinA
            const ry = x * sinA + y * cosA

            const finalX = leaderPos.x + rx
            const finalY = leaderPos.y + ry
            this.createFollower(
              finalX,
              finalY,
              size,
              `${this.leaderId}_follower_box_${side}_${j}`
            )
          }
        }

        // 남은 NPC들은 리더 뒤에 일렬로 배치
        const remainingCount = count - boxCount
        for (let i = 0; i < remainingCount; i++) {
          const distance = boxDistance + (i + 1) * this.formationSpacing
          const angle = leaderAngle + Math.PI
          const x = leaderPos.x + Math.cos(angle) * distance
          const y = leaderPos.y + Math.sin(angle) * distance
          this.createFollower(x, y, size, `${this.leaderId}_follower_back_${i}`)
        }
      }
    } else {
      // 기존 V자형과 일자형 배치 로직 유지
      // V자형의 각 측면에 NPC 배치
      const sideCount = Math.floor(count / 2)

      // 왼쪽/오른쪽 index를 0~sideCount-1로 동일하게 사용
      for (let i = 0; i < sideCount; i++) {
        // 왼쪽
        const angleL = leaderAngle + Math.PI + this.formationAngle
        const distanceL = this.baseDistance + i * this.formationSpacing
        const xL = leaderPos.x + Math.cos(angleL) * distanceL
        const yL = leaderPos.y + Math.sin(angleL) * distanceL
        this.createFollower(xL, yL, size, `${this.leaderId}_follower_left_${i}`)
        // 오른쪽
        const angleR = leaderAngle + Math.PI - this.formationAngle
        const distanceR = this.baseDistance + i * this.formationSpacing
        const xR = leaderPos.x + Math.cos(angleR) * distanceR
        const yR = leaderPos.y + Math.sin(angleR) * distanceR
        this.createFollower(
          xR,
          yR,
          size,
          `${this.leaderId}_follower_right_${i}`
        )
      }
      // count가 홀수면 남은 1개는 리더 바로 뒤에 일자형으로 배치
      if (count % 2 === 1) {
        // 리더 바로 뒤에 딱 붙이기: 일자 대형과 동일하게 처리
        const leader = this.npcs.get(this.leaderId)
        const leaderSize = leader ? leader.size : size
        const distanceC = leaderSize / 2 + size / 2 + 50
        // leaderAngle 계산 (일자형과 동일)
        let angleC = leaderAngle + Math.PI
        const xC = leaderPos.x + Math.cos(angleC) * distanceC
        const yC = leaderPos.y + Math.sin(angleC) * distanceC
        this.createFollower(xC, yC, size, `${this.leaderId}_follower_center`)
      }
    }
    // console.log(`[FOLLOWER] 팔로워 생성 완료: leaderId=${this.leaderId}, count=${count}, myNpcIds=[${Array.from(this.myNpcIds).join(',')}]`);
  }

  private createFollower(x: number, y: number, size: number, id: string) {
    // 화면 영역 내로 좌표 보정
    const clampedX = clamp(x, MARGIN, SCREEN_WIDTH - MARGIN)
    const clampedY = clamp(y, MARGIN, SCREEN_HEIGHT - MARGIN)
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

  moveAllFollowers(
    deltaTime: number,
    mode: 'v' | 'line' | 'escort' | null = null
  ) {
    const leader = this.npcs.get(this.leaderId) 
    if (!leader) {
      console.log(
        `[FOLLOWER] moveAllFollowers: 리더 NPC(state) 없음: leaderId=${this.leaderId}`
      )
      return
    }

    const leaderBody = this.world.bodies.find((b) => b.label === this.leaderId)
    if (!leaderBody) {
      console.log(
        `[FOLLOWER] moveAllFollowers: 리더 NPC(body) 없음: leaderId=${this.leaderId}`
      )
      return
    }

    const leaderPos = leaderBody.position
    const leaderVelocity = leaderBody.velocity
    const leaderSpeed = Math.sqrt(
      leaderVelocity.x * leaderVelocity.x + leaderVelocity.y * leaderVelocity.y
    )

    // 리더의 이동 방향 계산
    const leaderDirX = leaderSpeed > 0 ? leaderVelocity.x / leaderSpeed : 0
    const leaderDirY = leaderSpeed > 0 ? leaderVelocity.y / leaderSpeed : 0
    const leaderAngle = Math.atan2(leaderDirY, leaderDirX)

    // 자신이 생성한 NPC만 이동
    const followerIds = Array.from(this.myNpcIds)
    // V자형일 때는 좌/우 그룹별로 index를 따로 부여
    let leftIdx = 0,
      rightIdx = 0

    // escort(박스) 대형용 offset 계산 함수
    function getBoxEscortOffsets(count: number, boxDistance: number) {
      const offsets: { x: number; y: number }[] = []
      const perSide = Math.floor(count / 4)
      for (let side = 0; side < 4; side++) {
        for (let j = 0; j < perSide; j++) {
          const t = (j + 0.5) / perSide // 0~1 등분 (꼭짓점과 중간 모두 분산)
          let x = 0,
            y = 0
          if (side === 0) {
            // top
            x = -boxDistance + t * 2 * boxDistance
            y = -boxDistance
          } else if (side === 1) {
            // right
            x = boxDistance
            y = -boxDistance + t * 2 * boxDistance
          } else if (side === 2) {
            // bottom
            x = boxDistance - t * 2 * boxDistance
            y = boxDistance
          } else if (side === 3) {
            // left
            x = -boxDistance
            y = boxDistance - t * 2 * boxDistance
          }
          offsets.push({ x, y })
        }
      }
      return offsets
    }

    for (let i = 0; i < followerIds.length; i++) {
      const id = followerIds[i]
      const npc = this.npcs.get(id)
      if (!npc) continue
      const followerBody = this.world.bodies.find((b) => b.label === id)
      if (!followerBody) continue
      const followerPos = followerBody.position

      let targetX, targetY, targetDistance
      if (mode === 'escort' || this.formationType === 'escort') {
        const followerCount = followerIds.length
        const distance = this.baseDistance

        if (followerCount === 1) {
          // 1개일 때: 리더 앞에 배치
          targetX = leaderPos.x + Math.cos(leaderAngle) * distance
          targetY = leaderPos.y + Math.sin(leaderAngle) * distance
          targetDistance = distance
        } else if (followerCount === 2) {
          // 2개일 때: 리더 양옆에 배치
          if (id.includes('_follower_left')) {
            // 왼쪽
            targetX =
              leaderPos.x + Math.cos(leaderAngle + Math.PI / 2) * distance
            targetY =
              leaderPos.y + Math.sin(leaderAngle + Math.PI / 2) * distance
          } else {
            // 오른쪽
            targetX =
              leaderPos.x + Math.cos(leaderAngle - Math.PI / 2) * distance
            targetY =
              leaderPos.y + Math.sin(leaderAngle - Math.PI / 2) * distance
          }
          targetDistance = distance
        } else if (followerCount === 3) {
          // 3개일 때: 리더 앞과 양옆에 배치
          if (id.includes('_follower_front')) {
            // 앞
            targetX = leaderPos.x + Math.cos(leaderAngle) * distance
            targetY = leaderPos.y + Math.sin(leaderAngle) * distance
          } else if (id.includes('_follower_left')) {
            // 왼쪽
            targetX =
              leaderPos.x + Math.cos(leaderAngle + Math.PI / 2) * distance
            targetY =
              leaderPos.y + Math.sin(leaderAngle + Math.PI / 2) * distance
          } else {
            // 오른쪽
            targetX =
              leaderPos.x + Math.cos(leaderAngle - Math.PI / 2) * distance
            targetY =
              leaderPos.y + Math.sin(leaderAngle - Math.PI / 2) * distance
          }
          targetDistance = distance
        } else {
          // 4개 이상일 때: 기존 박스 대형 사용
          const perSide = Math.floor(followerCount / 4)
          const boxCount = perSide * 4
          const boxDistance = this.baseDistance + this.formationSpacing * 0.8

          if (i < boxCount) {
            // 박스 변에 균등 배치
            const offsets = getBoxEscortOffsets(boxCount, boxDistance)
            const off = offsets[i]
            const cosA = Math.cos(leaderAngle)
            const sinA = Math.sin(leaderAngle)
            const rx = off.x * cosA - off.y * sinA
            const ry = off.x * sinA + off.y * cosA
            targetX = leaderPos.x + rx
            targetY = leaderPos.y + ry
            targetDistance = Math.sqrt(rx * rx + ry * ry)
          } else {
            // 나머지는 리더 뒤 일렬
            const lineIdx = i - boxCount
            targetDistance = boxDistance + (lineIdx + 1) * this.formationSpacing
            const targetAngle = leaderAngle + Math.PI
            targetX = leaderPos.x + Math.cos(targetAngle) * targetDistance
            targetY = leaderPos.y + Math.sin(targetAngle) * targetDistance
          }
        }
      } else if (
        (mode === 'v' || this.formationType === 'v') &&
        id.includes('_follower_center')
      ) {
        // V자 대형이지만 center 팔로워는 항상 일자 대형처럼 리더 뒤로
        targetDistance = this.baseDistance
        const targetAngle = leaderAngle + Math.PI
        targetX = leaderPos.x + Math.cos(targetAngle) * targetDistance
        targetY = leaderPos.y + Math.sin(targetAngle) * targetDistance
      } else if (mode === 'v' || this.formationType === 'v') {
        // 기존 V자형
        const isLeftSide = id.includes('_follower_left_')
        const formationAngle = isLeftSide
          ? this.formationAngle
          : -this.formationAngle
        let index
        if (isLeftSide) {
          index = leftIdx++
        } else {
          index = rightIdx++
        }
        targetDistance = this.baseDistance + index * this.formationSpacing
        const targetAngle = leaderAngle + Math.PI + formationAngle
        targetX = leaderPos.x + Math.cos(targetAngle) * targetDistance
        targetY = leaderPos.y + Math.sin(targetAngle) * targetDistance
      } else {
        // 일자형: 리더 뒤쪽으로 일렬 정렬
        const index = i
        targetDistance = this.baseDistance + index * this.formationSpacing
        const targetAngle = leaderAngle + Math.PI
        targetX = leaderPos.x + Math.cos(targetAngle) * targetDistance
        targetY = leaderPos.y + Math.sin(targetAngle) * targetDistance
      }

      // 벽에 부딪히지 않도록 안전 영역으로 보정
      const safeX = clamp(targetX, MARGIN, SCREEN_WIDTH - MARGIN)
      const safeY = clamp(targetY, MARGIN, SCREEN_HEIGHT - MARGIN)

      // 현재 위치와 목표 위치 사이의 거리 계산
      const dx = safeX - followerPos.x
      const dy = safeY - followerPos.y
      const distanceToTarget = Math.sqrt(dx * dx + dy * dy)

      // 실제 리더와의 거리 계산 (팔로워와 리더의 거리)
      const dxToLeader = leaderPos.x - followerPos.x
      const dyToLeader = leaderPos.y - followerPos.y
      const distToLeader = Math.sqrt(
        dxToLeader * dxToLeader + dyToLeader * dyToLeader
      )
      // 목표 간격
      const desiredDist = targetDistance
      // 간격 오차
      const distError = distToLeader - desiredDist
      const distErrorAbs = Math.abs(distError)

      // 속도 조절 (거리에 따라)
      const speed = leaderSpeed * this.speedMultiplier
      // maxSpeed: 기본값과 오차 기반값 중 작은 값, 그리고 상한선(2) 적용
      const maxSpeed = Math.min(
        Math.max(speed * 1.5, distErrorAbs * 0.5),
        2 // 상한선
      )

      // 힘(속도) 계산: 오차가 작으면 힘도 작게, 아주 작으면 0
      let force = distanceToTarget * 0.2 + distError * 0.1
      if (distErrorAbs < 3 && distanceToTarget < 3) {
        force = 0 // 거의 정지
      } else {
        force = Math.min(force, maxSpeed)
      }

      // 목표 지점으로 이동
      if (distanceToTarget > 5) {
        const angle = Math.atan2(dy, dx)
        const leaderForceX = leaderVelocity.x * this.speedMultiplier
        const leaderForceY = leaderVelocity.y * this.speedMultiplier
        Matter.Body.setVelocity(followerBody, {
          x: Math.cos(angle) * force + leaderForceX,
          y: Math.sin(angle) * force + leaderForceY,
        })
        Matter.Body.setAngle(followerBody, leaderAngle)
      } else {
        // 오차가 아주 작으면 속도 0으로 고정
        Matter.Body.setVelocity(followerBody, { x: 0, y: 0 })
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
    return this.myNpcIds.size
  }

  // NpcFollowerManager.ts에 추가
  public changeLeader(newLeaderId: string) {
    this.leaderId = newLeaderId
    // 모든 팔로워의 owner_id도 업데이트
    this.myNpcIds.forEach((followerId) => {
      const follower = this.npcs.get(followerId)
      if (follower) {
        follower.owner_id = newLeaderId
      }
    })
  }
}
