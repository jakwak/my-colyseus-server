import Matter from 'matter-js'
import { Npc, Player, Bullet } from '../schema/MatterRoomState'
import { MapSchema } from '@colyseus/schema'
import { CATEGORY_BULLET, CATEGORY_NPC, CATEGORY_PLAYER, CATEGORY_WALL, matterToDefold, SCREEN_HEIGHT, SCREEN_WIDTH } from './physics'

export interface RaycastHit {
  playerId: string
  player: Player
  distance: number
  hitPoint: { x: number, y: number }
}

export class NpcCombatManager {
  private world: Matter.World
  private npcs: MapSchema<Npc>
  private players: MapSchema<Player>
  private bullets: MapSchema<Bullet>
  
  // 전투 설정
  private detectionRange: number = 1000 // 감지 범위
  private shootingRange: number = 800 // 사격 범위
  private shootCooldown: number = 500 // 1초 쿨다운
  private bulletSpeed: number = 5
  
  // NPC별 마지막 사격 시간 추적
  private lastShootTime: Map<string, number> = new Map()
  
  // NPC별 이전 위치 저장 (이동 방향 계산용)
  private npcPreviousPositions: Map<string, { x: number, y: number }> = new Map()
  
  constructor(
    world: Matter.World,
    npcs: MapSchema<Npc>,
    players: MapSchema<Player>,
    bullets: MapSchema<Bullet>
  ) {
    this.world = world
    this.npcs = npcs
    this.players = players
    this.bullets = bullets
  }

  // NPC의 실제 이동 방향 계산
  private getNpcMovementDirection(npcId: string): { x: number, y: number } | null {
    const npc = this.npcs.get(npcId)
    if (!npc) return null

    const currentPos = { x: npc.x, y: npc.y }
    const previousPos = this.npcPreviousPositions.get(npcId)
    
    if (!previousPos) {
      // 이전 위치가 없으면 현재 위치를 저장하고 기본 방향 반환
      this.npcPreviousPositions.set(npcId, currentPos)
      return { x: npc.dirx || 1, y: npc.diry || 0 }
    }

    // 이동 벡터 계산
    const deltaX = currentPos.x - previousPos.x
    const deltaY = currentPos.y - previousPos.y
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)

    // 이전 위치 업데이트
    this.npcPreviousPositions.set(npcId, currentPos)

    // 이동이 거의 없으면 기존 방향 사용
    if (distance < 0.1) {
      return { x: npc.dirx || 1, y: npc.diry || 0 }
    }

