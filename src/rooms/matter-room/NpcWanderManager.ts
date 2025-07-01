import Matter from 'matter-js'
import { createNpcBody, SCREEN_WIDTH, SCREEN_HEIGHT, CATEGORY_PLAYER, CATEGORY_WALL, CATEGORY_BULLET, CATEGORY_NPC } from './physics'
import { Bullet, Npc, Player } from '../schema/MatterRoomState'
import { MapSchema } from '@colyseus/schema'
import { NpcFollowerManager, NpcFormationType } from './NpcFollowerManager'
import {
  detectObstacles,
  calculateAvoidanceDirection,
} from './NpcObstacleUtils'
import { getRandomTargetNear } from './NpcTargetUtils'
import { NpcBaseController } from './NpcBaseController'
import { NpcCombatManager } from './NpcCombatManager'
import { MatterRoom } from './MatterRoom'

const NPC_MOVE_RADIUS = 800 // NPC 이동 반경
const NPC_SPEED = 100 // 모든 NPC의 이동 속도
const NPC_LEADER_SPEED = 100 // 리더 NPC의 이동 속도 (더 빠르게)
const NPC_RETURN_TO_FORMATION_TIME = 10000 // 팔로워가 대형으로 돌아가는 시간 (10초)
const NPC_RETURN_TO_FORMATION_DISTANCE = 1000 // 팔로워가 대형으로 돌아가는 거리

export class NpcWanderManager extends NpcBaseController {
  private npcTargets: Map<string, { x: number; y: number }> = new Map() // 각 NPC별 목표 지점
  private npcDirs: Map<string, { x: number; y: number }> = new Map() // 각 NPC별 현재 방향
  private myNpcIds: Set<string> = new Set() // 이 매니저가 생성한 NPC ID들
  public followerManagers: NpcFollowerManager[] = [] // 각 그룹별 팔로워 매니저
  private statePlayers: MapSchema<Player>
  private bullets: MapSchema<Bullet>
  private combatManager?: NpcCombatManager
  public matterRoom?: any // MatterRoom 참조
  private isDevelopment: boolean = process.env.NODE_ENV !== 'production'

  // 스폰 상태 추적
  private isSpawning: boolean = false
  private spawnRetryCount: number = 0
  private readonly MAX_SPAWN_RETRIES = 3
  private readonly SPAWN_INTERVAL = 300 // 300ms 간격

  constructor(
    engine: Matter.Engine,
    npcs: MapSchema<Npc>,
    bullets: MapSchema<Bullet>,
    players: MapSchema<Player>
  ) {
    super(engine, npcs)

    if (this.isDevelopment) {
      console.log('=== NpcWanderManager 생성자 진입 ===')
    }

    try {
      this.bullets = bullets
      this.combatManager = new NpcCombatManager(engine, npcs, players, bullets)
      this.statePlayers = players

      if (this.isDevelopment) {
        console.log('=== NpcWanderManager 생성자 완료 ===')
      }
    } catch (error) {
      console.error('=== NpcWanderManager 생성자 에러 ===:', error)
      throw error
    }
  }
  // 임의의 NPC ID 반환
  public getRandomNpcId(): string | null {
    const npcIds = Array.from(this.myNpcIds)
    if (npcIds.length === 0) return null
    return npcIds[Math.floor(Math.random() * npcIds.length)]
  }

  // 새 리더 등록 메서드 추가
  public registerNewLeader(newLeaderId: string, oldLeaderId: string) {
    if (this.isDevelopment) {
      console.log(
        `[WANDER] 새 리더 등록 요청 받음: ${newLeaderId} (이전: ${oldLeaderId})`
      )
    }

    // 1. 새 리더를 wandering NPC 목록에 추가
    this.myNpcIds.add(newLeaderId)

    // 2. 새 리더의 초기 방향과 타겟 설정
    this.npcDirs.set(newLeaderId, { x: 1, y: 0 })

    const newLeader = this.npcs.get(newLeaderId)
    if (newLeader) {
      // 현재 위치 근처에서 새로운 타겟 설정
      const target = getRandomTargetNear(
        newLeader.x,
        newLeader.y,
        NPC_MOVE_RADIUS,
        { x: 1, y: 0 }
      )
      this.npcTargets.set(newLeaderId, target)
      if (this.isDevelopment) {
        console.log(
          `[WANDER] 새 리더 ${newLeaderId} wandering 시작, 타겟: (${target.x}, ${target.y})`
        )
      }
    } else {
      if (this.isDevelopment) {
        console.log(`[WANDER] 새 리더 ${newLeaderId}를 찾을 수 없음`)
      }
    }
  }

