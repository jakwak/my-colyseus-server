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
    if (statePlayers) this.statePlayers = statePlayers

    // 매니저 클래스들 초기화
    this.formationManager = new NpcFormationManager(
      this.world,
      npcs,
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
      npcs,
      this.myNpcIds,
      this.npcDirs,
      this.formationManager,
      1 // speedMultiplier
    )

    // 리더 매니저 초기화 시 콜백 전달
    this.leaderManager = new NpcLeaderManager(
      this.world,
      npcs,
      this.myNpcIds,
      this.leaderId,
      100, // election delay
      this.onLeaderChanged.bind(this) // 콜백 함수 전달
    )

    // 전투 매니저 초기화
    if (bullets && statePlayers) {
      this.combatManager = new NpcCombatManager(
        this.engine,
        npcs,
        statePlayers,
        bullets
      )
    }

    // 10초마다 formation 타입 변경
    this.formationChangeTimer = setInterval(() => {
      const formationTypes: NpcFormationType[] = [
        'v',
        'scatter',
        'hline',
        'escort',
        'line',
      ]
      const currentType = this.formationManager.getFormationType()
      const currentIndex = formationTypes.indexOf(currentType)
      const nextIndex = (currentIndex + 1) % formationTypes.length
      const newFormationType = formationTypes[nextIndex]

      // formation 타입 변경
      this.formationManager.setFormationType(newFormationType)

      // 새로운 formation에 맞게 역할 재할당
      this.myNpcIds.forEach((id) => {
        const index = Array.from(this.myNpcIds).indexOf(id)
        this.formationManager.assignRole(id, index, this.myNpcIds.size)
      })
    }, 10000) // 10초마다 실행
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

  // WanderManager 참조 설정 메서드 추가
  public setWanderManager(wanderManager: any) {
    this.wanderManager = wanderManager
  }

  spawnFollowers(count: number, size: number) {
    const leader = this.npcs.get(this.leaderId)
    if (!leader) return

    const leaderBody = this.world.bodies.find((b) => b.label === this.leaderId)
    if (!leaderBody) return

    // 단순히 리더 근처에 생성하고 역할만 할당
    for (let i = 0; i < count; i++) {
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
    }
  }

  private createFollower(x: number, y: number, size: number, id: string) {
    // 화면 영역 내로 좌표 보정
    const clampedX = clamp(x, MARGIN, SCREEN_WIDTH - MARGIN)
    const clampedY = clamp(y, MARGIN, SCREEN_HEIGHT - MARGIN)
    const body = createNpcBody(this.world, id, clampedX, clampedY, size / 2)

    const npc = new Npc()
    npc.id = id
    npc.type = 'follower'
    npc.x = clampedX
    npc.y = clampedY
    npc.owner_id = 'server'
    npc.size = size
    this.npcs.set(id, npc)
    this.myNpcIds.add(id) // 생성한 NPC ID 추가
    // 최초 방향은 임의로 (1,0) 전방
    this.npcDirs.set(id, { x: 1, y: 0 })
  }

  moveAllFollowers(deltaTime: number) {
    const leader = this.npcs.get(this.leaderId)
    const leaderBody = this.world.bodies.find((b) => b.label === this.leaderId)

    if (!leader || !leaderBody) {
      // 리더가 없을 때 새 리더 선출 처리
      this.leaderManager.handleLeaderlessState(deltaTime)
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

  // 타이머 정리 메서드
  public cleanup() {
    if (this.formationChangeTimer) {
      clearInterval(this.formationChangeTimer)
      this.formationChangeTimer = null
    }
  }
}
