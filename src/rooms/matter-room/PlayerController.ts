import Matter from 'matter-js'
import { MapSchema } from '@colyseus/schema'
import { Player, Bullet } from '../schema/MatterRoomState'
import { Client } from 'colyseus'
import {
  matterToDefold,
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  CATEGORY_BULLET,
  CATEGORY_WALL,
  CATEGORY_NPC,
  createPlayerBody,
} from './physics'
import { NpcBaseController } from './NpcBaseController'

/**
 * 플레이어 컨트롤러 (비행기 선회 이동)
 */
export class PlayerController {
  private world: Matter.World
  private players: MapSchema<Player>
  private lastInputTimes: Map<string, number> = new Map()
  private autoMoveInterval: number = 500 // 2초 동안 입력 없으면 자동 이동
  private moveDuration: number = 10000 // 자동 이동 지속 시간(ms)
  private autoMoveTargets: Map<
    string,
    { angle: number; thrust: number; endTime: number }
  > = new Map()
  private angles: Map<string, number> = new Map() // 각 플레이어의 현재 각도(라디안)
  private targetAngles: Map<string, number> = new Map() // 목표 각도(라디안)
  private turnSpeed: number = Math.PI / 60 // 선회 속도(라디안/프레임)
  private thrustPower: number = 2 // 추진력(속도)
  // 플레이어별 목표 위치 (자동 이동용)
  private targetPositions: Map<string, { x: number; y: number }> = new Map()
  private bullets: MapSchema<Bullet>
  private npcController: NpcBaseController

  // 클래스 상단에 색상 배열 추가
  private availableColors: string[] = [
    '#FFB300', // Vivid Yellow
    '#FF7043', // Orange
    '#FF8A65', // Light Orange
    '#FFD54F', // Light Yellow
    '#81C784', // Light Green
    '#4FC3F7', // Light Blue
    '#64B5F6', // Blue
    '#BA68C8', // Purple
    '#F06292', // Pink
    '#A1887F', // Brown
    '#90A4AE', // Gray Blue
    '#AED581', // Lime Green
    '#FFFFFF', // White
  ]

  constructor(
    engine: Matter.Engine,
    players: MapSchema<Player>,
    bullets: MapSchema<Bullet>,
    npcController: NpcBaseController
  ) {
    this.world = engine.world
    this.players = players
    this.bullets = bullets
    this.npcController = npcController

    Matter.Events.on(engine, 'collisionStart', (event) => {
      for (const pair of event.pairs) {
        const labelA = pair.bodyA.label
        const labelB = pair.bodyB.label
        if (this.bullets.has(labelA)) {
          this.handleBulletCollision(labelA, labelB)
        } else if (this.bullets.has(labelB)) {
          this.handleBulletCollision(labelB, labelA)
        }
      }
    })
  }

  // 색상 관련 메서드들 추가
  private getRandomAvailableColor(): string {
    if (this.availableColors.length === 0) {
      return '#FFB300'
    }
    const idx = Math.floor(Math.random() * this.availableColors.length)
    const color = this.availableColors[idx]
    this.availableColors.splice(idx, 1)
    return color
  }

  private returnColorToPool(color: string) {
    if (color && !this.availableColors.includes(color)) {
      this.availableColors.push(color)
    }
  }

  // 플레이어 생성 메서드 추가
  createPlayer(client: Client, options?: { username?: string; type?: string }) {
    const body = createPlayerBody(this.world, client.sessionId)
    const player = new Player()
    const defoldPos = matterToDefold(body.position)

    player.x = defoldPos.x
    player.y = defoldPos.y
    player.color = this.getRandomAvailableColor()
    player.username = options?.username || '무명인'
    player.type = options?.type || 'model1'

    console.log(
      `플레이어 ${client.sessionId} 생성됨 - 위치: (${player.x}, ${player.y}), 색상: ${player.color}, 이름: ${player.username}`
    )

    this.players.set(client.sessionId, player)
    this.addPlayer(client.sessionId)
  }

