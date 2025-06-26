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
  
  // 성능 모니터링 및 에러 처리
  private errorCount: number = 0
  private performanceMetrics = {
    frameCount: 0,
    lastFpsCheck: Date.now(),
    averageFrameTime: 0
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
    // 방이 생성될 때 한 번만 실행되는 초기화
    if (this.isDevelopment) {
      console.log('=== MatterRoom 생성됨 - onCreate 진입 ===')
    }
    
    try {
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

      // 물리 업데이트 루프 시작 (30fps로 조정)
      this.setSimulationInterval((deltaTime) => {
        const startTime = Date.now();
        
        try {
          Matter.Engine.update(this.engine, deltaTime)
          
          this.playerController?.updateAndCleanupBullets()
          this.npcWanderManager?.moveAllNpcs(deltaTime)
          this.starManager?.cleanupOldStars()
          
          if (this.npcWanderManager?.followerManagers) {
            for (const fm of this.npcWanderManager.followerManagers) {
              const combatManager = fm.getCombatManager && fm.getCombatManager()
              combatManager?.syncAndCleanupNpcBullets(this.state.npcBullets)
            }
          }
          
          // 성능 측정
          this.performanceMetrics.frameCount++;
          const frameTime = Date.now() - startTime;
          this.performanceMetrics.averageFrameTime = 
            (this.performanceMetrics.averageFrameTime * 0.9) + (frameTime * 0.1);
          
          // 1초마다 FPS 체크
          if (Date.now() - this.performanceMetrics.lastFpsCheck > 1000) {
            const fps = this.performanceMetrics.frameCount;
            if (this.isDevelopment) {
              console.log(`FPS: ${fps}, 평균 프레임 시간: ${this.performanceMetrics.averageFrameTime.toFixed(2)}ms`);
            }
            
            if (fps < 20) {
              console.warn('FPS가 낮습니다! 성능 최적화가 필요합니다.');
            }
            
            this.performanceMetrics.frameCount = 0;
            this.performanceMetrics.lastFpsCheck = Date.now();
          }
          
        } catch (error) {
          console.error('시뮬레이션 루프 에러:', error)
          this.handleSimulationError(error)
        }
      }, 1000 / 30) // 30fps로 조정

      // 메시지 핸들러 등록
      this.setupMessageHandlers()
      
      // 충돌 이벤트 리스너 등록
      Matter.Events.on(this.engine, 'collisionStart', (event) => {
        this.handleCollision(event)
      })
      
      if (this.npcWanderManager && this.state.npcs.size < 5) {
        // 방 생성 시 자동으로 NPC 스폰 (플레이어가 없어도)
        this.spawnInitialNpcs()
      }

      if (this.isDevelopment) {
        console.log('=== MatterRoom onCreate 완료 ===')
      }
    } catch (error) {
      console.error('=== MatterRoom onCreate 에러 ===:', error)
      console.error('에러 스택:', (error as Error).stack)
      throw error
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
      this.safeDispose()
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
      try {
        if (this.npcWanderManager && this.state.npcs.size < 5) {
          this.npcWanderManager.spawnNpcs(
            3, // 초기 리더 수
            25, // 리더 크기
            Math.floor(Math.random() * 8) + 4, // 팔로워 4 ~ 11 명
            10 // 팔로워 크기
          )
        }
      } catch (error) {
        console.error('spawn_npc 메시지 처리 에러:', error)
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
        console.error('spawn_npc 메시지 처리 에러:', error)
      }
    })

    // if (this.npcWanderManager && this.state.npcs.size === 0) {
    //   this.npcWanderManager.spawnNpcs(
    //     3, // 초기 리더 수
    //     25, // 리더 크기
    //     Math.floor(Math.random() * 8) + 4, // 팔로워 4 ~ 11 명
    //     10 // 팔로워 크기
    //   )
    // }
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
    this.playerController?.createPlayer(client, options)
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
    // if (this.state.players.size === 0) {
    //   this.scheduleRoomCleanup()
    // }
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
      this.state.playerBullets.delete(bulletId as any)
    }
    if (this.state.npcBullets.has(bulletId)) {
      this.state.npcBullets.delete(bulletId as any)
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

  // 초기 NPC 스폰 메서드
  private spawnInitialNpcs() {
    if (this.isDevelopment) {
      console.log('초기 NPC 스폰 시작')
    }
    
    try {
      // NPC 수를 제한하여 성능 보장
      const maxNpcs = 10;
      const currentNpcCount = this.state.npcs.size;
      
      if (currentNpcCount < maxNpcs) {
        const npcsToSpawn = Math.min(3, maxNpcs - currentNpcCount);
        this.npcWanderManager?.spawnNpcs(
          npcsToSpawn, // 최대 3개만 스폰
          25,
          Math.floor(Math.random() * 4) + 2, // 팔로워 2~5명으로 제한
          15
        )
        
        if (this.isDevelopment) {
          console.log(`초기 NPC 스폰 완료: ${npcsToSpawn}개 리더, 팔로워 2~5명`)
        }
      } else {
        if (this.isDevelopment) {
          console.log('NPC 수가 최대치에 도달하여 스폰하지 않음')
        }
      }
    } catch (error) {
      console.error('초기 NPC 스폰 에러:', error)
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
      } else if (labelB.startsWith('player_bullet_') && labelA.startsWith('npc_')) {
        console.log('플레이어 총알과 NPC 충돌:', labelB, labelA)
        if (this.playerController) {
          this.handlePlayerBulletCollision(labelB, labelA)
        }
      }
      
      // 플레이어 총알과 다른 플레이어 충돌 (PvP)
      if (labelA.startsWith('player_bullet_') && labelB.startsWith('player_')) {
        console.log('플레이어 총알과 다른 플레이어 충돌:', labelA, labelB)
        this.handlePlayerVsPlayerCollision(labelA, labelB.replace('player_', ''))
      } else if (labelB.startsWith('player_bullet_') && labelA.startsWith('player_')) {
        console.log('플레이어 총알과 다른 플레이어 충돌:', labelB, labelA)
        this.handlePlayerVsPlayerCollision(labelB, labelA.replace('player_', ''))
      }
      
      // NPC 미사일과 플레이어 충돌
      if (labelA.startsWith('npc_missile_') && labelB.startsWith('player_')) {
        console.log('NPC 미사일과 플레이어 충돌:', labelA, labelB)
        this.handleNpcMissileCollision(labelA, labelB.replace('player_', ''))
      } else if (labelB.startsWith('npc_missile_') && labelA.startsWith('player_')) {
        console.log('NPC 미사일과 플레이어 충돌:', labelB, labelA)
        this.handleNpcMissileCollision(labelB, labelA.replace('player_', ''))
      }
      
      // NPC 총알과 플레이어 충돌
      if (labelA.startsWith('npc_bullet_') && labelB.startsWith('player_')) {
        console.log('NPC 총알과 플레이어 충돌:', labelA, labelB)
        this.handleNpcBulletCollision(labelA, labelB.replace('player_', ''))
      } else if (labelB.startsWith('npc_bullet_') && labelA.startsWith('player_')) {
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
      this.npcWanderManager?.removeNpc(npcId)
      
      // 플레이어 점수 추가
      if (player) {
        player.point += 50
      }
    } else {
      // 플레이어 점수 추가 (데미지만)
      if (player) {
        player.point += 10
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
    
    console.log(`플레이어 ${playerId} HP 회복: ${oldHp} -> ${player.hp} (+${healedAmount})`)
    
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
    
    console.log(`플레이어 ${playerId} 데미지: ${oldHp} -> ${player.hp} (-${damage})`)
    
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
    
    console.log(`플레이어 ${playerId} 데미지: ${oldHp} -> ${player.hp} (-${damage})`)
    
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
    
    console.log(`플레이어 ${playerId} 데미지: ${oldHp} -> ${player.hp} (-${damage})`)
    
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
}
