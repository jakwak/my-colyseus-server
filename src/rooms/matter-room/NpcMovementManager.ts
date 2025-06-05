import Matter from 'matter-js'
import { Npc, Player } from '../schema/MatterRoomState'
import { MapSchema } from '@colyseus/schema'
import { clamp, matterToDefold } from './NpcPhysicsUtils'
import { NpcFormationManager } from './NpcFormationManager'
import { SCREEN_WIDTH, SCREEN_HEIGHT } from './physics'

const MARGIN = 40

export class NpcMovementManager {
  private evadeStates: Map<
    string,
    { evading: boolean; angle: number; startTime: number }
  > = new Map()

  constructor(
    private world: Matter.World,
    private npcs: MapSchema<Npc>,
    private myNpcIds: Set<string>,
    private npcDirs: Map<string, { x: number; y: number }>,
    private formationManager: NpcFormationManager,
    private speedMultiplier: number
  ) {}

  public moveFollower(
    id: string,
    i: number,
    role: string | undefined,
    followerBody: Matter.Body,
    npc: Npc,
    followerIds: string[],
    leaderPos: any,
    leaderAngle: number,
    leaderSpeed: number,
    checkReturningToFormation: boolean = false
  ): number {
    const target = this.formationManager.getTargetPosition(
      id,
      i,
      role,
      followerIds,
      leaderPos,
      leaderAngle
    )
    return this.moveFollowerToTarget(
      followerBody,
      npc,
      target,
      leaderAngle,
      leaderSpeed,
      false
    )
  }

  public moveToTemporaryTarget(
    id: string,
    followerBody: Matter.Body,
    npc: Npc,
    leaderAngle: number,
    leaderSpeed: number,
    targetPlayerId: string,
    statePlayers: MapSchema<Player> | null
  ) {
    // 플레이어 추적: 플레이어의 현재 위치를 직접 타겟으로 설정
    let targetX = 0,
      targetY = 0
    if (targetPlayerId && statePlayers) {
      const player = statePlayers.get(targetPlayerId)
      if (player) {
        targetX = player.x
        targetY = SCREEN_HEIGHT - player.y // Y축 반전
      }
    }

    // 플레이어 위치를 직접 타겟으로 설정 (오프셋 제거)
    const target = {
      x: targetX,
      y: targetY,
    }

    const dx = target.x - followerBody.position.x
    const dy = target.y - followerBody.position.y
    const distanceToTarget = Math.sqrt(dx * dx + dy * dy)

    let evadeState = this.evadeStates.get(id)

    if (evadeState && evadeState.evading) {
      // 회피 중: 3초 동안은 무조건 직진
      if (Date.now() - evadeState.startTime >= 3000) {
        // 회피 종료, 다음 프레임부터는 타겟 추적 및 재회피 가능
        this.evadeStates.set(id, { evading: false, angle: 0, startTime: 0 })
      } else {
        const moveAngle = evadeState.angle
        const speed = 2

        // 회피 방향으로 이동할 목표 위치 계산
        const targetX = followerBody.position.x + Math.cos(moveAngle) * 100
        const targetY = followerBody.position.y + Math.sin(moveAngle) * 100

        // moveFollowerToTarget 함수를 사용하여 안전하게 이동
        this.moveFollowerToTarget(
          followerBody,
          npc,
          { x: targetX, y: targetY },
          moveAngle,
          speed,
          true,
          speed
        )
        return
      }
    }

    // 회피 중이 아니면, 플레이어에게 가까워질 때 회피 진입
    if (!evadeState || !evadeState.evading) {
      if (distanceToTarget <= 100) {
        // 회피 거리를 100으로 증가 (더 일찍 회피)
        // 현재 이동 방향 기준으로 30도(또는 -30도) 회전하여 회피
        const currentMoveAngle = Math.atan2(dy, dx)
        const evadeAngle =
          currentMoveAngle + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 6) // 30도
        this.evadeStates.set(id, {
          evading: true,
          angle: evadeAngle,
          startTime: Date.now(),
        })
        return
      }
    }

    // 플레이어를 향해 직진
    this.moveFollowerToTarget(
      followerBody,
      npc,
      target,
      leaderAngle,
      leaderSpeed,
      true,
      3
    ) // 고정 속도로 직진
  }

  private moveFollowerToTarget(
    followerBody: Matter.Body,
    npc: Npc,
    target: { x: number; y: number },
    leaderAngle: number,
    leaderSpeed: number,
    useFixedSpeed?: boolean,
    fixedSpeed?: number
  ): number {
    const safeX = clamp(target.x, MARGIN, SCREEN_WIDTH - MARGIN)
    const safeY = clamp(target.y, MARGIN, SCREEN_HEIGHT - MARGIN)
    const dx = safeX - followerBody.position.x
    const dy = safeY - followerBody.position.y
    const distanceToTarget = Math.sqrt(dx * dx + dy * dy)

    // 속도 계산 - 임시 타겟이면 고정 속도, 아니면 리더 속도 기반
    let speed: number
    if (useFixedSpeed && fixedSpeed !== undefined) {
      speed = fixedSpeed
    } else {
      speed = leaderSpeed * this.speedMultiplier
    }

    const maxSpeed = Math.min(
      Math.max(speed * 1.5, distanceToTarget * 0.5),
      useFixedSpeed ? fixedSpeed || 200 : 2
    )
    let force = distanceToTarget * 0.2
    if (distanceToTarget < 3) {
      force = 0
    } else {
      force = Math.min(force, maxSpeed)
    }
    if (distanceToTarget > 5) {
      const angle = Math.atan2(dy, dx)
      // 부드러운 회전 적용
      const currentAngle = followerBody.angle
      let targetAngle = leaderAngle
      let angleDiff = targetAngle - currentAngle
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI
      const lerpFactor = 0.15
      const newAngle = currentAngle + angleDiff * lerpFactor
      Matter.Body.setVelocity(followerBody, {
        x: Math.cos(angle) * force,
        y: Math.sin(angle) * force,
      })
      Matter.Body.setAngle(followerBody, newAngle)
    } else {
      Matter.Body.setVelocity(followerBody, { x: 0, y: 0 })
    }
    const defoldPos = matterToDefold(followerBody.position)
    npc.x = defoldPos.x
    npc.y = defoldPos.y
    const dirX = dx / (distanceToTarget || 1)
    const dirY = dy / (distanceToTarget || 1)
    npc.dirx = dirX
    npc.diry = dirY
    this.npcDirs.set(npc.id, { x: dirX, y: dirY })
    return distanceToTarget
  }

  public getDirection(id: string): { x: number; y: number } {
    return this.npcDirs.get(id) || { x: 1, y: 0 }
  }

  public setDirection(id: string, dir: { x: number; y: number }) {
    this.npcDirs.set(id, dir)
  }

  public clearEvadeState(id: string) {
    this.evadeStates.delete(id)
  }
} 