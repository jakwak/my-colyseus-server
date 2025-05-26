import { Room, Client } from 'colyseus'
import { PhysicsBody, Player, State, Npc } from '../schema/MatterRoomState'
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
} from './physics'
import Matter from 'matter-js'

export class MatterRoom extends Room<State> {
  // 디버그 모드 (true면 물리 바디 정보 전송)
  private debugPhysics: boolean = true
  private engine: Matter.Engine
  private world: Matter.World

  // NPC 이동 상태 관리용
  private npcMoveState: {
    dir: { x: number; y: number };
    speed: number;
    changeTimer: number;
  }

  // === 시험용 NPC 이동 ===
  // waypoint 리스트를 화면 내 안전한 위치로 미리 정의
  private npcWaypoints = [
    { x: 100, y: 1700 },
    { x: 100, y: 1530 },
    // { x: 860, y: 540 },
    // { x: 100, y: 540 },
    // { x: 480, y: 320 },
    // { x: 300, y: 200 },
    // { x: 700, y: 400 },
  ];
  private npcCurrentWaypointIdx = 0;

  private moveNpc(npcId: string, npcSize: number, deltaTime: number) {
    const npcBody = this.world.bodies.find(b => b.label === npcId)
    if (!npcBody) return;
    const speed = 30; // 일정한 느린 속도
    const waypoint = this.npcWaypoints[this.npcCurrentWaypointIdx];
    // 방향 벡터 계산
    const dx = waypoint.x - npcBody.position.x;
    const dy = waypoint.y - npcBody.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 10) {
      // waypoint에 도달하면 다음 waypoint로
      this.npcCurrentWaypointIdx = (this.npcCurrentWaypointIdx + 1) % this.npcWaypoints.length;
      return;
    }
    // 단위 벡터로 이동
    const dirX = dx / dist;
    const dirY = dy / dist;
    Matter.Body.setVelocity(npcBody, {
      x: dirX * speed / 60,
      y: dirY * speed / 60
    });
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
      "#FFB300", "#FF7043", "#FF8A65", "#FFD54F", "#81C784", "#4FC3F7", "#64B5F6", "#BA68C8", "#F06292", "#A1887F", "#90A4AE", "#AED581", "#FFFFFF"
    ];
    const npcColor = npcColors[Math.floor(Math.random() * npcColors.length)];
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

    // NPC 이동 상태 관리용
    this.npcMoveState = {
      dir: { x: Math.random() * 2 - 1, y: Math.random() * 2 - 1 },
      speed: 40 + Math.random() * 40, // 40~80
      changeTimer: 0
    }

    this.onMessage('move', this.handleMove.bind(this))
    this.onMessage('position_sync', this.handlePositionSync.bind(this))
    this.onMessage('toggle_debug', this.handleToggleDebug.bind(this))
    this.onMessage('get_debug_bodies', this.handleGetDebugBodies.bind(this))


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
      })
      if (this.debugPhysics) {
        this.updateDebugBodies()
      }
    }, 1000 / 60)
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

  // 디버그용 물리 바디 정보 업데이트
  private updateDebugBodies() {
    // 첫 번째 실행인지 확인 (debugBodies가 비어있으면 모든 바디 추가)
    if (this.state.debugBodies.length === 0) {
      // 처음에만 모든 바디 추가
      this.world.bodies.forEach((body) => {
        const debugBody = new PhysicsBody()
        debugBody.label = body.label

        // Defold 좌표계로 변환
        const defoldPos = matterToDefold(body.position)
        debugBody.x = defoldPos.x
        debugBody.y = defoldPos.y

        // 바디 타입 및 크기 정보
        if (body.circleRadius) {
          debugBody.shape = 'circle'
          debugBody.radius = body.circleRadius
        } else {
          debugBody.shape = 'rectangle'
          // 바운딩 박스 크기 계산
          const bounds = body.bounds
          debugBody.width = bounds.max.x - bounds.min.x
          debugBody.height = bounds.max.y - bounds.min.y
        }

        debugBody.isStatic = body.isStatic

        // 상태에 추가
        this.state.debugBodies.push(debugBody)
      })
    } else {
      // 이미 바디들이 있으면 "pad" 라벨인 것만 위치 업데이트
      this.world.bodies.forEach((body) => {
        if (body.label === 'pad') {
          // 기존 pad 바디 찾기
          const existingDebugBody = this.state.debugBodies.find(
            (db) => db.label === 'pad'
          )
          if (existingDebugBody) {
            // Defold 좌표계로 변환
            const defoldPos = matterToDefold(body.position)
            existingDebugBody.x = defoldPos.x
            existingDebugBody.y = defoldPos.y
          }
        }
      })
    }
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
}
