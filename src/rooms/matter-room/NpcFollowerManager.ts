import Matter from 'matter-js'
import { Bullet, Npc, Player } from '../schema/MatterRoomState'
import { createNpcBody, SCREEN_WIDTH, SCREEN_HEIGHT } from './physics'
import { MapSchema } from '@colyseus/schema'
import { clamp, matterToDefold } from './NpcPhysicsUtils'
import { NpcBaseController } from './NpcBaseController'
import { NpcCombatManager } from './NpcCombatManager'
import { NpcFormationManager } from './NpcFormationManager'
import { NpcMovementManager } from './NpcMovementManager'
import { NpcLeaderManager } from './NpcLeaderManager'
import { getRandomTargetNear } from './NpcTargetUtils'

const MARGIN = 40

export type NpcFormationType = 'v' | 'line' | 'escort' | 'scatter' | 'hline'

export class NpcFollowerManager extends NpcBaseController {
  public statePlayers: MapSchema<Player> | null = null
  public leaderId: string
  public myNpcIds: Set<string> = new Set() // 이 매니저가 생성한 NPC ID들
  private npcDirs: Map<string, { x: number; y: number }> = new Map() // 각 NPC별 현재 방향
  public temporaryTargetActive: boolean = false
  public returningToFormation: boolean = false
  public temporaryTargetActivatedAt: number | null = null
  public temporaryTargetPlayerId: string | null = null

  // 전투 시스템 추가
  private combatManager: NpcCombatManager | null = null
  public combatEnabled: boolean = false // 전투 활성화 여부

  // 매니저 클래스들
  private formationManager: NpcFormationManager
  private movementManager: NpcMovementManager
  private leaderManager: NpcLeaderManager
  private formationChangeTimer: NodeJS.Timeout | null = null

  // WanderManager 참조 추가
  private wanderManager: any = null

  // 매니저가 정리되었는지 확인하는 플래그 추가
  private isCleanedUp: boolean = false

  // 추가 속성들
  private bullets: MapSchema<Bullet> | null = null
  private matterRoom: any = null
  private isDevelopment: boolean = process.env.NODE_ENV !== 'production'
  
  // 스폰 상태 추적
  private isSpawningFollowers: boolean = false // 팔로워 스폰 중인지 체크

  constructor(
    engine: Matter.Engine,
    npcs: MapSchema<Npc>,
    leaderId: string,
    formationType: NpcFormationType = 'v',
    statePlayers?: MapSchema<Player>,
    bullets?: MapSchema<Bullet>
  ) {
    super(engine, npcs)
    this.leaderId = leaderId
    this.statePlayers = statePlayers || null
    this.bullets = bullets || null

    // 매니저 시스템들 초기화 (올바른 생성자 시그니처 사용)
    this.formationManager = new NpcFormationManager(
      this.world,
      this.npcs,
      this.myNpcIds,
      new Map(), // followerRoles
      new Map(), // scatterTargets
      formationType,
      50, // baseDistance
      Math.PI / 4, // formationAngle
      50 // formationSpacing
    )
  
    this.movementManager = new NpcMovementManager(
      this.world,
      this.npcs,
      this.myNpcIds,
      this.npcDirs,
      this.formationManager,
      1 // speedMultiplier
    )

    this.leaderManager = new NpcLeaderManager(
      this.world,
      this.npcs,
      this.myNpcIds,
      this.leaderId,
      100, // election delay
      this.onLeaderChanged.bind(this) // 콜백 함수 전달
    )

    // 전투 매니저 초기화
    if (this.bullets && this.statePlayers) {
      this.combatManager = new NpcCombatManager(
        this.engine,
        this.npcs,
        this.statePlayers,
        this.bullets
      )
    }

    // 대형 변경 타이머 설정 (10초마다 랜덤 대형 변경)
    this.formationChangeTimer = setInterval(() => {
      const formationTypes: NpcFormationType[] = ['v', 'line', 'escort', 'scatter', 'hline']
      const randomFormation = formationTypes[Math.floor(Math.random() * formationTypes.length)]
      this.formationManager.setFormationType(randomFormation)
      
      // 모든 팔로워의 역할 재할당
      const followerIds = Array.from(this.myNpcIds)
      followerIds.forEach((followerId, index) => {
        this.formationManager.assignRole(followerId, index, followerIds.length)
        if (this.isDevelopment) {
          console.log(`[FOLLOWER] 대형 변경: ${randomFormation}, NPC 갯수: ${followerIds.length}`)
        }
      })      
    }, 10000)
  }