    // 정규화된 이동 방향 반환
    return {
      x: deltaX / distance,
      y: deltaY / distance
    }
  }

  // NPC 이동 방향으로 레이캐스트하여 플레이어 감지
  public detectPlayerInMovementDirection(npcId: string): RaycastHit | null {
    const npc = this.npcs.get(npcId)
    if (!npc) return null

    const npcBody = this.world.bodies.find(b => b.label === npcId)
    if (!npcBody) return null

    // NPC 위치와 실제 이동 방향
    const npcPos = { x: npc.x, y: SCREEN_HEIGHT - npc.y } // Matter 좌표계로 변환
    const movementDirection = this.getNpcMovementDirection(npcId)
    if (!movementDirection) return null

    const npcDirection = { x: movementDirection.x, y: -movementDirection.y } // Y축 반전

    // 레이캐스트 끝점 계산
    const rayEnd = {
      x: npcPos.x + npcDirection.x * this.detectionRange,
      y: npcPos.y + npcDirection.y * this.detectionRange
    }

    // Matter.js Query.ray로 레이캐스트 수행
    const raycastResults = Matter.Query.ray(
      this.world.bodies,
      npcPos,
      rayEnd
    )

    // 플레이어 바디만 필터링하고 가장 가까운 것 찾기
    let closestPlayerHit: RaycastHit | null = null
    let closestDistance = Infinity

    for (const collision of raycastResults) {
      const bodyLabel = collision.bodyA.label
      
      // 플레이어 바디인지 확인 (player_ 접두사 또는 sessionId)
      const isPlayerBody = bodyLabel.startsWith('player_') || this.players.has(bodyLabel)
      if (!isPlayerBody) continue

      // 플레이어 ID 추출
      const playerId = bodyLabel.startsWith('player_') ? 
        bodyLabel.replace('player_', '') : bodyLabel
      
      const player = this.players.get(playerId)
      if (!player) continue

      // 충돌점까지의 거리 계산
      const hitPoint = collision.bodyB ? collision.bodyB.position : collision.bodyA.position
      const distance = Math.sqrt(
        Math.pow(hitPoint.x - npcPos.x, 2) + 
        Math.pow(hitPoint.y - npcPos.y, 2)
      )

      // 가장 가까운 플레이어 선택
      if (distance < closestDistance) {
        closestDistance = distance
        closestPlayerHit = {
          playerId,
          player,
          distance,
          hitPoint: { x: hitPoint.x, y: SCREEN_HEIGHT - hitPoint.y } // Defold 좌표계로 변환
        }
      }
    }

    return closestPlayerHit
  }

  // 기존 방향 기반 감지 (호환성 유지)
  public detectPlayerInDirection(npcId: string): RaycastHit | null {
    return this.detectPlayerInMovementDirection(npcId)
  }

  // NPC가 이동 방향으로 총알 발사
  public shootInMovementDirection(npcId: string): string | null {
    const currentTime = Date.now()
    const lastShoot = this.lastShootTime.get(npcId) || 0
    
    // 쿨다운 체크
    if (currentTime - lastShoot < this.shootCooldown) return null

    const npc = this.npcs.get(npcId)
    if (!npc) return null

    // NPC의 실제 이동 방향 가져오기
    const movementDirection = this.getNpcMovementDirection(npcId)
    if (!movementDirection) return null

    // 총알 생성
    const bulletId = `npc_bullet_${npcId}_${currentTime}_${Math.floor(Math.random() * 1000)}`
    
    // 이동 방향 사용
    const dirX = movementDirection.x
    const dirY = movementDirection.y 
    
    // 총알 시작 위치 (NPC 앞쪽)
    const startX = npc.x + dirX * 20
    const startY = npc.y + dirY * 20
    
    // Matter.js 바디 생성 (Matter 좌표계)
    const bulletBody = Matter.Bodies.circle(startX, SCREEN_HEIGHT - startY, 3, {
      label: bulletId,
      isSensor: true,
      frictionAir: 0,
      collisionFilter: {
        category: CATEGORY_BULLET,
        mask: CATEGORY_PLAYER | CATEGORY_WALL
      }
    })
    
    // 속도 적용 (NPC 이동 방향으로)
    Matter.Body.setVelocity(bulletBody, {
      x: dirX * this.bulletSpeed,
      y: dirY * this.bulletSpeed // Y축 반전
    })
    
    Matter.World.add(this.world, bulletBody)
    
    // State에 총알 추가
    const bullet = new Bullet()
    bullet.id = bulletId
    bullet.type = 'npc_bullet'
    bullet.x = startX
    bullet.y = startY
    bullet.dirx = dirX
    bullet.diry = dirY
    bullet.power = 10
    bullet.velocity = this.bulletSpeed
    bullet.owner_id = npcId
    
    this.bullets.set(bulletId, bullet)
    
    // 쿨다운 업데이트
    this.lastShootTime.set(npcId, currentTime)
    
    console.log(`[NPC COMBAT] ${npcId}가 이동 방향 (${dirX.toFixed(2)}, ${dirY.toFixed(2)})으로 총알 발사`)
    
    return bulletId
  }

  // 기존 메서드 (호환성 유지)
  public shootInDirection(npcId: string): string | null {
    return this.shootInMovementDirection(npcId)
  }

  // 모든 NPC의 전투 AI 업데이트
  public updateCombatAI(deltaTime: number, npcIds: string[]) {
    npcIds.forEach(npcId => {
      // NPC 이동 방향으로 플레이어 감지
      const detectedPlayer = this.detectPlayerInMovementDirection(npcId)
      
      if (detectedPlayer && detectedPlayer.distance <= this.shootingRange) {
        // 이동 방향으로 사격 시도
        this.shootInMovementDirection(npcId)
        
        console.log(`[NPC COMBAT] ${npcId}가 ${detectedPlayer.playerId}를 감지하여 이동 방향으로 사격 (거리: ${detectedPlayer.distance.toFixed(1)})`)
      }
    })
  }

  // 특정 방향으로 레이캐스트 (디버그용)
  public raycastInDirection(
    startPos: { x: number, y: number }, 
    direction: { x: number, y: number }, 
    maxDistance: number = this.detectionRange
  ): Matter.Collision[] {
    const endPos = {
      x: startPos.x + direction.x * maxDistance,
      y: startPos.y + direction.y * maxDistance
    }
    
    return Matter.Query.ray(this.world.bodies, startPos, endPos)
  }

  // 설정 변경 메서드들
  public setDetectionRange(range: number) {
    this.detectionRange = range
  }

  public setShootingRange(range: number) {
    this.shootingRange = range
  }

  public setShootCooldown(cooldown: number) {
    this.shootCooldown = cooldown
  }

  public setBulletSpeed(speed: number) {
    this.bulletSpeed = speed
  }

  // NPC 위치 업데이트 (외부에서 호출)
  public updateNpcPosition(npcId: string) {
    const npc = this.npcs.get(npcId)
    if (npc) {
      this.npcPreviousPositions.set(npcId, { x: npc.x, y: npc.y })
    }
  }

  // 디버그용: 레이캐스트 시각화 데이터 반환
  public getDebugRaycastData(npcId: string): any {
    const npc = this.npcs.get(npcId)
    if (!npc) return null

    const npcPos = { x: npc.x, y: SCREEN_HEIGHT - npc.y }
    const movementDirection = this.getNpcMovementDirection(npcId)
    const direction = movementDirection ? 
      { x: movementDirection.x, y: -movementDirection.y } : 
      { x: npc.dirx || 1, y: -(npc.diry || 0) }
    
    const raycastResults = this.raycastInDirection(npcPos, direction)
    const detectedPlayer = this.detectPlayerInMovementDirection(npcId)
    
    return {
      npcId,
      position: { x: npc.x, y: npc.y },
      movementDirection: movementDirection,
      staticDirection: { x: npc.dirx, y: npc.diry },
      detectionRange: this.detectionRange,
      raycastHits: raycastResults.length,
      detectedPlayer: detectedPlayer ? {
        playerId: detectedPlayer.playerId,
        distance: detectedPlayer.distance,
        hitPoint: detectedPlayer.hitPoint
      } : null
    }
  }
}