  /**
   * 입력 이동: 방향 벡터(x, y)를 각도로 변환하여 목표 각도로 설정, thrust(추진력)도 설정
   */
  handleMove(client: Client, data: any) {
    const player = this.players.get(client.sessionId)
    if (!player) return

    const body = this.world.bodies.find(
      (b) => b.label === 'player_' + client.sessionId
    )
    if (!body) return

    // 방향 입력이 있을 때만 각도/추진력 갱신
    if (data.x !== 0 || data.y !== 0) {
      const angle = Math.atan2(data.y, data.x)
      this.targetAngles.set(client.sessionId, angle)
      this.autoMoveTargets.delete(client.sessionId)
      // 수동 입력일 때 setVelocity로 바로 이동
      const speed = 10
      Matter.Body.setVelocity(body, {
        x: data.x * speed,
        y: -data.y * speed,
      })
      this.updatePlayerInput(client.sessionId)
    }
    // 입력이 0,0이면 자동 이동 트리거를 위해 타이머를 리셋하지 않음
  }

  /**
   * 자동 이동 및 선회/목표 위치 이동 처리
   */
  update() {
    const now = Date.now()
    for (const [sessionId, player] of this.players.entries()) {
      const body = this.world.bodies.find(
        (b) => b.label === 'player_' + sessionId
      )
      if (!body) continue
      // === 자동 이동 타겟 설정 ===
      const lastInput = this.lastInputTimes.get(sessionId) || 0
      let didAutoMove = false
      if (
        !this.autoMoveTargets.has(sessionId) &&
        now - lastInput > this.autoMoveInterval
      ) {
        // 현재 위치
        const curX = body.position.x
        const curY = body.position.y
        const margin = 40
        let safeX = curX,
          safeY = curY,
          dist = 0
        // 경계선(벽) 근처가 아니면 최소 500px 이상 떨어진 곳만 목표로 삼음
        for (let i = 0; i < 10; i++) {
          // 10회 시도 제한
          const baseAngle = Math.random() * 2 * Math.PI
          const offset = (Math.random() - 0.5) * (Math.PI / 2) // -π/4 ~ +π/4
          const angle = baseAngle + offset
          const distance = 500 + Math.random() * 500 // 500~1000px 이동
          const targetX = curX + Math.cos(angle) * distance
          const targetY = curY + Math.sin(angle) * distance
          safeX = Math.max(margin, Math.min(SCREEN_WIDTH - margin, targetX))
          safeY = Math.max(margin, Math.min(SCREEN_HEIGHT - margin, targetY))
          dist = Math.sqrt((safeX - curX) ** 2 + (safeY - curY) ** 2)
          // 벽 근처(경계 100px 이내)면 거리 제한 없이 허용, 아니면 최소 500px
          const nearWall =
            safeX < margin + 100 ||
            safeX > SCREEN_WIDTH - margin - 100 ||
            safeY < margin + 100 ||
            safeY > SCREEN_HEIGHT - margin - 100
          if (nearWall || dist >= 500) break
        }
        this.targetPositions.set(sessionId, { x: safeX, y: safeY })
        this.autoMoveTargets.set(sessionId, {
          angle: 0, // 각도는 이동 중에 계산
          thrust: this.thrustPower,
          endTime: now + this.moveDuration,
        })
      }
      // === 자동 이동 중이면 목표 위치로 이동 ===
      const autoTarget = this.autoMoveTargets.get(sessionId)
      const targetPos = this.targetPositions.get(sessionId)
      if (autoTarget && targetPos) {
        if (now < autoTarget.endTime) {
          // 목표 위치까지의 벡터 계산
          const dx = targetPos.x - body.position.x
          const dy = targetPos.y - body.position.y
          const distance = Math.sqrt(dx * dx + dy * dy)
          // 목표 위치에 거의 도달하면 새 목표 지정
          if (distance < 10) {
            const margin = 40
            const newX = Math.random() * (1920 - 2 * margin) + margin
            const newY = Math.random() * (1080 - 2 * margin) + margin
            this.targetPositions.set(sessionId, { x: newX, y: newY })
            continue
          }
          // 방향 벡터 정규화
          const dirX = dx / (distance || 1)
          const dirY = dy / (distance || 1)
          const speed = this.thrustPower
          try {
            Matter.Body.setVelocity(body, {
              x: dirX * speed,
              y: dirY * speed,
            })
          } catch (error) {
            console.error(
              `Error setting velocity for player ${sessionId}:`,
              error
            )
            continue
          }
          // === 상태 동기화: 항상 실행 ===
          const defoldPos = matterToDefold(body.position)
          player.x = defoldPos.x
          player.y = defoldPos.y
          player.dirx = dirX
          player.diry = -dirY
        } else {
          this.autoMoveTargets.delete(sessionId)
          this.targetPositions.delete(sessionId)
        }
      }
      // === 수동 입력 상태 동기화 ===
      if (!didAutoMove) {
        try {
          const defoldPos = matterToDefold(body.position)
          player.x = defoldPos.x
          player.y = defoldPos.y
          // 현재 속도 벡터로 방향 계산
          const v = body.velocity
          const vLen = Math.sqrt(v.x * v.x + v.y * v.y)
          player.dirx = vLen > 0.01 ? v.x / vLen : 1
          player.diry = vLen > 0.01 ? -v.y / vLen : 0
        } catch (error) {
          console.error(`Error updating player state for ${sessionId}:`, error)
        }
      }
    }
  }
  updatePlayerInput(sessionId: string) {
    this.lastInputTimes.set(sessionId, Date.now())
    this.autoMoveTargets.delete(sessionId)
  }

