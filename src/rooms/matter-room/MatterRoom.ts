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
  private playerController: PlayerController | null = null
  private starManager: StarManager | null = null

  // NPC 스폰 관련 개선된 속성들
  private isSpawningNpcs: boolean = false
  private spawnQueue: Array<{
    count: number
    size: number
    followerCount?: number
    followerSize?: number
  }> = []
  private lastSpawnTime: number = 0
  private readonly SPAWN_COOLDOWN = 2000 // 2초 쿨다운
  private readonly MAX_NPCS = 30 // 최대 NPC 수 제한 (10 -> 30으로 증가)
  private readonly MAX_SPAWN_PER_REQUEST = 1 // 한 번에 최대 스폰 수

  // 성능 모니터링 및 에러 처리
  private errorCount: number = 0
  private performanceMetrics = {
    frameCount: 0,
    lastFpsCheck: Date.now(),
    averageFrameTime: 0,
  }
  private isDevelopment: boolean = process.env.NODE_ENV !== 'production'

  constructor() {
    super()
    // 기본 초기화만 수행
    this.state = new State()
    const { engine, world } = createEngineAndWorld()
    this.engine = engine
    this.world = world
    addWalls(this.world)
  }

  onCreate() {
    console.log(`방 ${this.roomId} 생성됨`)

    // 방 초기화 수행
    this.initializeRoom()
  }

  // 방 초기화
  public initializeRoom() {
    try {
      console.log(`방 ${this.roomId} 초기화 시작`)

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

      this.setSimulationInterval((deltaTime) => this.update(deltaTime))

      // 메시지 핸들러 등록
      this.setupMessageHandlers()

      // 충돌 이벤트 리스너 등록
      Matter.Events.on(this.engine, 'collisionStart', (event) => {
        this.handleCollision(event)
      })

      if (this.isDevelopment) {
        console.log(`[ROOM_POOL] 방 ${this.roomId} 초기화 완료`)
      }
    } catch (error) {
      console.error(`[ROOM_POOL] 방 ${this.roomId} 초기화 에러:`, error)
      throw error
    }
  }

  private update(deltaTime: number) {
    const startTime = Date.now()

    try {
      Matter.Engine.update(this.engine, deltaTime)

      this.playerController?.updateAndCleanupBullets()
      this.npcWanderManager?.moveAllNpcs(deltaTime)
      this.starManager?.cleanupOldStars()

      // NPC 총알/미사일 위치 동기화 및 삭제
      this.npcWanderManager
        ?.getCombatManager()
        ?.syncAndCleanupNpcBullets(this.state.npcBullets)

      // 자동 NPC 스폰 (NPC 개수가 5개 이하일 때)
      this.checkAndAutoSpawnNpcs()

      if (this.npcWanderManager?.followerManagers && !this.isSpawningNpcs) {
        for (const fm of this.npcWanderManager.followerManagers) {
          const combatManager = fm.getCombatManager && fm.getCombatManager()
          combatManager?.syncAndCleanupNpcBullets(this.state.npcBullets)
        }
      }

      // 성능 측정
      this.performanceMetrics.frameCount++
      const frameTime = Date.now() - startTime
      this.performanceMetrics.averageFrameTime =
        this.performanceMetrics.averageFrameTime * 0.9 + frameTime * 0.1

      // 1초마다 FPS 체크
      if (Date.now() - this.performanceMetrics.lastFpsCheck > 1000) {
        const fps = this.performanceMetrics.frameCount
        if (this.isDevelopment) {
          console.log(
            `FPS: ${fps}, 평균 프레임 시간: ${this.performanceMetrics.averageFrameTime.toFixed(
              2
            )}ms`
          )
        }

        if (fps < 20) {
          console.warn('FPS가 낮습니다! 성능 최적화가 필요합니다.')
        }

        this.performanceMetrics.frameCount = 0
        this.performanceMetrics.lastFpsCheck = Date.now()
      }
    } catch (error) {
      console.error('시뮬레이션 루프 에러:', error)
      this.handleSimulationError(error)
    }
  }

  // 에러 복구 메커니즘
  private handleSimulationError(error: any) {
    console.error('시뮬레이션 에러 발생:', error)

    // 에러 카운터 증가
    this.errorCount = this.errorCount + 1

    // 연속 에러가 5회 이상 발생하면 방 종료
    if (this.errorCount > 5) {
      console.error('연속 에러로 인한 방 종료')
      console.log(`방 ${this.roomId} 종료됨`)
    } else {
      // 일시적으로 시뮬레이션 일시 중지
      setTimeout(() => {
        this.errorCount = 0
      }, 5000)
    }
  }

  private setupMessageHandlers() {
    this.onMessage('move', (client, data) => {
      try {
        this.playerController?.handleMove(client, data)
      } catch (error) {
        console.error('move 메시지 처리 에러:', error)
      }
    })

    this.onMessage('position_sync', (client, data) => {
      try {
        this.handlePositionSync(client, data)
      } catch (error) {
        console.error('position_sync 메시지 처리 에러:', error)
      }
    })

    this.onMessage('toggle_debug', (client, data) => {
      try {
        this.handleToggleDebug(client, data)
      } catch (error) {
        console.error('toggle_debug 메시지 처리 에러:', error)
      }
    })

    this.onMessage('get_debug_bodies', (client, data) => {
      try {
        this.handleGetDebugBodies(client, data)
      } catch (error) {
        console.error('get_debug_bodies 메시지 처리 에러:', error)
      }
    })

    this.onMessage('shoot_bullet', (client, data) => {
      try {
        this.playerController?.shootBullet(client, data)
      } catch (error) {
        console.error('shoot_bullet 메시지 처리 에러:', error)
      }

      // this.spawnInitialNpcs()

      try {
        if (
          this.npcWanderManager &&
          this.state.npcs.size < 5 &&
          !this.isSpawningNpcs
        ) {
          // 스폰 상태 설정
          this.isSpawningNpcs = true

          setTimeout(() => {
            try {
              this.npcWanderManager.spawnNpcs(
                3, // 초기 리더 수
                25, // 리더 크기
                7, // 팔로워 수
                5 // 팔로워 크기
              )
            } catch (error) {
              console.error('spawn_npc 메시지 처리 에러:', error)
            } finally {
              // 스폰 완료 후 상태 해제
              this.isSpawningNpcs = false
            }
          }, 10)
        }
      } catch (error) {
        console.error('spawn_npc 메시지 처리 에러:', error)
        this.isSpawningNpcs = false // 에러 발생 시에도 상태 해제
      }
    })

    this.onMessage('spawn_npc', (client, data) => {
      this.handleSpawnNpcRequest(client, data)
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

  onJoin(client: Client, options: any) {
    try {
      console.log(`플레이어 ${client.sessionId} 조인 (방: ${this.roomId})`)

      // 플레이어 생성 및 초기화
      this.playerController.createPlayer(client, options)

      console.log(`플레이어 ${client.sessionId} 생성 완료 (방: ${this.roomId})`)

      // 기존 NPC 정리 (새로운 플레이어를 위한 공간 확보)
      this.cleanupExistingNpcs()

      // NPC 스폰 시작
      this.startNpcSpawning()
    } catch (error) {
      console.error(`onJoin 에러 (방: ${this.roomId}):`, error)
      throw error
    }
  }

  // 기존 NPC 정리 메서드 추가
  private cleanupExistingNpcs() {
    try {
      const currentNpcCount = this.state.npcs.size
      console.log(`[CLEANUP] 기존 NPC 정리 시작: ${currentNpcCount}개`)

      if (currentNpcCount > 0) {
        // 모든 NPC ID 수집
        const npcIds = Array.from(this.state.npcs.keys()) as string[]

        // NPC 제거 (안전하게)
        npcIds.forEach((npcId) => {
          try {
            if (this.npcWanderManager) {
              this.npcWanderManager.removeNpcWithCleanup(npcId)
            }
          } catch (error) {
            console.error(`[CLEANUP] NPC ${npcId} 제거 실패:`, error)
          }
        })

        console.log(`[CLEANUP] 기존 NPC 정리 완료: ${npcIds.length}개 제거`)
      }
    } catch (error) {
      console.error(`[CLEANUP] NPC 정리 중 오류:`, error)
    }
  }

  // NPC 스폰 시작 메서드 추가
  private startNpcSpawning() {
    if (this.isSpawningNpcs) {
      console.log(`방 ${this.roomId}에서 NPC 스폰이 이미 진행 중`)
      return
    }

    this.isSpawningNpcs = true
    console.log(`방 ${this.roomId}에서 NPC 스폰 시작`)

    // NPC 스폰 로직 (기본값으로 호출)
    if (this.npcWanderManager) {
      try {
        this.npcWanderManager.spawnNpcs(5, 25, 2, 15) // 기본 NPC 5개, 팔로워 2개씩
        console.log(`방 ${this.roomId}에서 NPC 스폰 완료`)
      } catch (error) {
        console.error(`방 ${this.roomId}에서 NPC 스폰 실패:`, error)
      } finally {
        this.isSpawningNpcs = false
        console.log(`방 ${this.roomId}에서 NPC 스폰 상태 해제`)
      }
    } else {
      this.isSpawningNpcs = false
      console.log(`방 ${this.roomId}에서 NPC 매니저가 없어 스폰 실패`)
    }
  }

  onLeave(client: Client) {
    try {
      console.log(`플레이어 ${client.sessionId} 퇴장`)

      // playerController가 null인 경우 처리
      if (!this.playerController) {
        console.warn(
          `playerController가 null입니다. 방 ${this.roomId}에서 플레이어 ${client.sessionId} 퇴장 처리 생략`
        )
        return
      }

      this.playerController.removePlayerFromGame(client.sessionId)
      console.log(`플레이어 ${client.sessionId} 퇴장 완료`)

      // 플레이어 제거 후 남은 플레이어 수 체크 (즉시 체크)
      if (this.state.players.size === 0) {
        console.log(`모든 플레이어가 퇴장하여 방 ${this.roomId} 삭제 시작`)
        // 방 삭제를 비동기적으로 처리하여 안전성 확보
        setImmediate(() => {
          try {
            console.log(`방 ${this.roomId} 삭제 실행`)
            this.disconnect()
          } catch (error) {
            console.error(`방 ${this.roomId} 삭제 실패:`, error)
          }
        })
      }
    } catch (error) {
      console.error(`onLeave error:`, error, `(roomId: ${this.roomId})`)
    }
  }

  private removeBullet(bulletId: string) {
    if (typeof bulletId !== "string") return;
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
    if (typeof npcId !== "string" || !npcId.startsWith('npc_')) {
      return
    }

    // NPC 컨트롤러를 통해 제거 (올바른 메서드 사용)
    if (this.npcWanderManager) {
      this.npcWanderManager.removeNpcWithCleanup(npcId)
    }
  }

  // 방이 완전히 종료될 때 호출
  onDispose() {
    console.log(`방 ${this.roomId} 종료 시작`)

    try {
      // NPC 매니저 정리
      if (this.npcWanderManager) {
        console.log(`방 ${this.roomId} NPC 매니저 정리`)
        try {
          this.npcWanderManager.followerManagers.forEach((manager) => {
            try {
              manager.cleanup()
            } catch (error) {
              console.error(`팔로워 매니저 정리 실패:`, error)
            }
          })
        } catch (error) {
          console.error(`팔로워 매니저 배열 정리 실패:`, error)
        }
        this.npcWanderManager = null
      }

      // 모든 총알 제거 (안전한 방식으로)
      console.log(`방 ${this.roomId} 총알 정리`)
      try {
        const playerBulletIds = Array.from(this.state.playerBullets.keys()) as string[]
        const npcBulletIds = Array.from(this.state.npcBullets.keys()) as string[]

        playerBulletIds.forEach((bulletId) => {
          try {
            this.removeBullet(bulletId)
          } catch (error) {
            console.error(`플레이어 총알 제거 실패: ${bulletId}`, error)
          }
        })

        npcBulletIds.forEach((bulletId) => {
          try {
            this.removeBullet(bulletId)
          } catch (error) {
            console.error(`NPC 총알 제거 실패: ${bulletId}`, error)
          }
        })
      } catch (error) {
        console.error(`총알 정리 실패:`, error)
      }

      // 모든 NPC 제거 (안전한 방식으로)
      console.log(`방 ${this.roomId} NPC 정리`)
      try {
        const npcIds = Array.from(this.state.npcs.keys()) as string[]
        npcIds.forEach((npcId) => {
          try {
            this.removeNpc(npcId)
          } catch (error) {
            console.error(`NPC 제거 실패: ${npcId}`, error)
          }
        })
      } catch (error) {
        console.error(`NPC 정리 실패:`, error)
      }

      // 모든 Star 정리
      if (this.starManager) {
        console.log(`방 ${this.roomId} Star 정리`)
        try {
          this.starManager.cleanupAllStars()
        } catch (error) {
          console.error(`Star 정리 실패:`, error)
        }
        this.starManager = null
      }

      // PlayerController 정리
      if (this.playerController) {
        console.log(`방 ${this.roomId} PlayerController 정리`)
        this.playerController = null
      }

      console.log(`방 ${this.roomId} 종료 완료`)
    } catch (error) {
      console.error(`방 ${this.roomId} 종료 중 오류:`, error)
    }
  }

  // NPC가 죽을 때 Star 생성
  public createStarAtNpcDeath(
    npcId: string,
    x: number,
    y: number,
    ownerId: string
  ) {
    if (this.starManager) {
      this.starManager.createStar(x, y, ownerId)
    }
  }

  // 초기 NPC 스폰 메서드
  private spawnInitialNpcs() {
    if (this.isDevelopment) {
      console.log('초기 NPC 스폰 시작')
    }

    // 이미 스폰 중이거나 정리 중이면 중단
    if (this.isSpawningNpcs || !this.npcWanderManager) {
      if (this.isDevelopment) {
        console.log(
          '스폰 중단: 방이 정리 중이거나 NPC 매니저가 없거나 이미 스폰 중'
        )
      }
      return
    }

    // 스폰 상태 설정
    this.isSpawningNpcs = true

    try {
      // NPC 수를 제한하여 성능 보장
      const maxNpcs = 5 // 더 적은 수로 제한
      const currentNpcCount = this.state.npcs.size

      if (currentNpcCount >= maxNpcs) {
        if (this.isDevelopment) {
          console.log('NPC 수가 최대치에 도달하여 스폰하지 않음')
        }
        this.isSpawningNpcs = false // 스폰 상태 해제
        return
      }

      try {
        const npcsToSpawn = Math.min(2, maxNpcs - currentNpcCount) // 최대 2개만 스폰
        const followerCount = Math.floor(Math.random() * 3) + 1 // 팔로워 1~3명으로 제한

        if (this.isDevelopment) {
          console.log(
            `NPC 스폰 시작: ${npcsToSpawn}개 리더, 팔로워 ${followerCount}명`
          )
        }

        this.npcWanderManager?.spawnNpcs(npcsToSpawn, 25, followerCount, 15)

        if (this.isDevelopment) {
          console.log(
            `초기 NPC 스폰 완료: ${npcsToSpawn}개 리더, 팔로워 ${followerCount}명`
          )
        }
      } catch (error) {
        console.error('비동기 NPC 스폰 에러:', error)
      } finally {
        // 스폰 완료 후 상태 해제
        this.isSpawningNpcs = false
      }
    } catch (error) {
      console.error('초기 NPC 스폰 에러:', error)
      this.isSpawningNpcs = false // 에러 발생 시에도 상태 해제
    }
  }

  // 개선된 NPC 스폰 요청 처리
  private handleSpawnNpcRequest(client: Client, data: any) {
    const requestStartTime = Date.now()
    console.log(`[MATTER_ROOM] === NPC 스폰 요청 처리 시작 ===`)
    console.log(`[MATTER_ROOM] 클라이언트: ${client.sessionId}`)
    console.log(`[MATTER_ROOM] 요청 데이터:`, data)

    try {
      const currentTime = Date.now()

      // 쿨다운 체크
      if (currentTime - this.lastSpawnTime < this.SPAWN_COOLDOWN) {
        const remainingTime =
          this.SPAWN_COOLDOWN - (currentTime - this.lastSpawnTime)
        console.log(`[MATTER_ROOM] 스폰 쿨다운 중... (${remainingTime}ms 남음)`)
        return
      }

      // 현재 NPC 수 체크
      const currentNpcCount = this.state.npcs.size
      console.log(
        `[MATTER_ROOM] 현재 NPC 수: ${currentNpcCount}/${this.MAX_NPCS}`
      )

      if (currentNpcCount >= this.MAX_NPCS) {
        console.log(
          `[MATTER_ROOM] NPC 수가 최대치(${this.MAX_NPCS})에 도달했습니다.`
        )
        return
      }

      // 스폰 중이면 큐에 추가
      if (this.isSpawningNpcs) {
        console.log('[MATTER_ROOM] 스폰 중이므로 요청을 큐에 추가합니다.')
        const queueData = {
          count: Math.min(data.count || 2, this.MAX_SPAWN_PER_REQUEST),
          size: data.size || 25,
          followerCount: data.followerCount || 3,
          followerSize: data.followerSize || 15,
        }
        this.spawnQueue.push(queueData)
        console.log(`[MATTER_ROOM] 큐에 추가됨:`, queueData)
        console.log(`[MATTER_ROOM] 현재 큐 길이: ${this.spawnQueue.length}`)
        return
      }

      // 메모리 사용량 체크
      const memUsage = process.memoryUsage()
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024)
      console.log(`[MATTER_ROOM] 메모리 사용량: ${heapUsedMB}MB`)

      if (heapUsedMB > 150) {
        console.warn(
          `[MATTER_ROOM] 메모리 사용량이 높습니다: ${heapUsedMB}MB. 스폰을 건너뜁니다.`
        )
        return
      }

      const spawnData = {
        count: Math.min(data.count || 2, this.MAX_SPAWN_PER_REQUEST),
        size: data.size || 25,
        followerCount: data.followerCount || 3,
        followerSize: data.followerSize || 15,
      }

      console.log(`[MATTER_ROOM] 스폰 데이터 준비 완료:`, spawnData)
      this.processSpawnRequest(spawnData)
    } catch (error) {
      console.error('[MATTER_ROOM] spawn_npc 요청 처리 에러:', error)
    } finally {
      const requestElapsedTime = Date.now() - requestStartTime
      console.log(
        `[MATTER_ROOM] NPC 스폰 요청 처리 완료 (소요시간: ${requestElapsedTime}ms)`
      )
      console.log(`[MATTER_ROOM] === NPC 스폰 요청 처리 종료 ===`)
    }
  }

  // 실제 스폰 처리
  private processSpawnRequest(spawnData: {
    count: number
    size: number
    followerCount?: number
    followerSize?: number
  }) {
    const processStartTime = Date.now()
    console.log(`[MATTER_ROOM] === 실제 스폰 처리 시작 ===`)
    console.log(`[MATTER_ROOM] 스폰 데이터:`, spawnData)

    this.isSpawningNpcs = true
    this.lastSpawnTime = Date.now()

    console.log(
      `[MATTER_ROOM] NPC 스폰 시작: ${spawnData.count}개 리더, ${spawnData.followerCount}명 팔로워`
    )

    try {
      console.log(`[MATTER_ROOM] NpcWanderManager.spawnNpcs 호출 시작`)
      this.npcWanderManager?.spawnNpcs(
        spawnData.count,
        spawnData.size,
        spawnData.followerCount,
        spawnData.followerSize
      )
      console.log(`[MATTER_ROOM] NpcWanderManager.spawnNpcs 호출 완료`)
    } catch (error) {
      console.error('[MATTER_ROOM] NPC 스폰 실패:', error)
    } finally {
      this.isSpawningNpcs = false
      console.log(`[MATTER_ROOM] 스폰 상태 해제: isSpawningNpcs = false`)

      // 큐에 대기 중인 요청 처리
      if (this.spawnQueue.length > 0) {
        const nextRequest = this.spawnQueue.shift()
        console.log(`[MATTER_ROOM] 큐에서 다음 요청 처리:`, nextRequest)
        if (nextRequest) {
          console.log(`[MATTER_ROOM] 500ms 후 다음 요청 처리 예약`)
          setTimeout(() => {
            this.processSpawnRequest(nextRequest)
          }, 500) // 500ms 후 다음 요청 처리
        }
      } else {
        console.log(`[MATTER_ROOM] 큐가 비어있음`)
      }

      const processElapsedTime = Date.now() - processStartTime
      console.log(
        `[MATTER_ROOM] 실제 스폰 처리 완료 (소요시간: ${processElapsedTime}ms)`
      )
      console.log(`[MATTER_ROOM] === 실제 스폰 처리 종료 ===`)
    }
  }

  // 통합된 충돌 처리 메서드
  private handleCollision(event: any) {
    for (const pair of event.pairs) {
      const labelA = pair.bodyA.label
      const labelB = pair.bodyB.label

      // 플레이어 총알과 NPC 충돌
      if (labelA.startsWith('player_bullet_') && labelB.startsWith('npc_')) {
        console.log('플레이어 총알과 NPC 충돌:', labelA, labelB)
        // PlayerController의 handleBulletCollision 호출
        if (this.playerController) {
          // private 메서드이므로 직접 호출할 수 없으므로, 다른 방법 사용
          this.handlePlayerBulletCollision(labelA, labelB)
        }
      } else if (
        labelB.startsWith('player_bullet_') &&
        labelA.startsWith('npc_')
      ) {
        console.log('플레이어 총알과 NPC 충돌:', labelB, labelA)
        if (this.playerController) {
          this.handlePlayerBulletCollision(labelB, labelA)
        }
      }

      // 플레이어 총알과 다른 플레이어 충돌 (PvP)
      if (labelA.startsWith('player_bullet_') && labelB.startsWith('player_')) {
        console.log('플레이어 총알과 다른 플레이어 충돌:', labelA, labelB)
        this.handlePlayerVsPlayerCollision(
          labelA,
          labelB.replace('player_', '')
        )
      } else if (
        labelB.startsWith('player_bullet_') &&
        labelA.startsWith('player_')
      ) {
        console.log('플레이어 총알과 다른 플레이어 충돌:', labelB, labelA)
        this.handlePlayerVsPlayerCollision(
          labelB,
          labelA.replace('player_', '')
        )
      }

      // NPC 미사일과 플레이어 충돌
      if (labelA.startsWith('npc_missile_') && labelB.startsWith('player_')) {
        console.log('NPC 미사일과 플레이어 충돌:', labelA, labelB)
        this.handleNpcMissileCollision(labelA, labelB.replace('player_', ''))
      } else if (
        labelB.startsWith('npc_missile_') &&
        labelA.startsWith('player_')
      ) {
        console.log('NPC 미사일과 플레이어 충돌:', labelB, labelA)
        this.handleNpcMissileCollision(labelB, labelA.replace('player_', ''))
      }

      // NPC 총알과 플레이어 충돌
      if (labelA.startsWith('npc_bullet_') && labelB.startsWith('player_')) {
        console.log('NPC 총알과 플레이어 충돌:', labelA, labelB)
        this.handleNpcBulletCollision(labelA, labelB.replace('player_', ''))
      } else if (
        labelB.startsWith('npc_bullet_') &&
        labelA.startsWith('player_')
      ) {
        console.log('NPC 총알과 플레이어 충돌:', labelB, labelA)
        this.handleNpcBulletCollision(labelB, labelA.replace('player_', ''))
      }

      // Star와 플레이어 충돌
      if (labelA.startsWith('star_') && labelB.startsWith('player_')) {
        console.log('Star와 플레이어 충돌:', labelA, labelB)
        // StarManager의 handleStarPlayerCollision 호출
        if (this.starManager) {
          this.handleStarCollision(labelA, labelB.replace('player_', ''))
        }
      } else if (labelB.startsWith('star_') && labelA.startsWith('player_')) {
        console.log('Star와 플레이어 충돌:', labelB, labelA)
        if (this.starManager) {
          this.handleStarCollision(labelB, labelA.replace('player_', ''))
        }
      }
    }
  }

  // 플레이어 총알 충돌 처리
  private handlePlayerBulletCollision(bulletId: string, npcId: string) {
    const bullet = this.state.playerBullets.get(bulletId)
    if (!bullet) return

    const player = this.state.players.get(bullet.owner_id)
    const npc = this.state.npcs.get(npcId)

    if (!npc) return

    // console.log(`플레이어 총알 ${bulletId}가 NPC ${npcId}에 맞음!`)

    // NPC 체력 감소
    npc.hp -= npc.type === 'leader' ? bullet.power * 0.5 : bullet.power

    if (npc.hp <= 0) {
      console.log(`NPC ${npcId} 사망!`)
      // NPC가 죽을 때 Star 생성
      const npcBody = this.world.bodies.find((b) => b.label === npcId)
      if (npcBody) {
        const defoldPos = matterToDefold(npcBody.position)
        this.starManager?.createStar(defoldPos.x, defoldPos.y, bullet.owner_id)
      }

      // NPC 제거
      this.npcWanderManager?.removeNpcWithCleanup(npcId)

      // 플레이어 점수 추가
      if (player) {
        player.point += 50
        // player에게만 메세지 보내기
        const targetClient = this.clients.find(
          (client) => client.sessionId === bullet.owner_id
        )
        if (targetClient) {
          targetClient.send('add_score', {
            amount: 50,
            position: { x: npc.x, y: npc.y },
          })
        }
      }
    } else {
      // 플레이어 점수 추가 (데미지만)
      if (player) {
        player.point += 10
        const targetClient = this.clients.find(
          (client) => client.sessionId === bullet.owner_id
        )
        if (targetClient) {
          targetClient.send('add_score', {
            amount: 10,
            position: { x: npc.x, y: npc.y },
          })
        }
      }
    }

    // 총알 제거
    this.removeBullet(bulletId)
  }

  // Star 충돌 처리
  private handleStarCollision(starId: string, playerId: string) {
    const star = this.state.stars.get(starId)
    const player = this.state.players.get(playerId)

    if (!star || !player) return

    console.log(`플레이어 ${playerId}가 Star ${starId} 획득!`)

    // HP 회복
    const oldHp = player.hp
    player.hp = Math.min(100, player.hp + star.heal_amount)
    const healedAmount = player.hp - oldHp

    console.log(
      `플레이어 ${playerId} HP 회복: ${oldHp} -> ${player.hp} (+${healedAmount})`
    )

    // Star 제거
    this.starManager?.removeStar(starId)

    // 보너스 점수
    if (star.owner_id && star.owner_id !== playerId) {
      player.point += 10
      console.log(`보너스 점수 +10 for player ${playerId}`)
    }
  }

  // NPC 미사일 충돌 처리
  private handleNpcMissileCollision(missileId: string, playerId: string) {
    const missile = this.state.npcBullets.get(missileId)
    const player = this.state.players.get(playerId)

    if (!missile || !player) return

    console.log(`플레이어 ${playerId}가 NPC 미사일 ${missileId}에 맞음!`)

    // 플레이어 체력 감소 (미사일은 더 강함)
    const oldHp = player.hp
    player.hp = Math.max(0, player.hp - missile.power)
    const damage = oldHp - player.hp

    console.log(
      `플레이어 ${playerId} 데미지: ${oldHp} -> ${player.hp} (-${damage})`
    )

    // 플레이어 사망 처리
    if (player.hp <= 0) {
      console.log(`플레이어 ${playerId} 사망!`)
      player.score = Math.max(player.score, player.point)
      player.point = 0
      player.hp = 100 // 부활
    }

    // 미사일 제거
    this.removeBullet(missileId)
  }

  // NPC 총알 충돌 처리
  private handleNpcBulletCollision(bulletId: string, playerId: string) {
    const bullet = this.state.npcBullets.get(bulletId)
    const player = this.state.players.get(playerId)

    if (!bullet || !player) return

    console.log(`플레이어 ${playerId}가 NPC 총알 ${bulletId}에 맞음!`)

    // 플레이어 체력 감소
    const oldHp = player.hp
    player.hp = Math.max(0, player.hp - bullet.power)
    const damage = oldHp - player.hp

    console.log(
      `플레이어 ${playerId} 데미지: ${oldHp} -> ${player.hp} (-${damage})`
    )

    // 플레이어 사망 처리
    if (player.hp <= 0) {
      console.log(`플레이어 ${playerId} 사망!`)
      player.score = Math.max(player.score, player.point)
      player.point = 0
      player.hp = 100 // 부활
    }

    // 총알 제거
    this.removeBullet(bulletId)
  }

  // 플레이어 총알과 다른 플레이어 충돌 처리
  private handlePlayerVsPlayerCollision(bulletId: string, playerId: string) {
    const bullet = this.state.playerBullets.get(bulletId)
    const player = this.state.players.get(playerId)

    if (!bullet || !player) return

    // 자신이 쏜 총알에 맞지 않도록 체크
    if (bullet.owner_id === playerId) {
      // console.log(`플레이어 ${playerId}가 자신의 총알 ${bulletId}에 맞음 - 무시됨`)
      return
    }

    console.log(`플레이어 총알 ${bulletId}가 다른 플레이어 ${playerId}에 맞음!`)

    // 플레이어 체력 감소
    const oldHp = player.hp
    player.hp = Math.max(0, player.hp - bullet.power)
    const damage = oldHp - player.hp

    console.log(
      `플레이어 ${playerId} 데미지: ${oldHp} -> ${player.hp} (-${damage})`
    )

    // 플레이어 사망 처리
    if (player.hp <= 0) {
      console.log(`플레이어 ${playerId} 사망!`)
      player.score = Math.max(player.score, player.point)
      player.point = 0
      player.hp = 100 // 부활
    }

    // 총알 제거
    this.removeBullet(bulletId)
  }

  // 자동 NPC 스폰 체크 및 처리
  private checkAndAutoSpawnNpcs() {
    const currentNpcCount = this.state.npcs.size
    const targetNpcCount = 15 // 목표 NPC 수 증가 (10 -> 15)

    if (currentNpcCount < 8 && !this.isSpawningNpcs) {
      // 스폰 조건 완화 (5 -> 8)
      console.log(`[AUTO_SPAWN] NPC 개수: ${currentNpcCount}/8, 자동 스폰 시작`)

      // 스폰할 NPC 개수 계산 (최대 10개까지)
      const npcsToSpawn = Math.min(targetNpcCount - currentNpcCount, 10) // 한 번에 최대 10개씩

      this.isSpawningNpcs = true

      setTimeout(() => {
        try {
          if (this.npcWanderManager) {
            console.log(`[AUTO_SPAWN] ${npcsToSpawn}개 NPC 자동 스폰`)
            this.npcWanderManager.spawnNpcs(npcsToSpawn, 25, 3, 15)
          }
        } catch (error) {
          console.error('[AUTO_SPAWN] 자동 스폰 에러:', error)
        } finally {
          this.isSpawningNpcs = false
        }
      }, 100) // 100ms 지연으로 부하 분산
    }
  }
}
