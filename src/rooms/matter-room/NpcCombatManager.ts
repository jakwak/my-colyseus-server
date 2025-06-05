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
  private detectionRange: number = 500 // 감지 범위
  private shootingRange: number = 500 // 사격 범위
  private shootCooldown: number = 800 // 총알 쿨다운
  private bulletSpeed: number = 5 // 총알 속도
  
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
  public detectPlayerInMovementDirection(npcId: string): { playerId: string, distance: number } | null {
    const npc = this.npcs.get(npcId)
    if (!npc) return null

    const npcBody = this.world.bodies.find(b => b.label === npcId)
    if (!npcBody) return null

    // NPC 위치와 실제 이동 방향
    const npcPos = { x: npc.x, y: SCREEN_HEIGHT - npc.y } // Matter 좌표계로 변환
    const movementDirection = this.getNpcMovementDirection(npcId)
    if (!movementDirection) return null

    const npcDirection = { x: movementDirection.x, y: -movementDirection.y } // Y축 반전
    const baseAngle = Math.atan2(npcDirection.y, npcDirection.x)
    const FAN_ANGLE = Math.PI / 6 // 30도
    const RAY_COUNT = 5 // 부채꼴을 구성할 레이 개수

    // 플레이어 바디만 필터링하고 가장 가까운 것 찾기
    let closestPlayerId: string | null = null
    let closestDistance = Infinity

    // 부채꼴 형태로 여러 방향으로 레이캐스트
    for (let i = 0; i < RAY_COUNT; i++) {
      // -30도 ~ +30도 사이의 각도 계산
      const angleOffset = (i / (RAY_COUNT - 1) - 0.5) * 2 * FAN_ANGLE
      const rayAngle = baseAngle + angleOffset
      
      // 레이 방향 계산
      const rayDirection = {
        x: Math.cos(rayAngle),
        y: Math.sin(rayAngle)
      }

      // 레이캐스트 끝점 계산
      const rayEnd = {
        x: npcPos.x + rayDirection.x * this.detectionRange,
        y: npcPos.y + rayDirection.y * this.detectionRange
      }

      // Matter.js Query.ray로 레이캐스트 수행
      const raycastResults = Matter.Query.ray(
        this.world.bodies,
        npcPos,
        rayEnd
      )

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
          closestPlayerId = playerId
        }
      }
    }

    return closestPlayerId ? { playerId: closestPlayerId, distance: closestDistance } : null
  }

  // NPC가 플레이어를 향해 총알 발사
  public shootAtPlayer(npcId: string, targetPlayerId?: string): string | null {
    const currentTime = Date.now()
    const lastShoot = this.lastShootTime.get(npcId) || 0
    
    // 쿨다운 체크
    if (currentTime - lastShoot < this.shootCooldown) return null

    const npc = this.npcs.get(npcId)
    if (!npc) return null

    // 타겟 플레이어 찾기 (지정되지 않으면 가장 가까운 플레이어)
    let targetPlayer: Player | null = null
    let targetPlayerId_actual = targetPlayerId

    if (targetPlayerId_actual) {
      targetPlayer = this.players.get(targetPlayerId_actual) || null
    } else {
      // 가장 가까운 플레이어 찾기
      let closestDistance = Infinity
      for (const [playerId, player] of this.players.entries()) {
        const distance = Math.sqrt(
          Math.pow(player.x - npc.x, 2) + 
          Math.pow(player.y - npc.y, 2)
        )
        if (distance < closestDistance && distance <= this.shootingRange) {
          closestDistance = distance
          targetPlayer = player
          targetPlayerId_actual = playerId
        }
      }
    }

    if (!targetPlayer) return null

    // 플레이어 방향 계산
    const deltaX = targetPlayer.x - npc.x
    const deltaY = targetPlayer.y - npc.y
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
    
    if (distance === 0) return null

    // 정규화된 방향 벡터
    const dirX = deltaX / distance
    const dirY = deltaY / distance

    // 총알 생성
    const bulletId = `npc_bullet_${npcId}_${currentTime}_${Math.floor(Math.random() * 1000)}`
    
    // 총알 시작 위치
    const startX = npc.x
    const startY = npc.y
    
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
    
    // 속도 적용 (플레이어 방향으로)
    Matter.Body.setVelocity(bulletBody, {
      x: dirX * this.bulletSpeed,
      y: -dirY * this.bulletSpeed // Y축 반전 (Matter 좌표계)
    })
    
    Matter.World.add(this.world, bulletBody)
    
    // State에 총알 추가
    const bullet = new Bullet()
    bullet.id = bulletId
    bullet.type = 'npc_bullet'
    bullet.x = startX
    bullet.y = startY
    bullet.dirx = dirX
    bullet.diry = dirY * -1
    bullet.power = 10
    bullet.velocity = this.bulletSpeed
    bullet.owner_id = npcId
    
    this.bullets.set(bulletId, bullet)
    
    // 쿨다운 업데이트
    this.lastShootTime.set(npcId, currentTime)
    
    return bulletId
  }

  public shootInMovementDirection(npcId: string): string | null {
    // NPC 타입 확인 (leader인지 follower인지)
    const isLeader = npcId.includes('leader')
    
    if (isLeader) {
      // Leader는 플레이어를 향해 사격
      return this.shootAtPlayer(npcId)
    } else {
      // Follower는 이동 방향으로 사격
      return this.shootInDirection(npcId)
    }
  }

  private shootInDirection(npcId: string): string | null {
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
    const startX = npc.x
    const startY = npc.y
    
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
      y: dirY * this.bulletSpeed
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
    
    return bulletId
  }

  // 모든 NPC의 전투 AI 업데이트
  public updateCombatAI(deltaTime: number, npcIds: string[]) {
    npcIds.forEach(npcId => {
      const isFollower = npcId.includes('follower')
      
      if (isFollower) {
        // Follower는 기존 방식 (이동 방향으로 플레이어 감지 후 사격)
        const detectedPlayer = this.detectPlayerInMovementDirection(npcId)
        
        if (detectedPlayer && detectedPlayer.distance <= this.shootingRange) {
          this.shootInDirection(npcId)
        }
      } else {
        // Leader는 사격 범위 내 플레이어를 직접 타겟팅
        this.shootAtPlayer(npcId)
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

  // NPC가 쏜 총알만 동기화 및 화면 밖 삭제
  public syncAndCleanupNpcBullets(npcBullets: MapSchema<Bullet>) {
    for (const [id, bullet] of npcBullets.entries()) {
      const body = this.world.bodies.find((b) => b.label === id)
      if (body) {
        const defoldPos = matterToDefold(body.position)
        bullet.x = defoldPos.x
        bullet.y = defoldPos.y
        if (
          bullet.x < -100 || bullet.x > SCREEN_WIDTH + 100 ||
          bullet.y < -100 || bullet.y > SCREEN_HEIGHT + 100
        ) {
          try { Matter.World.remove(this.world, body) } catch {}
          npcBullets.delete(id)
        }
      }
    }
  }
}