  // 개선된 NPC 스폰 함수
  public spawnNpcs(
    count: number,
    size: number,
    followerCount?: number,
    followerSize?: number
  ) {
    const startTime = Date.now()
    console.log(`[WANDER] === NPC 스폰 시작 ===`)
    console.log(
      `[WANDER] 요청: ${count}개 리더, ${followerCount || 0}명 팔로워`
    )
    console.log(`[WANDER] 현재 NPC 수: ${this.npcs.size}`)

    // 메모리 사용량 체크
    const memUsage = process.memoryUsage()
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024)
    console.log(`[WANDER] 메모리 사용량: ${heapUsedMB}MB`)

    if (heapUsedMB > 200) {
      console.warn(
        `[WANDER] 메모리 사용량이 높습니다: ${heapUsedMB}MB. 스폰을 건너뜁니다.`
      )
      return
    }

    // 이미 스폰 중이면 중단
    if (this.isSpawning) {
      console.log('[WANDER] 이미 스폰 중이므로 중단')
      return
    }

    // 스폰 개수 제한
    const maxSpawnCount = Math.min(count, 5)
    console.log(`[WANDER] 실제 스폰할 개수: ${maxSpawnCount}개`)

    this.isSpawning = true
    this.spawnRetryCount = 0

    console.log(
      `[WANDER] NPC 스폰 시작: ${maxSpawnCount}개 리더, 팔로워 ${
        followerCount || 0
      }명`
    )

