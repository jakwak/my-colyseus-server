import Matter from 'matter-js'
import { MapSchema } from '@colyseus/schema'
import { Star, Player } from '../schema/MatterRoomState'
import { SCREEN_WIDTH, SCREEN_HEIGHT, CATEGORY_STAR, CATEGORY_PLAYER } from './physics'

export class StarManager {
  private world: Matter.World
  private starLifetime: number = 30000 // 30초 후 자동 삭제
  private starRadius: number = 15 // Star 충돌 반경

  constructor(
    private engine: Matter.Engine,
    private stars: MapSchema<Star>,
    private players: MapSchema<Player>
  ) {
    console.log('=== StarManager 생성자 진입 ===')
    this.world = engine.world
    console.log('1. StarManager - world 설정 완료')
    this.starLifetime = 30000 // 30초
    console.log('2. StarManager - starLifetime 설정 완료')
    
    console.log('=== StarManager 생성자 완료 ===')
  }

  // NPC가 죽을 때 Star 생성
  public createStar(x: number, y: number, ownerId: string): string {
    const starId = `star_${Date.now()}_${Math.floor(Math.random() * 10000)}`
    
    // Matter.js 바디 생성
    const starBody = Matter.Bodies.circle(x, SCREEN_HEIGHT - y, this.starRadius, {
      label: starId,
      isStatic: false,
      isSensor: true, // 물리적 충돌 없이 감지만
      frictionAir: 0,
      collisionFilter: {
        category: CATEGORY_STAR,
        mask: CATEGORY_PLAYER,
      },
    })

    Matter.World.add(this.world, starBody)

    // State에 Star 추가
    const star = new Star()
    star.id = starId
    star.x = x
    star.y = y
    star.heal_amount = 5
    star.owner_id = ownerId
    star.created_at = Date.now()

    this.stars.set(starId, star)

    console.log(`[STAR] Star 생성: ${starId} at (${x}, ${y})`)
    return starId
  }

  // Star와 플레이어 충돌 처리
  private handleStarPlayerCollision(starId: string, playerId: string) {
    const star = this.stars.get(starId)
    const player = this.players.get(playerId)

    if (!star || !player) return

    // HP 회복 (최대 100)
    const oldHp = player.hp
    player.hp = Math.min(100, player.hp + star.heal_amount)
    const healedAmount = player.hp - oldHp

    console.log(`[STAR] 플레이어 ${playerId} HP 회복: ${oldHp} -> ${player.hp} (+${healedAmount})`)

    // Star 제거
    this.removeStar(starId)

    // 점수 추가 (선택사항)
    if (star.owner_id && star.owner_id !== playerId) {
      // 다른 플레이어가 생성한 Star를 사용한 경우 보너스 점수
      player.point += 10
      console.log(`[STAR] 보너스 점수 +10 for player ${playerId}`)
    }
  }

  // Star 제거
  public removeStar(starId: string) {
    // Matter.js 바디 제거
    const starBody = this.world.bodies.find((b) => b.label === starId)
    if (starBody) {
      try {
        Matter.World.remove(this.world, starBody)
      } catch (error) {
        console.warn(`[STAR] Star 바디 제거 실패: ${starId}`, error)
      }
    }

    // State에서 제거
    this.stars.delete(starId as any)
    console.log(`[STAR] Star 제거: ${starId}`)
  }

  // 오래된 Star 자동 정리
  public cleanupOldStars() {
    const currentTime = Date.now()
    const starsToRemove: string[] = []

    for (const [starId, star] of this.stars.entries()) {
      if (currentTime - star.created_at > this.starLifetime) {
        starsToRemove.push(starId as string)
      }
    }

    starsToRemove.forEach(starId => {
      this.removeStar(starId as string)
    })

    if (starsToRemove.length > 0) {
      console.log(`[STAR] ${starsToRemove.length}개의 오래된 Star 정리됨`)
    }
  }

  // 모든 Star 제거 (방 정리 시)
  public cleanupAllStars() {
    const starIds = Array.from(this.stars.keys())
    starIds.forEach(starId => {
      this.removeStar(starId as string)
    })
    console.log(`[STAR] 모든 Star 정리됨 (${starIds.length}개)`)
  }
} 