  removePlayer(sessionId: string) {
    this.lastInputTimes.delete(sessionId)
    this.autoMoveTargets.delete(sessionId)
    this.angles.delete(sessionId)
    this.targetAngles.delete(sessionId)
  }

  // 플레이어 추가 시 초기 각도 설정
  addPlayer(sessionId: string, initialAngle: number = 0) {
    this.angles.set(sessionId, initialAngle)
    this.targetAngles.set(sessionId, initialAngle)
    this.lastInputTimes.set(sessionId, Date.now())
  }

  // 특정 플레이어의 현재 각도 반환
  getPlayerAngle(sessionId: string): number {
    return this.angles.get(sessionId) ?? 0
  }

  // 설정값들을 동적으로 변경할 수 있는 메서드들
  setTurnSpeed(speed: number) {
    this.turnSpeed = Math.max(0, Math.min(Math.PI / 10, speed)) // 0 ~ π/10 범위로 제한
  }

  setThrustPower(power: number) {
    this.thrustPower = Math.max(0.1, Math.min(10, power)) // 0.1 ~ 10 범위로 제한
  }

  setAutoMoveInterval(interval: number) {
    this.autoMoveInterval = Math.max(500, interval) // 최소 0.5초
  }

  // 플레이어가 쏜 총알만 동기화 및 화면 밖 삭제
  syncAndCleanupPlayerBullets() {
    for (const [id, bullet] of this.bullets.entries()) {
      const body = this.world.bodies.find((b) => b.label === id)
      if (body) {
        const defoldPos = matterToDefold(body.position)
        bullet.x = defoldPos.x
        bullet.y = defoldPos.y
        if (
          bullet.x < -100 ||
          bullet.x > SCREEN_WIDTH + 100 ||
          bullet.y < -100 ||
          bullet.y > SCREEN_HEIGHT + 100
        ) {
          // Matter.js 바디와 state에서 삭제
          try {
            Matter.World.remove(this.world, body)
          } catch {}
          this.bullets.delete(id)
        }
      }
    }
  }

  // update() + 총알 정리까지 한 번에 처리
  updateAndCleanupBullets() {
    this.update()
    this.syncAndCleanupPlayerBullets()
  }

