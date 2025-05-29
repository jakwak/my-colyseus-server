import { Room, Client } from 'colyseus'
import { Player, State, Npc, Bullet } from '../schema/MatterRoomState'
import {
  createEngineAndWorld,
  addWalls,
  createNpcBody,
  createPlayer,
  moveBody,
  updatePhysics,
  matterToDefold,
  defoldToMatter,
  setBodyPosition,
  SCREEN_HEIGHT,
} from './physics'
import Matter from 'matter-js'
import { NpcWanderManager } from './NpcWanderManager'
import { NpcFollowerManager } from './NpcFollowerManager'

export class MatterRoom extends Room<State> {
  // 디버그 모드 (true면 물리 바디 정보 전송)
  private debugPhysics: boolean = true
  private engine: Matter.Engine
  private world: Matter.World
  private npcWanderManager: NpcWanderManager | null = null

  onCreate() {
    this.state = new State()
    const { engine, world } = createEngineAndWorld()
    this.engine = engine
    this.world = world
    addWalls(this.world)


    // 예시: wander NPC 3개, 각 NPC마다 팔로워 6개(size 10)씩 생성
    this.npcWanderManager = new NpcWanderManager(this.world, this.state.npcs);

    // 팔로워 매니저는 내부적으로 자동 생성/관리됨
    this.npcWanderManager.spawnNpcs(
      5,    // wander NPC 개수
      25,   // wander NPC 크기
      10,    // 각 wander NPC마다 팔로워 개수
      10    // 팔로워 크기
    );

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
      // === NPC 랜덤 이동 ===
      if (this.npcWanderManager) {
        // tick마다 wander/follower 현황 출력 (간략)
        //console.log(`[ROOM] tick: wanderCount=${this.npcWanderManager.myNpcIds ? this.npcWanderManager.myNpcIds.size : 'N/A'}, followerManagers=${this.npcWanderManager.followerManagers.length}`);
        this.npcWanderManager.moveAllNpcs(deltaTime)
      }

      // 플레이어 상태 업데이트
      this.world.bodies.forEach((body) => {
        const player = this.state.players.get(body.label)
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

    // 충돌 이벤트 리스너 등록
    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      for (const pair of event.pairs) {
        const labelA = pair.bodyA.label
        const labelB = pair.bodyB.label

        // bullet과 다른 오브젝트가 충돌했는지 확인
        if (this.state.bullets.has(labelA)) {
          const bullet = this.state.bullets.get(labelA)
          // 총알의 owner_id와 충돌한 바디의 label이 다를 때만 제거
          if (bullet && bullet.owner_id !== labelB) {
            this.removeBullet(labelA)
          }
        } else if (this.state.bullets.has(labelB)) {
          const bullet = this.state.bullets.get(labelB)
          // 총알의 owner_id와 충돌한 바디의 label이 다를 때만 제거
          if (bullet && bullet.owner_id !== labelA) {
            this.removeBullet(labelB)
          }
        }
      }
    })
  }

  private handleMove(client: Client, data: any) {
    const player = this.state.players.get(client.sessionId)
    if (player) {
      const body = this.world.bodies.find((b) => b.label === client.sessionId)
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
    if (!this.debugPhysics) return;
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
    // State의 메서드로 색상 반환
    const player = this.state.players.get(client.sessionId)
    if (player && player.color) {
      this.state.returnColorToPool(player.color)
    }
    const body = this.world.bodies.find((b) => b.label === client.sessionId)
    if (body) {
      Matter.World.remove(this.world, body)
    }
    this.state.players.delete(client.sessionId)

    // 모든 플레이어가 나가면 방 삭제
    if (this.state.players.size === 0) {
      console.log('모든 플레이어가 나가서 방을 삭제합니다.')
      this.disconnect() // Colyseus Room의 dispose()를 호출하여 방 삭제
    }
  }

  private removeBullet(bulletId: string) {
    const bullet = this.state.bullets.get(bulletId)
    if (bullet) {
      const body = this.world.bodies.find((b) => b.label === bulletId)
      // let x = bullet.x
      // let y = bullet.y

      if (body) {
        // 최신 위치로 갱신
        // const defoldPos = matterToDefold(body.position)
        // x = defoldPos.x
        // y = defoldPos.y
        try {
          Matter.World.remove(this.world, body)
        } catch (e) {
          // 이미 삭제된 경우 무시
        }
      }
      this.state.bullets.delete(bulletId)
    }
  }
}
