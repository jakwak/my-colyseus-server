import { Room, Client } from 'colyseus'
import { Player, State, Npc, Bullet } from '../schema/MatterRoomState'
import {
  createEngineAndWorld,
  addWalls,
  createPlayer,
  moveBody,
  matterToDefold,
  defoldToMatter,
  setBodyPosition,
  SCREEN_HEIGHT,
} from './physics'
import Matter from 'matter-js'
import { NpcWanderManager } from './NpcWanderManager'

export class MatterRoom extends Room<State> {
  // 디버그 모드 (true면 물리 바디 정보 전송)
  private debugPhysics: boolean = true
  private engine: Matter.Engine
  private world: Matter.World
  private npcWanderManager: NpcWanderManager | null = null
  private cleanupTimer?: NodeJS.Timeout  // 방 정리 지연 타이머
  private isDisposing: boolean = false   // 방 정리 중인지 체크

  onCreate() {
    this.state = new State()
    const { engine, world } = createEngineAndWorld()
    this.engine = engine
    this.world = world
    addWalls(this.world)

    // 예시: wander NPC 3개, 각 NPC마다 팔로워 6개(size 10)씩 생성
    this.npcWanderManager = new NpcWanderManager(this.world, this.state.npcs, this.state.players, this.state.bullets)

    // 팔로워 매니저는 내부적으로 자동 생성/관리됨
    this.npcWanderManager.spawnNpcs(
      10, // wander NPC 개수
      25, // wander NPC 크기
      5, // 각 wander NPC마다 팔로워 개수
      10 // 팔로워 크기
    )

    // // 팔로워 매니저는 내부적으로 자동 생성/관리됨
    // this.npcWanderManager.spawnNpcs(
    //   5, // wander NPC 개수
    //   25, // wander NPC 크기
    //   3, // 각 wander NPC마다 팔로워 개수
    //   10 // 팔로워 크기
    // )

    // this.npcWanderManager.spawnNpcs(
    //   5, // wander NPC 개수
    //   25, // wander NPC 크기
    //   8, // 각 wander NPC마다 팔로워 개수
    //   10 // 팔로워 크기
    // )

    this.onMessage('move', this.handleMove.bind(this))
    this.onMessage('position_sync', this.handlePositionSync.bind(this))
    this.onMessage('toggle_debug', this.handleToggleDebug.bind(this))
    this.onMessage('get_debug_bodies', this.handleGetDebugBodies.bind(this))
    this.onMessage('shoot_bullet', this.handleShootBullet.bind(this))

    //====================================
    // 물리 업데이트 주기 설정
    this.engine.timing.timeScale = 1.0

    this.setSimulationInterval((deltaTime) => {
      Matter.Engine.update(this.engine, deltaTime)

      // const stateSize = JSON.stringify(this.state.toJSON()).length
      // console.log(`Current state size: ${stateSize} bytes`)

      // === NPC 랜덤 이동 ===
      if (this.npcWanderManager) {
        this.npcWanderManager.moveAllNpcs(deltaTime)
      }

      // 플레이어 상태 업데이트
      this.world.bodies.forEach((body) => {
        const player = this.state.players.get(body.label.replace('player_', ''))
        if (player) {
          const defoldPos = matterToDefold(body.position)
          player.x = defoldPos.x
          player.y = defoldPos.y
        }
        const bullet = this.state.bullets.get(body.label)
        if (bullet) {
          const defoldPos = matterToDefold(body.position)
          bullet.x = defoldPos.x
          bullet.y = defoldPos.y

          // 예시: 화면 밖이면 삭제
          if (
            bullet.x < -100 ||
            bullet.x > 2100 ||
            bullet.y < -100 ||
            bullet.y > 2100
          ) {
            this.removeBullet(body.label)
          }
        }
      })
    }, 1000 / 60)

    // 충돌 이벤트 리스너 수정
    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      for (const pair of event.pairs) {
        const labelA = pair.bodyA.label
        const labelB = pair.bodyB.label

        if (this.state.bullets.has(labelA)) {
          this.handleBulletCollision(labelA, labelB)
        } else if (this.state.bullets.has(labelB)) {
          this.handleBulletCollision(labelB, labelA)
        }
      }
    })
  }
  // MatterRoom.ts에 추가할 함수
  private handleBulletCollision(bulletId: string, npcId: string) {
    const bullet = this.state.bullets.get(bulletId)
    if (!bullet || bullet.owner_id === npcId) return

    this.removeBullet(bulletId)
    
  }

  private handleMove(client: Client, data: any) {
    const player = this.state.players.get(client.sessionId)
    if (player) {
      const body = this.world.bodies.find((b) => b.label === "player_" + client.sessionId)
      if (body) {
        moveBody(body, data)
        const defoldPos = matterToDefold(body.position)
        player.x = defoldPos.x
        player.y = defoldPos.y
        player.dirx = data.x
        player.diry = data.y
      }
    }
  }

  private handlePositionSync(client: Client, data: any) {
    const player = this.state.players.get(client.sessionId)
    if (player) {
      const body = this.world.bodies.find((b) => b.label === client.sessionId)
      if (body) {
        const matterPos = defoldToMatter({ x: data.x, y: data.y })
        setBodyPosition(body, matterPos)
        player.x = data.x
        player.y = data.y
        Matter.Body.setVelocity(body, { x: 0, y: 0 })
        Matter.Body.setAngularVelocity(body, 0)
      }
    }
  }

  private handleToggleDebug(client: Client, data: any) {
    this.debugPhysics = data.enabled
    console.log(`디버그 모드 ${this.debugPhysics ? '활성화' : '비활성화'}`)
  }

  private handleGetDebugBodies(client: Client, data: any) {
    if (!this.debugPhysics) return
    const bodyDataList: Array<{
      label: string
      x: number
      y: number
      shape: string
      radius: number
      width: number
      height: number
      isStatic: boolean
    }> = []
    this.world.bodies.forEach((body) => {
      const defoldPos = matterToDefold(body.position)
      const bodyData = {
        label: body.label,
        x: defoldPos.x,
        y: defoldPos.y,
        shape: body.circleRadius ? 'circle' : 'rectangle',
        radius: body.circleRadius || 0,
        width: body.bounds ? body.bounds.max.x - body.bounds.min.x : 0,
        height: body.bounds ? body.bounds.max.y - body.bounds.min.y : 0,
        isStatic: body.isStatic,
      }
      bodyDataList.push(bodyData)
    })
    client.send('debug_bodies', { bodies: bodyDataList })
  }

  private handleShootBullet(client: Client, data: any) {
    // data: { type, x, y, dirx, diry, power, velocity }
    const bulletId = `bullet_${Date.now()}_${Math.floor(Math.random() * 10000)}`
    const { type, x, y, dirx, diry, power, velocity } = data

    // Matter.js 바디 생성
    const radius = 5 // 예시: 총알 반지름
    const bulletBody = Matter.Bodies.circle(x, SCREEN_HEIGHT - y, radius, {
      label: bulletId,
      isSensor: true, // 충돌만 감지, 물리 반응 없음
      frictionAir: 0,
    })
    // 방향 단위 벡터로 속도 적용
    Matter.Body.setVelocity(bulletBody, {
      x: dirx * velocity,
      y: diry * velocity * -1,
    })
    Matter.World.add(this.world, bulletBody)

    // State에 등록
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

    this.state.bullets.set(bulletId, bullet)
  }

  onJoin(
    client: Client,
    options?: { x?: number; y?: number; username?: string }
  ) {
    // 새 플레이어가 들어오면 방 정리 타이머 취소
    if (this.cleanupTimer) {
      console.log('새 플레이어 입장으로 방 정리 타이머를 취소합니다.')
      clearTimeout(this.cleanupTimer)
      this.cleanupTimer = undefined
    }
    
    // 클라이언트에서 전달한 시작 위치 사용 (없으면 디폴트)
    const startPos =
      options && options.x !== undefined && options.y !== undefined
        ? { x: options.x, y: options.y }
        : undefined

    // State의 메서드로 색상 할당
    const color = this.state.getRandomAvailableColor()
    // username 할당
    const username = options && options.username ? options.username : '무명인'

    const body = createPlayer(this.world, client.sessionId, startPos)
    const player = new Player()
    const defoldPos = matterToDefold(body.position)
    player.x = defoldPos.x
    player.y = defoldPos.y
    player.color = color
    player.username = username

    console.log(
      `플레이어 ${client.sessionId} 생성됨 - 위치: (${player.x}, ${player.y}), 색상: ${player.color}, 이름: ${player.username}`
    )

    this.state.players.set(client.sessionId, player)
  }

  onLeave(client: Client) {
    // 이미 방이 정리 중이면 중복 처리 방지
    if (this.isDisposing) {
      console.log('방이 이미 정리 중입니다.')
      return
    }

    console.log(`플레이어 ${client.sessionId} 퇴장 시작`)
    
    // State의 메서드로 색상 반환
    const player = this.state.players.get(client.sessionId)
    if (player && player.color) {
      this.state.returnColorToPool(player.color)
    }
    
    // 올바른 라벨로 플레이어 바디 찾기 및 제거
    const body = this.world.bodies.find((b) => b.label === `player_${client.sessionId}`)
    if (body) {
      try {
        Matter.World.remove(this.world, body)
        console.log(`플레이어 ${client.sessionId} 물리 바디 제거됨`)
      } catch (error) {
        console.error(`플레이어 ${client.sessionId} 바디 제거 중 오류:`, error)
      }
    }
    
    // 플레이어가 소유한 총알들 제거
    const playerBullets = Array.from(this.state.bullets.entries())
      .filter(([_, bullet]) => bullet.owner_id === client.sessionId)
    
    for (const [bulletId, _] of playerBullets) {
      this.removeBullet(bulletId)
    }
    
    // 플레이어 상태에서 제거
    this.state.players.delete(client.sessionId)
    console.log(`플레이어 ${client.sessionId} 상태에서 제거됨`)

    // 모든 플레이어가 나가면 지연 삭제 스케줄링
    if (this.state.players.size === 0) {
      this.scheduleRoomCleanup()
    }
  }

  private removeBullet(bulletId: string) {
    const bullet = this.state.bullets.get(bulletId)
    if (bullet) {
      const body = this.world.bodies.find((b) => b.label === bulletId)
      if (body) {
        try {
          Matter.World.remove(this.world, body)
        } catch (e) {
          // 이미 삭제된 경우 무시
        }
      }
      this.state.bullets.delete(bulletId)
    }
  }

  private removeNpc(npcId: string) {
    // 물리 엔진에서 바디 제거
    const npcBody = this.world.bodies.find((body) => body.label === npcId)
    if (npcBody) {
      Matter.World.remove(this.world, npcBody)
      console.log(`[NPC BODY] ${npcId} 제거됨`)
    }
    // NPC 상태에서 제거
    this.state.npcs.delete(npcId)
    console.log(`[NPC] ${npcId} 상태에서 제거됨`)
  }

  // 방 정리를 지연시키는 메서드 (새로 추가)
  private scheduleRoomCleanup() {
    console.log('방 정리 스케줄링 시작')
    
    // 기존 타이머가 있다면 취소 (중복 방지)
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer)
      this.cleanupTimer = undefined
    }
    
    // 5초 후에 방이 여전히 비어있으면 삭제
    this.cleanupTimer = setTimeout(() => {
      if (this.state.players.size === 0 && !this.isDisposing) {
        console.log('5초 후에도 방이 비어있어 정리를 시작합니다.')
        this.cleanupRoom()
      } else {
        console.log('새 플레이어가 들어와서 방 정리를 취소합니다.')
      }
    }, 5000) // 5초 지연
  }

  // 방 리소스 정리 메서드 (수정됨)
  private cleanupRoom() {
    if (this.isDisposing) {
      console.log('이미 방 정리가 진행 중입니다.')
      return
    }
    
    this.isDisposing = true // 정리 시작 플래그 설정
    console.log('방 리소스 정리를 시작합니다.')
    
    try {
      // 타이머 정리
      if (this.cleanupTimer) {
        clearTimeout(this.cleanupTimer)
        this.cleanupTimer = undefined
      }
      
      // NPC 매니저 정리
      if (this.npcWanderManager) {
        this.npcWanderManager.followerManagers.forEach(manager => {
          // 각 팔로워 매니저의 리소스 정리가 필요하다면 여기서 처리
        })
        this.npcWanderManager = null
      }
      
      // 모든 총알 제거
      const allBullets = Array.from(this.state.bullets.keys())
      for (const bulletId of allBullets) {
        this.removeBullet(bulletId)
      }
      
      // 모든 NPC 제거
      const allNpcs = Array.from(this.state.npcs.keys())
      for (const npcId of allNpcs) {
        this.removeNpc(npcId)
      }
      
      console.log('방 리소스 정리 완료, 방을 삭제합니다.')
      
      // 약간의 지연 후 방 삭제
      setTimeout(() => {
        this.disconnect()
      }, 100)
      
    } catch (error) {
      console.error('방 정리 중 오류 발생:', error)
      this.disconnect() // 오류가 발생해도 방은 삭제
    }
  }

  // 방이 완전히 종료될 때 타이머 정리 (새로 추가)
  onDispose() {
    console.log('방이 완전히 종료됩니다.')
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer)
      this.cleanupTimer = undefined
    }
  }
}