  spawnFollowers(count: number, size: number) {
    // 이미 스폰 중이면 중단
    if (this.isSpawningFollowers) {
      if (this.isDevelopment) {
        console.log('[FOLLOWER] 이미 팔로워 스폰 중이므로 중단')
      }
      return
    }
    
    // 스폰 상태 설정
    this.isSpawningFollowers = true
    
    if (this.isDevelopment) {
      console.log(`[FOLLOWER] 팔로워 스폰 시작: ${count}명`)
    }
    
    const leader = this.npcs.get(this.leaderId)
    if (!leader) {
      console.error(`[FOLLOWER] 리더 ${this.leaderId}를 찾을 수 없음`)
      this.isSpawningFollowers = false // 상태 해제
      return
    }

    const leaderBody = this.world.bodies.find((b) => b.label === this.leaderId)
    if (!leaderBody) {
      console.error(`[FOLLOWER] 리더 ${this.leaderId}의 바디를 찾을 수 없음`)
      this.isSpawningFollowers = false // 상태 해제
      return
    }

    try {
      // 단순히 리더 근처에 생성하고 역할만 할당
      for (let i = 0; i < count; i++) {
        try {
          const id = `${this.leaderId}_follower_${i}`

          // 리더 위치에서 약간 랜덤하게 생성 (대형은 moveAllFollowers에서 자동으로 맞춰짐)
          const offsetX = (Math.random() - 0.5) * 50
          const offsetY = (Math.random() - 0.5) * 50

          this.createFollower(
            leaderBody.position.x + offsetX,
            leaderBody.position.y + offsetY,
            size,
            id
          )

          // 역할만 할당 (대형별 로직)
          this.formationManager.assignRole(id, i, count)
          
          if (this.isDevelopment) {
            console.log(`[FOLLOWER] 팔로워 ${i+1}/${count} 생성 완료: ${id}`)
          }
        } catch (followerError) {
          console.error(`[FOLLOWER] 팔로워 ${i}번째 생성 실패:`, followerError)
          continue // 이 팔로워는 건너뛰고 다음으로
        }
      }
      
      if (this.isDevelopment) {
        console.log(`[FOLLOWER] 팔로워 스폰 완료: ${count}명`)
      }
    } catch (error) {
      console.error('[FOLLOWER] 팔로워 스폰 전체 실패:', error)
    } finally {
      // 스폰 완료 후 상태 해제
      this.isSpawningFollowers = false
    }
  }

  private createFollower(x: number, y: number, size: number, id: string) {
    try {
      // 화면 영역 내로 좌표 보정
      const clampedX = clamp(x, MARGIN, SCREEN_WIDTH - MARGIN)
      const clampedY = clamp(y, MARGIN, SCREEN_HEIGHT - MARGIN)
      
      // Matter.js 바디 생성 시 예외 처리
      let body;
      try {
        body = createNpcBody(this.world, id, clampedX, clampedY, size / 2)
      } catch (bodyError) {
        console.error(`[FOLLOWER] 팔로워 바디 생성 실패: ${id}`, bodyError)
        throw bodyError
      }

      const npc = new Npc()
      npc.id = id
      npc.type = 'follower'
      npc.x = clampedX
      npc.y = clampedY
      npc.hp = 50
      npc.owner_id = 'server'
      npc.size = size
      this.npcs.set(id, npc)
      this.myNpcIds.add(id) // 생성한 NPC ID 추가
      // 최초 방향은 임의로 (1,0) 전방
      this.npcDirs.set(id, { x: 1, y: 0 })
      
      if (this.isDevelopment) {
        console.log(`[FOLLOWER] 팔로워 생성 완료: ${id} at (${clampedX}, ${clampedY})`)
      }
    } catch (error) {
      console.error(`[FOLLOWER] 팔로워 생성 실패: ${id}`, error)
      throw error
    }
  }

