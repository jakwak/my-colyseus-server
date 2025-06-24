import { Room, Client } from 'colyseus'
import { Player, State } from '../schema/MatterRoomState'
import {
  createEngineAndWorld,
  addWalls,
  moveBody,
  matterToDefold,
  defoldToMatter,
  setBodyPosition,
  SCREEN_HEIGHT,
} from './physics'
import Matter from 'matter-js'
import { NpcWanderManager } from './NpcWanderManager'
import { PlayerController } from './PlayerController'
import { StarManager } from './StarManager'

export class MatterRoom extends Room<State> {
  // 디버그 모드 (true면 물리 바디 정보 전송)
  private debugPhysics: boolean = true
  private engine: Matter.Engine
  private world: Matter.World
  private npcWanderManager: NpcWanderManager | null = null
  private isDisposing: boolean = false // 방 정리 중인지 체크
  private playerController: PlayerController | null = null
  private starManager: StarManager | null = null

  constructor() {
    super()
    this.state = new State()
    const { engine, world } = createEngineAndWorld()
    this.engine = engine
    this.world = world

    addWalls(this.world)

    // NPC 매니저 초기화
    this.npcWanderManager = new NpcWanderManager(
      this.engine,
      this.state.npcs,
      this.state.npcBullets,
      this.state.players
    )
    this.npcWanderManager.matterRoom = this

    this.playerController = new PlayerController(
      this.engine,
      this.state.players,
      this.state.playerBullets,
      this.npcWanderManager
    )

    this.starManager = new StarManager(
      this.engine,
      this.state.stars,
      this.state.players
    )

    // this.engine.timing.timeScale = 1

    // 물리 업데이트 루프
    this.setSimulationInterval((deltaTime) => {
      try {
        Matter.Engine.update(this.engine, deltaTime)
        this.playerController?.updateAndCleanupBullets()
        this.npcWanderManager?.moveAllNpcs(deltaTime)
        this.starManager?.cleanupOldStars()
        for (const fm of this.npcWanderManager.followerManagers) {
          const combatManager = fm.getCombatManager && fm.getCombatManager()
          combatManager?.syncAndCleanupNpcBullets(this.state.npcBullets)
        }
      } catch (error) {
        console.error('물리 엔진 업데이트 에러:', error)
        // 에러 발생 시 방을 안전하게 정리
        this.safeDispose()
      }
    }, 1000 / 60)

    this.onMessage('move', (client, data) => {
      try {
        this.playerController?.handleMove(client, data)
      } catch (error) {
        console.error('move 메시지 처리 에러:', error);
      }
    })
    
    this.onMessage('position_sync', (client, data) => {
      try {
        this.handlePositionSync(client, data)
      } catch (error) {
        console.error('position_sync 메시지 처리 에러:', error);
      }
    })
    
    this.onMessage('toggle_debug', (client, data) => {
      try {
        this.handleToggleDebug(client, data)
      } catch (error) {
        console.error('toggle_debug 메시지 처리 에러:', error);
      }
    })
    
    this.onMessage('get_debug_bodies', (client, data) => {
      try {
        this.handleGetDebugBodies(client, data)
      } catch (error) {
        console.error('get_debug_bodies 메시지 처리 에러:', error);
      }
    })
    
    this.onMessage('shoot_bullet', (client, data) => {
      try {
        this.playerController?.shootBullet(client, data)
      } catch (error) {
        console.error('shoot_bullet 메시지 처리 에러:', error);
      }
    })

    this.onMessage('spawn_npc', (client, data) => {
      try {
        if (this.npcWanderManager && this.state.npcs.size === 0) {
          this.npcWanderManager.spawnNpcs(
            3, // 초기 리더 수
            25, // 리더 크기
            Math.floor(Math.random() * 8) + 4, // 팔로워 4 ~ 11 명
            10 // 팔로워 크기
          )
        }
      } catch (error) {
        console.error('spawn_npc 메시지 처리 에러:', error);
      }
    })
  }

  onCreate() {
 
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
    options?: { x?: number; y?: number; username?: string; type?: string }
  ) {
    this.playerController.createPlayer(client, options)
  }

  onLeave(client: Client) {
    // 이미 방이 정리 중이면 중복 처리 방지
    if (this.isDisposing) {
      console.log('방이 이미 정리 중입니다.')
      return
    }

    console.log(`플레이어 ${client.sessionId} 퇴장 시작`)

    this.playerController.removePlayerFromGame(client.sessionId)

    // 모든 플레이어가 나가면 지연 삭제 스케줄링
    if (this.state.players.size === 0) {
      // this.scheduleRoomCleanup()
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

    // NPC 컨트롤러를 통해 제거 (올바른 메서드 사용)
    if (this.npcWanderManager) {
      this.npcWanderManager.removeNpcWithCleanup(npcId)
    }
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

      // 모든 총알 제거 - 직접 순회
      for (const bulletId of this.state.playerBullets.keys()) {
        this.removeBullet(bulletId)
      }
      for (const bulletId of this.state.npcBullets.keys()) {
        this.removeBullet(bulletId)
      }

      // 모든 NPC 제거 - 직접 순회
      for (const npcId of this.state.npcs.keys()) {
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
    this.isDisposing = true
    console.log('방 정리 시작...')
    
    // 모든 Star 정리
    this.starManager?.cleanupAllStars()
    
    // 기존 정리 로직
    if (this.state.players.size === 0 && !this.isDisposing) {
      console.log('방이 완전히 종료됩니다.')
    }
  }

  // NPC가 죽을 때 Star 생성
  public createStarAtNpcDeath(npcId: string, x: number, y: number, ownerId: string) {
    if (this.starManager) {
      this.starManager.createStar(x, y, ownerId)
    }
  }

  // 안전한 방 정리 메서드 추가
  private safeDispose() {
    try {
      console.log('에러로 인한 안전한 방 정리 시작')
      this.cleanupRoom()
    } catch (cleanupError) {
      console.error('방 정리 중 추가 에러:', cleanupError)
      // 강제로 방 연결 해제
      this.clients.forEach(client => {
        try {
          client.leave()
        } catch (e) {
          console.error('클라이언트 강제 퇴장 실패:', e)
        }
      })
    }
  }
}
