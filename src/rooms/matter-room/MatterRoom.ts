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

export class MatterRoom extends Room<State> {
  // 디버그 모드 (true면 물리 바디 정보 전송)
  private debugPhysics: boolean = true
  private engine: Matter.Engine
  private world: Matter.World

  // === 시험용 NPC 이동 ===
  // waypoint 리스트를 화면 내 안전한 위치로 미리 정의
  private npcWaypoints = [
    defoldToMatter({ x: 100, y: 100 }),
    defoldToMatter({ x: 650, y: 130 }),
    defoldToMatter({ x: 860, y: 540 }),
    defoldToMatter({ x: 100, y: 1540 }),
    defoldToMatter({ x: 1480, y: 320 }),
    defoldToMatter({ x: 300, y: 1200 }),
    defoldToMatter({ x: 1700, y: 1400 }),
  ]
  private npcCurrentWaypointIdx = 0

  private moveNpc(npcId: string, npcSize: number, deltaTime: number) {
    const npcBody = this.world.bodies.find((b) => b.label === npcId)
    if (!npcBody) return
    const speed = 80 // 일정한 느린 속도
    const waypoint = this.npcWaypoints[this.npcCurrentWaypointIdx]
    // 방향 벡터 계산
    const dx = waypoint.x - npcBody.position.x
    const dy = waypoint.y - npcBody.position.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < 10) {
      // waypoint에 도달하면 다음 waypoint로
      this.npcCurrentWaypointIdx =
        (this.npcCurrentWaypointIdx + 1) % this.npcWaypoints.length
      return
    }
    // 단위 벡터로 이동
    const dirX = dx / dist
    const dirY = dy / dist
    Matter.Body.setVelocity(npcBody, {
      x: (dirX * speed) / 60,
      y: (dirY * speed) / 60,
    })
    // Colyseus State 위치 동기화
    const npcState = this.state.npcs.get(npcId)
    if (npcState) {
      const defoldPos = matterToDefold(npcBody.position)
      npcState.x = defoldPos.x
      npcState.y = defoldPos.y
      npcState.dirx = dirX
      npcState.diry = dirY
    }
  }
  // === 시험용 NPC 이동 끝 ===

  onCreate() {
    this.state = new State()
    const { engine, world } = createEngineAndWorld()
    this.engine = engine
    this.world = world
    addWalls(this.world)

    // === 시험용 NPC 1개 생성 ===
    const npcId = 'npc_1'
    const npcSize = 20
    const npcPos = { x: 200, y: 400 }
    const npcColors = [
      '#FFB300',
      '#FF7043',
      '#FF8A65',
      '#FFD54F',
      '#81C784',
      '#4FC3F7',
      '#64B5F6',
      '#BA68C8',
      '#F06292',
      '#A1887F',
      '#90A4AE',
      '#AED581',
      '#FFFFFF',
    ]
    const npcColor = npcColors[Math.floor(Math.random() * npcColors.length)]
    createNpcBody(this.world, npcId, npcPos.x, npcPos.y, npcSize)

    const npc = new Npc()
    npc.id = npcId
    npc.x = npcPos.x
    npc.y = npcPos.y
    npc.size = npcSize
    npc.shape = 'circle'
    npc.owner_id = 'server'
    npc.power = 10
    npc.color = npcColor
    this.state.npcs.set(npcId, npc)
    // === 시험용 NPC 생성 끝 ===

    this.onMessage('move', this.handleMove.bind(this))
    this.onMessage('position_sync', this.handlePositionSync.bind(this))
    this.onMessage('toggle_debug', this.handleToggleDebug.bind(this))
    this.onMessage('get_debug_bodies', this.handleGetDebugBodies.bind(this))
    this.onMessage('shoot_bullet', this.handleShootBullet.bind(this))

    //====================================
    this.setSimulationInterval((deltaTime) => {
      Matter.Engine.update(this.engine, deltaTime)

      // === 시험용 NPC 이동 ===
      this.moveNpc(npcId, npcSize, deltaTime)
      // === NPC 이동 끝 ===

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
          // if (
          //   bullet.x < -100 ||
          //   bullet.x > 2100 ||
          //   bullet.y < -100 ||
          //   bullet.y > 2100
          // ) {
          //   this.removeBullet(body.label)
          // }
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
          this.removeBullet(labelA)
        } else if (this.state.bullets.has(labelB)) {
          this.removeBullet(labelB)
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
      let x = bullet.x
      let y = bullet.y
      
      if (body) {
        // 최신 위치로 갱신
        const defoldPos = matterToDefold(body.position)
        x = defoldPos.x
        y = defoldPos.y
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