  moveAllFollowers(deltaTime: number) {
    // 매니저가 정리되었으면 조기 종료
    if (this.isCleanedUp) {
      return
    }

    const leader = this.npcs.get(this.leaderId)
    const leaderBody = this.world.bodies.find((b) => b.label === this.leaderId)

    if (!leader || !leaderBody) {
      // 리더가 없을 때 팔로워들을 wandering NPC로 변환
      console.log(`[FOLLOWER] 리더 ${this.leaderId} 없음, 팔로워들을 wandering NPC로 변환`)
      
      // 팔로워 매니저 정리 (내부에서 팔로워들을 wandering NPC로 변환)
      this.cleanup()
      return
    }

    // 리더 변경 확인
    if (this.leaderManager.checkAndResetLeaderChanged()) {
      const newLeaderId = this.leaderManager.getLeaderId()
      console.log(
        `[FOLLOWER] 리더 변경 감지: ${this.leaderId} -> ${newLeaderId}`
      )

      // WanderManager에게 새 리더 등록 요청
      if (this.wanderManager) {
        console.log(
          `[FOLLOWER] WanderManager에 새 리더 등록 요청: ${newLeaderId}`
        )
        this.wanderManager.registerNewLeader(newLeaderId, this.leaderId)
      } else {
        console.log(`[FOLLOWER] WanderManager 참조가 없습니다!`)
      }

      // 자체 리더 ID 업데이트
      this.changeLeader(newLeaderId)
      return
    }

    // 리더 선출이 진행 중이면 대기
    if (this.leaderManager.isLeaderElectionInProgress()) {
      return
    }

    // 기존 로직 계속...
    const leaderPos = leaderBody.position
    const leaderVelocity = leaderBody.velocity
    const leaderSpeed = Math.sqrt(
      leaderVelocity.x * leaderVelocity.x + leaderVelocity.y * leaderVelocity.y
    )
    const leaderAngle = Math.atan2(leaderVelocity.y, leaderVelocity.x)
    const followerIds = Array.from(this.myNpcIds)

    for (let i = 0; i < followerIds.length; i++) {
      const id = followerIds[i]
      const role = this.formationManager.getRole(id)
      const npc = this.npcs.get(id)
      if (!npc) continue
      const followerBody = this.world.bodies.find((b) => b.label === id)
      if (!followerBody) continue

      if (
        this.combatEnabled &&
        this.temporaryTargetActive &&
        this.temporaryTargetPlayerId
      ) {
        this.movementManager.moveToTemporaryTarget(
          id,
          followerBody,
          npc,
          leaderAngle,
          leaderSpeed,
          this.temporaryTargetPlayerId,
          this.statePlayers
        )
        continue
      }

      if (this.returningToFormation) {
        const distanceToTarget = this.movementManager.moveFollower(
          id,
          i,
          role,
          followerBody,
          npc,
          followerIds,
          leaderPos,
          leaderAngle,
          leaderSpeed,
          true
        )
        if (distanceToTarget <= 5) {
          this.returningToFormation = false
        }
        continue
      }

      this.movementManager.moveFollower(
        id,
        i,
        role,
        followerBody,
        npc,
        followerIds,
        leaderPos,
        leaderAngle,
        leaderSpeed,
        false
      )
    }

    // 전투 AI 업데이트 (이동 후에 수행)
    if (this.combatEnabled && this.combatManager) {
      // 리더도 전투에 참여
      const allCombatNpcs = [this.leaderId, ...followerIds]
      this.combatManager.updateCombatAI(deltaTime, allCombatNpcs)
    }
  }

  // 전투 시스템 제어 메서드들
  public enableCombat() {
    this.combatEnabled = true
  }

  public disableCombat() {
    this.combatEnabled = false
  }

  public getCombatManager(): NpcCombatManager | null {
    return this.combatManager
  }

  public getFollowerCount(): number {
    return this.myNpcIds.size
  }