    // 단계별 스폰 처리
    this.spawnNpcsSequentially(
      maxSpawnCount,
      size,
      0,
      followerCount,
      followerSize,
      startTime
    )
  }

  // 순차적 스폰 처리
  private spawnNpcsSequentially(
    totalCount: number,
    size: number,
    currentIndex: number,
    followerCount?: number,
    followerSize?: number,
    startTime?: number
  ) {
    console.log(`[WANDER] 순차 스폰 진행: ${currentIndex + 1}/${totalCount}`)

    if (currentIndex >= totalCount) {
      this.isSpawning = false
      const elapsedTime = startTime ? Date.now() - startTime : 0
      console.log(
        `[WANDER] NPC 스폰 완료: ${totalCount}개 리더 생성됨 (소요시간: ${elapsedTime}ms)`
      )
      console.log(`[WANDER] === NPC 스폰 종료 ===`)
      return
    }

    try {
      console.log(`[WANDER] ${currentIndex + 1}번째 NPC 생성 시작`)
      this.spawnSingleNpc(size, followerCount, followerSize)
      console.log(`[WANDER] ${currentIndex + 1}번째 NPC 생성 완료`)
    } catch (error) {
      console.error(`[WANDER] NPC ${currentIndex + 1}번째 생성 실패:`, error)
      this.spawnRetryCount++

      if (this.spawnRetryCount < this.MAX_SPAWN_RETRIES) {
        console.log(
          `[WANDER] 재시도 ${this.spawnRetryCount}/${this.MAX_SPAWN_RETRIES}`
        )
      }
    }

    // 다음 NPC 스폰 예약
    console.log(`[WANDER] ${this.SPAWN_INTERVAL}ms 후 다음 NPC 스폰 예약`)
    setTimeout(() => {
      this.spawnNpcsSequentially(
        totalCount,
        size,
        currentIndex + 1,
        followerCount,
        followerSize,
        startTime
      )
    }, this.SPAWN_INTERVAL)
  }

  // 단일 NPC 스폰 (개선된 버전)
  private spawnSingleNpc(
    size: number,
    followerCount?: number,
    followerSize?: number
  ) {
    const spawnStartTime = Date.now()
    const leader_id = `npc_leader_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`

    console.log(`[WANDER] 단일 NPC 스폰 시작: ${leader_id}`)

    // 스폰 전 안전성 체크
    if (!this.engine || !this.world) {
      console.error(`[WANDER] 엔진 또는 월드가 없음: ${leader_id}`)
      return
    }

    // 메모리 사용량 체크
    const memUsage = process.memoryUsage()
    if (memUsage.heapUsed > 200 * 1024 * 1024) {
      // 200MB 이상
      console.warn(
        `[WANDER] 메모리 사용량 높음: ${(
          memUsage.heapUsed /
          1024 /
          1024
        ).toFixed(2)}MB`
      )
    }

    try {
      // 안전한 위치 계산
      const x = Math.max(
        100,
        Math.min(SCREEN_WIDTH - 100, Math.random() * SCREEN_WIDTH)
      )
      const y = Math.max(
        100,
        Math.min(SCREEN_HEIGHT - 100, Math.random() * SCREEN_HEIGHT)
      )

      console.log(
        `[WANDER] NPC 위치 계산: ${leader_id} at (${x.toFixed(2)}, ${y.toFixed(
          2
        )})`
      )

      // NPC 바디 생성 (createNpcBody 함수 사용)
      const npcBody = createNpcBody(this.world, leader_id, x, y, size / 2)

      console.log(`[WANDER] NPC 바디 생성 완료: ${leader_id}`)
      console.log(`[WANDER] 월드에 NPC 바디 추가 완료: ${leader_id}`)

      // NPC 객체 생성
      const npc = new Npc()
      npc.id = leader_id
      npc.x = x
      npc.y = y
      npc.size = size
      npc.owner_id = 'server'
      npc.power = 10
      npc.color = '#FFB300'
      npc.type = 'leader'

      console.log(`[WANDER] NPC 객체 속성 설정 완료: ${leader_id}`)

      // MapSchema에 NPC 추가 (동기화 문제 방지)
      console.log(`[WANDER] MapSchema에 NPC 추가 시작: ${leader_id}`)

      // 동기화 문제를 방지하기 위해 순차적 처리
      try {
        // 먼저 내부 상태 업데이트
        this.myNpcIds.add(leader_id)
        this.npcDirs.set(leader_id, { x: 1, y: 0 })
        this.npcTargets.set(
          leader_id,
          getRandomTargetNear(x, y, NPC_MOVE_RADIUS, { x: 1, y: 0 })
        )
        console.log(`[WANDER] 내부 상태 업데이트 완료: ${leader_id}`)

        // 그 다음 MapSchema에 추가
        this.npcs.set(leader_id, npc)
        console.log(`[WANDER] MapSchema에 NPC 추가 완료: ${leader_id}`)
      } catch (error) {
        console.error(`[WANDER] MapSchema 추가 실패: ${leader_id}`, error)
        // 실패 시 정리 작업
        this.myNpcIds.delete(leader_id)
        this.npcDirs.delete(leader_id)
        this.npcTargets.delete(leader_id)
        Matter.World.remove(this.world, npcBody)
        return
      }

      const spawnElapsedTime = Date.now() - spawnStartTime
      console.log(
        `[WANDER] 리더 NPC 생성 완료: ${leader_id} at (${x.toFixed(
          2
        )}, ${y.toFixed(2)}) (소요시간: ${spawnElapsedTime}ms)`
      )

      // 팔로워는 별도 처리 (지연 처리로 부하 분산)
      if (followerCount && followerSize) {
        console.log(
          `[WANDER] 팔로워 스폰 예약: ${leader_id}의 ${followerCount}명 팔로워`
        )
        // 지연 시간을 늘려서 부하 분산
        setTimeout(() => {
          this.spawnFollowersForLeader(leader_id, followerCount, followerSize)
        }, 200)
      }
    } catch (error) {
      console.error(`[WANDER] NPC 스폰 중 오류: ${leader_id}`, error)
      // 오류 발생 시 정리 작업
      try {
        this.myNpcIds.delete(leader_id)
        this.npcDirs.delete(leader_id)
        this.npcTargets.delete(leader_id)
        if (this.world) {
          const bodyToRemove = this.world.bodies.find(
            (b) => b.label === leader_id
          )
          if (bodyToRemove) {
            Matter.World.remove(this.world, bodyToRemove)
          }
        }
      } catch (cleanupError) {
        console.error(`[WANDER] 정리 작업 중 오류: ${leader_id}`, cleanupError)
      }
    }
  }

  // 팔로워 스폰 (개선된 버전)
  private spawnFollowersForLeader(
    leaderId: string,
    followerCount: number,
    followerSize: number
  ) {
    console.log(
      `[WANDER] 팔로워 스폰 시작: ${leaderId}의 ${followerCount}명 팔로워`
    )
    const followerStartTime = Date.now()

    // 팔로워 매니저 수 제한 (메모리 누수 방지)
    if (this.followerManagers.length > 20) {
      console.warn(
        `[WANDER] 팔로워 매니저 수가 너무 많음: ${this.followerManagers.length}`
      )
      // 오래된 매니저 정리
      this.cleanupOldFollowerManagers()
    }

    try {
      console.log(`[WANDER] NpcFollowerManager 생성 시작: ${leaderId}`)
      const followerManager = new NpcFollowerManager(
        this.engine,
        this.npcs,
        leaderId,
        'v',
        this.statePlayers,
        this.bullets
      )
      console.log(`[WANDER] NpcFollowerManager 생성 완료: ${leaderId}`)

      console.log(`[WANDER] WanderManager 설정: ${leaderId}`)
      followerManager.setWanderManager(this)

      if (this.matterRoom) {
        console.log(`[WANDER] MatterRoom 설정: ${leaderId}`)
        followerManager.setMatterRoom(this.matterRoom)
      }

      // 팔로워 스폰을 지연시켜 부하 분산
      console.log(`[WANDER] 팔로워 스폰 300ms 지연 예약: ${leaderId}`)
      setTimeout(() => {
        try {
          console.log(`[WANDER] 팔로워 스폰 실행 시작: ${leaderId}`)
          followerManager.spawnFollowers(followerCount, followerSize)
          console.log(`[WANDER] 팔로워 스폰 실행 완료: ${leaderId}`)

          console.log(`[WANDER] 전투 활성화: ${leaderId}`)
          followerManager.enableCombat()

          console.log(`[WANDER] 팔로워 매니저 배열에 추가: ${leaderId}`)
          this.followerManagers.push(followerManager)

          const followerElapsedTime = Date.now() - followerStartTime
          console.log(
            `[WANDER] 팔로워 매니저 생성 완료: ${leaderId}의 ${followerCount}명 팔로워 (소요시간: ${followerElapsedTime}ms)`
          )
        } catch (followerError) {
          console.error(`[WANDER] 팔로워 스폰 실패: ${leaderId}`, followerError)
          // 실패 시 매니저 정리
          this.removeFollowerManager(leaderId)
        }
      }, 300)
    } catch (followerError) {
      console.error(
        `[WANDER] 팔로워 매니저 생성 실패: ${leaderId}`,
        followerError
      )
    }
  }

  // 오래된 팔로워 매니저 정리
  private cleanupOldFollowerManagers() {
    const now = Date.now()
    const maxAge = 5 * 60 * 1000 // 5분

    this.followerManagers = this.followerManagers.filter((manager) => {
      if (manager.createdAt && now - manager.createdAt > maxAge) {
        console.log(`[WANDER] 오래된 팔로워 매니저 정리: ${manager.leaderId}`)
        try {
          manager.cleanup()
        } catch (error) {
          console.error(
            `[WANDER] 팔로워 매니저 정리 실패: ${manager.leaderId}`,
            error
          )
        }
        return false
      }
      return true
    })
  }

  // 특정 팔로워 매니저 제거
  private removeFollowerManager(leaderId: string) {
    const index = this.followerManagers.findIndex(
      (manager) => manager.leaderId === leaderId
    )
    if (index !== -1) {
      const manager = this.followerManagers[index]
      console.log(`[WANDER] 팔로워 매니저 제거: ${leaderId}`)
      try {
        manager.cleanup()
      } catch (error) {
        console.error(`[WANDER] 팔로워 매니저 정리 실패: ${leaderId}`, error)
      }
      this.followerManagers.splice(index, 1)
    }
  }

  // 모든 NPC 이동
  public moveAllNpcs(deltaTime: number) {
    try {
      // 안전성 체크
      if (!this.world || !this.engine) {
        console.warn('[WANDER] 월드 또는 엔진이 없어서 NPC 이동 중단')
        return
      }

      // isActive 대신 적절한 조건으로 활성 바디 필터링
      const activeBodies = this.world.bodies.filter(
        (b) => b.label && !b.isStatic && b.label.startsWith('npc_')
      )

      // myNpcIds 접근 시 안전성 체크
      if (!this.myNpcIds || this.myNpcIds.size === 0) {
        return
      }

      // 전투 AI 업데이트 추가 - NPC들이 총알과 미사일을 발사하도록 함
      if (this.combatManager) {
        try {
          const npcIds = Array.from(this.myNpcIds)
          this.combatManager.updateCombatAI(deltaTime, npcIds)
        } catch (combatError) {
          console.error('[WANDER] 전투 AI 업데이트 실패:', combatError)
        }
      }

      // NPC 이동 처리
      for (const id of this.myNpcIds) {
        try {
          const npc = this.npcs.get(id)
          if (!npc) {
            console.warn(`[WANDER] NPC를 찾을 수 없음: ${id}`)
            continue
          }

          const npcBody = activeBodies.find((b) => b.label === id)
          if (!npcBody) {
            console.warn(`[WANDER] NPC 바디를 찾을 수 없음: ${id}`)
            continue
          }

          let target = this.npcTargets.get(id)
          let dir = this.npcDirs.get(id) || { x: 1, y: 0 }

          const detectedPlayer =
            this.combatManager?.detectPlayerInMovementDirection(id)
          if (detectedPlayer && detectedPlayer.distance <= 400) {
            for (const fm of this.followerManagers) {
              if (fm.leaderId === id && !fm.temporaryTargetActive) {
                fm.temporaryTargetPlayerId = detectedPlayer.playerId
                fm.temporaryTargetActive = true
                fm.temporaryTargetActivatedAt = Date.now()
                fm.returningToFormation = false
                fm.enableCombat()
              }
            }
          }

          if (detectObstacles(this.world, npcBody, dir, this.statePlayers)) {
            const newDir = calculateAvoidanceDirection(dir)
            const angleDiff = Math.abs(
              Math.atan2(newDir.y, newDir.x) - Math.atan2(dir.y, dir.x)
            )
            if (angleDiff < Math.PI / 2) {
              dir = newDir
              this.npcDirs.set(id, dir)
              // 벽 근처라면 맵 중앙 쪽으로 목표 강제 이동
              const MARGIN = 80
              if (
                npcBody.position.x < MARGIN * 1.5 ||
                npcBody.position.x > SCREEN_WIDTH - MARGIN * 1.5 ||
                npcBody.position.y < MARGIN * 1.5 ||
                npcBody.position.y > SCREEN_HEIGHT - MARGIN * 1.5
              ) {
                target = { x: SCREEN_WIDTH / 2, y: SCREEN_HEIGHT / 2 }
                this.npcTargets.set(id, target)
              } else {
                target = getRandomTargetNear(
                  npcBody.position.x,
                  npcBody.position.y,
                  NPC_MOVE_RADIUS,
                  dir
                )
                this.npcTargets.set(id, target)
              }
            }
          }
          if (!target) {
            target = getRandomTargetNear(
              npcBody.position.x,
              npcBody.position.y,
              NPC_MOVE_RADIUS,
              dir
            )
            this.npcTargets.set(id, target)
          }
          const dx = target.x - npcBody.position.x
          const dy = target.y - npcBody.position.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 10) {
            const curDir = dist > 0.01 ? { x: dx / dist, y: dy / dist } : dir
            this.npcDirs.set(id, curDir)
            const newTarget = getRandomTargetNear(
              npcBody.position.x,
              npcBody.position.y,
              NPC_MOVE_RADIUS,
              curDir
            )
            this.npcTargets.set(id, newTarget)
            continue
          }

          if (id.includes('follower')) {
            this.moveNpcToTarget(id, target, { speed: NPC_SPEED*2 });
          } else {
            this.moveNpcToTarget(id, target, { speed: NPC_LEADER_SPEED });
          }

          const dx2 = target.x - npcBody.position.x
          const dy2 = target.y - npcBody.position.y
          const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2)
          this.npcDirs.set(id, { x: dx2 / (dist2 || 1), y: dy2 / (dist2 || 1) })
        } catch (npcError) {
          console.error(`[WANDER] NPC ${id} 이동 처리 중 오류:`, npcError)
        }
      }

      // 팔로워 매니저 처리
      for (const fm of this.followerManagers) {
        try {
          let shouldReturn = false
          if (fm.temporaryTargetActive && fm.temporaryTargetActivatedAt) {
            if (
              Date.now() - fm.temporaryTargetActivatedAt >
              NPC_RETURN_TO_FORMATION_TIME
            ) {
              shouldReturn = true
            }
            if (fm.temporaryTargetPlayerId && this.statePlayers) {
              const player = this.statePlayers.get(fm.temporaryTargetPlayerId)
              const leaderBody = activeBodies.find(
                (b) => b.label === fm.leaderId
              )
              if (player && leaderBody) {
                const dx = player.x - leaderBody.position.x
                const dy = SCREEN_HEIGHT - player.y - leaderBody.position.y
                if (
                  Math.sqrt(dx * dx + dy * dy) >
                  NPC_RETURN_TO_FORMATION_DISTANCE
                ) {
                  shouldReturn = true
                }
              }
            }
          }
          if (shouldReturn) {
            fm.temporaryTargetActive = false
            fm.returningToFormation = true
            fm.temporaryTargetActivatedAt = null
            fm.temporaryTargetPlayerId = null
            fm.disableCombat()
          }
          fm.moveAllFollowers(deltaTime)
        } catch (followerError) {
          console.error(
            `[WANDER] 팔로워 매니저 ${fm.leaderId} 처리 중 오류:`,
            followerError
          )
        }
      }

      // 정리된 팔로워 매니저들을 배열에서 제거
      this.followerManagers = this.followerManagers.filter(
        (fm) => !fm.getIsCleanedUp()
      )
    } catch (error) {
      console.error('[WANDER] moveAllNpcs 중 오류:', error)
    }
  }

  // NPC 제거 시 관련 데이터 정리
  public removeNpcWithCleanup(npcId: string) {
    // npcId가 npc_로 시작하는지 확인
    if (!npcId.startsWith('npc_')) {
      return
    }

    // 물리 엔진에서 바디 제거
    const npcBody = this.world.bodies.find((body) => body.label === npcId)
    if (npcBody) {
      try {
        // 월드에서 바디 즉시 제거
        Matter.World.remove(this.world, npcBody)
        if (this.isDevelopment) {
          console.log(`[WANDER] 바디 제거 완료: ${npcId}`)
        }
      } catch (error) {
        console.warn(`[WANDER] 바디 제거 실패: ${npcId}`, error)
      }
    }

    // NPC 상태에서 제거
    this.npcs.delete(npcId)
    if (this.isDevelopment) {
      console.log(`[WANDER] NPC 상태 제거 완료: ${npcId}`)
    }

    // 내부 데이터 정리
    this.myNpcIds.delete(npcId)
    this.npcTargets.delete(npcId)
    this.npcDirs.delete(npcId)

    // 팔로워 매니저에서도 정리
    for (let i = this.followerManagers.length - 1; i >= 0; i--) {
      const fm = this.followerManagers[i]
      if (fm.leaderId === npcId) {
        // 리더가 죽었으므로 팔로워들을 wandering NPC로 변환
        if (this.isDevelopment) {
          console.log(
            `[WANDER] 리더 ${npcId} 죽음, 팔로워들을 wandering NPC로 변환`
          )
        }

        // 팔로워 매니저 정리 (내부에서 팔로워들을 wandering NPC로 변환)
        fm.cleanup()
        this.followerManagers.splice(i, 1)
        if (this.isDevelopment) {
          console.log(`[WANDER] 팔로워 매니저 정리 완료: ${npcId}`)
        }
      } else {
        // 팔로워가 죽었으므로 해당 팔로워만 정리
        fm.removeFollowerNpc(npcId)
      }
    }

    if (this.isDevelopment) {
      console.log(`[WANDER] NPC 완전 정리 완료: ${npcId}`)
      console.log(`[WANDER] 현재 월드 바디 수: ${this.world.bodies.length}`)
    }
  }

  // 명시적 정리
  private cleanupTimers() {
    // 모든 팔로워 매니저의 타이머 정리
    this.followerManagers.forEach((fm) => {
      if (fm.cleanup) {
        fm.cleanup()
      }
    })

    // 내부 타이머 정리
    this.followerManagers = []
    this.myNpcIds.clear()
    this.npcTargets.clear()
    this.npcDirs.clear()

    console.log('[WANDER] 모든 타이머 정리 완료')
  }

  // NPC 스폰 최적화
  private async spawnNpcsOptimized(count: number) {
    // 배치 처리로 메모리 효율성 향상
    const batchSize = 3
    for (let i = 0; i < count; i += batchSize) {
      await this.spawnBatch(Math.min(batchSize, count - i))
      await new Promise((resolve) => setTimeout(resolve, 50)) // 지연으로 부하 분산
    }
  }

  // 물리 엔진 최적화
  private optimizePhysics() {
    // isActive 대신 적절한 조건으로 불필요한 바디 제거
    this.world.bodies = this.world.bodies.filter(
      (body) => body.label && !body.isStatic && body.label.startsWith('npc_')
    )
  }

  private async spawnBatch(count: number) {
    for (let i = 0; i < count; i++) {
      try {
        this.spawnSingleNpc(25, 3, 15)
        await new Promise((resolve) => setTimeout(resolve, 10))
      } catch (error) {
        console.error(`[WANDER] 배치 스폰 실패: ${i}번째`, error)
      }
    }
  }

  public getCombatManager() {
    return this.combatManager
  }
}
