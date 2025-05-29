import Matter from 'matter-js'
import { Npc } from '../schema/MatterRoomState'
import { defoldToMatter, matterToDefold } from './physics'
import { MapSchema } from '@colyseus/schema'

export class NpcFollowerManager {
  private world: Matter.World
  private npcs: MapSchema<Npc>
  private leaderId: string
  private myNpcIds: Set<string> = new Set() // 이 매니저가 생성한 NPC ID들
  private npcDirs: Map<string, { x: number; y: number }> = new Map() // 각 NPC별 현재 방향
  
  // 직접 수정 가능한 속성들
  formationAngle: number = Math.PI / 4 // 45도 각도 (0 ~ π/2)
  baseDistance: number = 100 // 기본 간격 (50 ~ 300)
  speedMultiplier: number = 0.8 // 리더 대비 속도 비율 (0.1 ~ 2.0)
  formationSpacing: number = 50 // V자형 내 NPC 간 간격 (20 ~ 200)

  constructor(world: Matter.World, npcs: MapSchema<Npc>, leaderId: string) {
    this.world = world
    this.npcs = npcs
    this.leaderId = leaderId
  }

  spawnFollowers(count: number, size: number) {
    const leader = this.npcs.get(this.leaderId)
    if (!leader) return

    // 리더의 현재 위치를 기준으로 V자형 배치
    const leaderBody = this.world.bodies.find((b) => b.label === this.leaderId)
    if (!leaderBody) return

    const leaderPos = leaderBody.position
    const leaderAngle = leaderBody.angle

    // V자형의 각 측면에 NPC 배치
    const sideCount = Math.floor(count / 2)
    
    // 왼쪽 측면 NPC 생성
    for (let i = 0; i < sideCount; i++) {
      const angle = leaderAngle + Math.PI + this.formationAngle // 리더 뒤쪽으로
      const distance = this.baseDistance + (i * this.formationSpacing)
      const x = leaderPos.x + Math.cos(angle) * distance
      const y = leaderPos.y + Math.sin(angle) * distance
      
      this.createFollower(x, y, size, `follower_left_${i}`)
    }

    // 오른쪽 측면 NPC 생성
    for (let i = 0; i < sideCount; i++) {
      const angle = leaderAngle + Math.PI - this.formationAngle // 리더 뒤쪽으로
      const distance = this.baseDistance + (i * this.formationSpacing)
      const x = leaderPos.x + Math.cos(angle) * distance
      const y = leaderPos.y + Math.sin(angle) * distance
      
      this.createFollower(x, y, size, `follower_right_${i}`)
    }
  }

  private createFollower(x: number, y: number, size: number, id: string) {
    const body = Matter.Bodies.circle(x, y, size / 2, {
      label: id,
      frictionAir: 0.1,
      restitution: 0.6,
      density: 0.001,
    })

    Matter.World.add(this.world, body)

    const npc = new Npc()
    npc.id = id
    npc.x = x
    npc.y = y
    npc.owner_id = 'server'
    npc.size = size
    this.npcs.set(id, npc)
    this.myNpcIds.add(id) // 생성한 NPC ID 추가
    // 최초 방향은 임의로 (1,0) 전방
    this.npcDirs.set(id, { x: 1, y: 0 })
  }

  moveAllFollowers(deltaTime: number) {
    const leader = this.npcs.get(this.leaderId)
    if (!leader) return

    const leaderBody = this.world.bodies.find((b) => b.label === this.leaderId)
    if (!leaderBody) return

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
      if (!npc) continue

      const followerBody = this.world.bodies.find((b) => b.label === id)
      if (!followerBody) continue

      const followerPos = followerBody.position
      
      // V자형에서의 상대적 위치 계산 (리더 뒤쪽으로)
      const isLeftSide = id.startsWith('follower_left')
      const formationAngle = isLeftSide ? this.formationAngle : -this.formationAngle
      
      // 목표 위치 계산 (리더의 현재 위치 기준, 뒤쪽으로)
      const targetAngle = leaderAngle + Math.PI + formationAngle // 리더 뒤쪽으로
      const index = parseInt(id.split('_').pop() || '0')
      const distance = this.baseDistance + (index * this.formationSpacing)
      
      const targetX = leaderPos.x + Math.cos(targetAngle) * distance
      const targetY = leaderPos.y + Math.sin(targetAngle) * distance

      // 현재 위치와 목표 위치 사이의 거리 계산
      const dx = targetX - followerPos.x
      const dy = targetY - followerPos.y
      const distanceToTarget = Math.sqrt(dx * dx + dy * dy)

      // 속도 조절 (거리에 따라)
      const speed = leaderSpeed * this.speedMultiplier
      const maxSpeed = speed * 1.5 // 최대 속도 제한

      // 목표 지점으로 이동
      if (distanceToTarget > 5) { // 5는 허용 오차
        const angle = Math.atan2(dy, dx)
        const force = Math.min(distanceToTarget * 0.2, maxSpeed) // 힘을 0.1에서 0.2로 증가
        
        // 리더의 속도에 기반한 추가 힘 적용
        const leaderForceX = leaderVelocity.x * this.speedMultiplier
        const leaderForceY = leaderVelocity.y * this.speedMultiplier
        
        Matter.Body.setVelocity(followerBody, {
          x: Math.cos(angle) * force + leaderForceX,
          y: Math.sin(angle) * force + leaderForceY
        })

        // 리더의 회전을 따라가도록 각도 조정
        Matter.Body.setAngle(followerBody, leaderAngle)
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
    }
  }
} 