  public changeLeader(newLeaderId: string) {
    const oldLeaderId = this.leaderId
    this.leaderId = newLeaderId
    this.leaderManager.setLeaderId(newLeaderId)

    // 모든 팔로워의 owner_id도 업데이트
    this.myNpcIds.forEach((followerId) => {
      const follower = this.npcs.get(followerId)
      if (follower) {
        follower.owner_id = newLeaderId
      }
      // 새로운 리더에 맞게 역할 재할당
      const index = Array.from(this.myNpcIds).indexOf(followerId)
      this.formationManager.assignRole(followerId, index, this.myNpcIds.size)
    })

    console.log(`[FOLLOWER] 리더 변경: ${oldLeaderId} -> ${newLeaderId}`)
  }

  // 팔로워 NPC 제거 메서드
  public removeFollowerNpc(npcId: string) {
    // npcId가 npc_로 시작하는지 확인
    if (!npcId.startsWith('npc_')) {
      return;
    }

    // 물리 엔진에서 바디 제거
    const npcBody = this.world.bodies.find((body) => body.label === npcId);
    if (npcBody) {
      try {
        // 월드에서 바디 즉시 제거
        Matter.World.remove(this.world, npcBody);
        console.log(`[FOLLOWER] 팔로워 바디 제거 완료: ${npcId}`)
      } catch (error) {
        console.warn(`[FOLLOWER] 팔로워 바디 제거 실패: ${npcId}`, error)
      }
    }

    // NPC 상태에서 제거
    this.npcs.delete(npcId);
    console.log(`[FOLLOWER] 팔로워 상태 제거 완료: ${npcId}`)
    
    // 내부 데이터 정리
    this.myNpcIds.delete(npcId)
    this.npcDirs.delete(npcId)
  }

  // 타이머 정리 메서드
  public cleanup() {
    // 이미 정리되었으면 중복 실행 방지
    if (this.isCleanedUp) {
      return
    }

    if (this.formationChangeTimer) {
      clearInterval(this.formationChangeTimer)
      this.formationChangeTimer = null
    }
    
    // 모든 팔로워를 wandering NPC로 변환
    const followerIds = Array.from(this.myNpcIds)
    for (const followerId of followerIds) {
      const follower = this.npcs.get(followerId)
      if (follower) {
        follower.type = 'wanderer'
        follower.color = '#FF6B6B'
        
        // WanderManager에 등록
        if (this.wanderManager) {
          this.wanderManager.myNpcIds.add(followerId)
          this.wanderManager.npcDirs.set(followerId, { x: 1, y: 0 })
          
          const followerBody = this.world.bodies.find((b) => b.label === followerId)
          if (followerBody) {
            const target = getRandomTargetNear(followerBody.position.x, followerBody.position.y, 1500, { x: 1, y: 0 })
            this.wanderManager.npcTargets.set(followerId, target)
          }
        }
      }
    }
    
    // 내부 데이터 정리
    this.myNpcIds.clear()
    this.npcDirs.clear()
    this.temporaryTargetActive = false
    this.returningToFormation = false
    this.temporaryTargetActivatedAt = null
    this.temporaryTargetPlayerId = null
    this.combatEnabled = false
    
    // 정리 완료 플래그 설정
    this.isCleanedUp = true
    
    console.log(`[FOLLOWER] 팔로워 매니저 정리 완료: ${this.leaderId}`)
  }

  // 매니저가 정리되었는지 확인하는 getter 메서드
  public getIsCleanedUp(): boolean {
    return this.isCleanedUp
  }

  // WanderManager 참조 설정 메서드
  public setWanderManager(wanderManager: any) {
    this.wanderManager = wanderManager
  }

  // MatterRoom 참조 설정 메서드
  public setMatterRoom(matterRoom: any) {
    this.matterRoom = matterRoom
  }

  // 리더 변경 콜백 함수
  private onLeaderChanged(oldLeaderId: string, newLeaderId: string) {
    console.log(
      `[FOLLOWER] 리더 변경 콜백 받음: ${oldLeaderId} -> ${newLeaderId}`
    )

    // 1. 자체 리더 ID 업데이트
    this.changeLeader(newLeaderId)

    // 2. WanderManager에게 새 리더 등록 요청
    if (this.wanderManager) {
      console.log(
        `[FOLLOWER] WanderManager에 새 리더 등록 요청: ${newLeaderId}`
      )
      this.wanderManager.registerNewLeader(newLeaderId, oldLeaderId)
    } else {
      console.log(`[FOLLOWER] WanderManager 참조가 없습니다!`)
    }
  }
}
