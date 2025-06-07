import { Room, Client } from 'colyseus'
import { Player, State } from '../schema/MatterRoomState'
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
import { PlayerController } from './PlayerController'

export class MatterRoom extends Room<State> {
  // 디버그 모드 (true면 물리 바디 정보 전송)
  private debugPhysics: boolean = true
  private engine: Matter.Engine
  private world: Matter.World
  private npcWanderManager: NpcWanderManager | null = null
  private isDisposing: boolean = false // 방 정리 중인지 체크
  private playerController: PlayerController | null = null

  constructor() {
    super()
    this.state = new State()
    const { engine, world } = createEngineAndWorld()
    this.engine = engine
    this.world = world

    addWalls(this.world)

    // NPC 매니저 초기화
    this.npcWanderManager = new NpcWanderManager(
      this.world,
      this.state.npcs,
      this.state.npcBullets,
      this.state.players
    )

    // // NPC 및 팔로워 생성 (1초 간격 5회)
    // let spawnCount = 0
    // const spawnInterval = setInterval(() => {
    //   this.npcWanderManager.spawnNpcs(
    //     1,
    //     25,
    //     Math.floor(Math.random() * 8) + 4,
    //     10
    //   )
    //   spawnCount++
    //   if (spawnCount >= 5) {
    //     clearInterval(spawnInterval)
    //   }
    // }, 1000)

    this.playerController = new PlayerController(this.engine, this.state.players, this.state.playerBullets, this.npcWanderManager)

    // 물리 업데이트 루프
    this.setSimulationInterval((deltaTime) => {
      Matter.Engine.update(this.engine, deltaTime)
      if (this.playerController) {
        this.playerController.updateAndCleanupBullets(this.state.playerBullets)
      }
      if (this.npcWanderManager) {
        this.npcWanderManager.moveAllNpcs(deltaTime)
        for (const fm of this.npcWanderManager.followerManagers) {
          const combatManager = fm.getCombatManager && fm.getCombatManager()
          if (combatManager) {
            combatManager.syncAndCleanupNpcBullets(this.state.npcBullets)
          }
        }
      }
    }, 1000 / 60)

  }

  onCreate() {
    this.onMessage('move', (client, data) => {
      if (this.playerController) {
        this.playerController.handleMove(client, data)
      }
    })
    this.onMessage('position_sync', this.handlePositionSync.bind(this))
    this.onMessage('toggle_debug', this.handleToggleDebug.bind(this))
    this.onMessage('get_debug_bodies', this.handleGetDebugBodies.bind(this))
    this.onMessage('shoot_bullet', (client, data) => {
      if (this.playerController) {
        this.playerController.shootBullet(client,data)
      }
    })

    this.onMessage('spawn_npc', (client, data) => {
      if (this.npcWanderManager && this.state.npcs.size === 0) {
        this.npcWanderManager.spawnNpcs(1, 25, Math.floor(Math.random() * 8) + 4, 10)
      }
    })
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
    const body = this.world.bodies.find(
      (b) => b.label === `player_${client.sessionId}`
    )
    if (body) {
      try {
        Matter.World.remove(this.world, body)
        console.log(`플레이어 ${client.sessionId} 물리 바디 제거됨`)
      } catch (error) {
        console.error(`플레이어 ${client.sessionId} 바디 제거 중 오류:`, error)
      }
    }

    // 플레이어 상태에서 제거
    this.state.players.delete(client.sessionId)
    console.log(`플레이어 ${client.sessionId} 상태에서 제거됨`)

    // // 플레이어가 소유한 총알들 제거
    // const playerBullets = Array.from(this.state.playerBullets.entries()).filter(
    //   ([_, bullet]) => bullet.owner_id === client.sessionId
    // )

    // for (const [bulletId, _] of playerBullets) {
    //   this.removeBullet(bulletId)
    // }

    // 모든 플레이어가 나가면 지연 삭제 스케줄링
    if (this.state.players.size === 0) {
      this.scheduleRoomCleanup()
    }
  }

  private removeBullet(bulletId: string) {
    if (!bulletId) return
    // Matter.js 바디도 안전하게 삭제
    const body = this.world.bodies.find((b) => b.label === bulletId)
    if (body) {
      try {
        Matter.World.remove(this.world, body)
      } catch {}
    }
    // MapSchema에서 존재할 때만 삭제
    if (this.state.playerBullets.has(bulletId)) {
      this.state.playerBullets.delete(bulletId)
    }
    if (this.state.npcBullets.has(bulletId)) {
      this.state.npcBullets.delete(bulletId)
    }
  }

  private removeNpc(npcId: string) {
    // npcId가 npc_로 시작하는지 확인
    if (!npcId.startsWith('npc_')) {
      return
    }

    // NPC 컨트롤러를 통해 제거
    this.npcWanderManager?.removeNpc(npcId)
  }

  // 방 정리를 지연시키는 메서드 (새로 추가)
  private scheduleRoomCleanup() {
    console.log('방 정리 스케줄링 시작')

    if (this.state.players.size === 0 && !this.isDisposing) {
      console.log('방이 비어있어 즉시 정리를 시작합니다.')
      this.cleanupRoom()
    }
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
      // NPC 매니저 정리
      if (this.npcWanderManager) {
        this.npcWanderManager.followerManagers.forEach((manager) => {
          manager.cleanup() // 각 팔로워 매니저의 타이머 정리
        })
        this.npcWanderManager = null
      }

      // 모든 총알 제거
      const allPlayerBullets = Array.from(this.state.playerBullets.keys())
      for (const bulletId of allPlayerBullets) {
        this.removeBullet(bulletId)
      }
      const allNpcBullets = Array.from(this.state.npcBullets.keys())
      for (const bulletId of allNpcBullets) {
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
  }
}