  // 플레이어가 총알을 발사할 때 호출
  shootBullet(client: Client, data: any) {
    const player = this.players.get(client.sessionId)
    if (!player) return
    const body = this.world.bodies.find(
      (b) => b.label === 'player_' + client.sessionId
    )
    if (!body) return
    const bulletId = `player_bullet_${Date.now()}_${Math.floor(
      Math.random() * 10000
    )}`
    const { type, x, y, dirx, diry, power, velocity } = data
    // Matter.js 바디 생성
    const radius = 5
    const bulletBody = Matter.Bodies.circle(x, SCREEN_HEIGHT - y, radius, {
      label: bulletId,
      isSensor: true,
      frictionAir: 0,
      collisionFilter: {
        category: CATEGORY_BULLET,
        mask: CATEGORY_WALL | CATEGORY_NPC,
      },
    })
    Matter.Body.setVelocity(bulletBody, {
      x: dirx * velocity,
      y: diry * velocity * -1,
    })
    Matter.World.add(this.world, bulletBody)
    // State에 등록 (Colyseus Schema 객체로 생성)
    const bullet = new Bullet()
    bullet.id = bulletId
    bullet.type = type
    bullet.x = x
    bullet.y = SCREEN_HEIGHT - y
    bullet.dirx = dirx
    bullet.diry = diry * -1
    bullet.power = power
    bullet.velocity = velocity
    bullet.owner_id = client.sessionId
    this.bullets.set(bulletId, bullet)
  }

  private handleBulletCollision(bulletId: string, npcOrPlayerId: string) {
    let bullet = this.bullets.get(bulletId)
    if (!bullet) return
    if (bullet.owner_id === npcOrPlayerId) return

    const player = this.players.get(bullet.owner_id)

    if (npcOrPlayerId.startsWith('npc_')) {
      const npc = this.npcController.getNpc(npcOrPlayerId)
      if (npc) {
        npc.hp -= npc.type === 'leader' ? bullet.power * 0.5 : bullet.power
        if (npc.hp <= 0) {
          this.npcController.removeNpc(npcOrPlayerId)
          if (player) {
            player.point += 50
          }
        } else {
          if (player) {
            player.point += 10
          }
        }
      }
    }

    this.bullets.delete(bulletId)
    Matter.World.remove(
      this.world,
      this.world.bodies.find((b) => b.label === bulletId)
    )
  }
  // 총알 제거 메서드
  private removeBullet(bulletId: string) {
    // Matter.js 바디에서 제거
    const body = this.world.bodies.find((b) => b.label === bulletId)
    if (body) {
      try {
        Matter.World.remove(this.world, body)
      } catch (error) {
        console.error(`총알 ${bulletId} 바디 제거 중 오류:`, error)
      }
    }
    // State에서 제거
    this.bullets.delete(bulletId)
  }

  // 플레이어의 모든 총알 제거
  removePlayerBullets(sessionId: string) {
    // 플레이어가 소유한 총알들 찾기
    const playerBullets = Array.from(this.bullets.entries()).filter(
      ([_, bullet]) => bullet.owner_id === sessionId
    )

    // 찾은 총알들 제거
    for (const [bulletId, _] of playerBullets) {
      this.removeBullet(bulletId)
    }
  }

  // 플레이어 제거 메서드 수정
  removePlayerFromGame(sessionId: string) {
    // 플레이어의 총알들 제거
    this.removePlayerBullets(sessionId)

    // 색상 반환
    const player = this.players.get(sessionId)
    if (player && player.color) {
      this.returnColorToPool(player.color)
    }

    // 올바른 라벨로 플레이어 바디 찾기 및 제거
    const body = this.world.bodies.find(
      (b) => b.label === `player_${sessionId}`
    )
    if (body) {
      try {
        Matter.World.remove(this.world, body)
        console.log(`플레이어 ${sessionId} 물리 바디 제거됨`)
      } catch (error) {
        console.error(`플레이어 ${sessionId} 바디 제거 중 오류:`, error)
      }
    }

    // 플레이어 상태에서 제거
    this.players.delete(sessionId)
    console.log(`플레이어 ${sessionId} 상태에서 제거됨`)

    // 기존 removePlayer 메서드 호출 (각도, 타이머 등 정리)
    this.removePlayer(sessionId)
  }
}
