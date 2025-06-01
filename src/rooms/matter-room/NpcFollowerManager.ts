import Matter from 'matter-js'
import { Npc } from '../schema/MatterRoomState'
import {
  createNpcBody,
  CATEGORY_NPC,
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
} from './physics'
import { MapSchema } from '@colyseus/schema'
import { clamp, defoldToMatter, matterToDefold } from './NpcPhysicsUtils'
import {
  getFormationTargetForFollower,
  getBoxEscortOffsets,
} from './NpcFormationUtils'

const MARGIN = 40

export type NpcFormationType = 'v' | 'line' | 'escort' | 'scatter' | 'hline'

export class NpcFollowerManager {
  private world: Matter.World
  private npcs: MapSchema<Npc>
  public leaderId: string
  public myNpcIds: Set<string> = new Set() // 이 매니저가 생성한 NPC ID들
  private npcDirs: Map<string, { x: number; y: number }> = new Map() // 각 NPC별 현재 방향
  public formationType: NpcFormationType
  public followerRoles: Map<
    string,
    'left' | 'right' | 'center' | 'front' | 'back' | 'box' | 'scatter' | 'hline'
  > = new Map()
  public scatterTargets: Map<string, { x: number; y: number }> = new Map()
  public temporaryTarget: { x: number; y: number } | null = null
  public temporaryTargetActive: boolean = false
  public returningToFormation: boolean = false
  public tempTargetOffsets: Map<string, { x: number; y: number }> = new Map()
  public temporaryTargetActivatedAt: number | null = null

  // 직접 수정 가능한 속성들
  formationAngle: number = Math.PI / 4 // 45도 각도 (0 ~ π/2)
  baseDistance: number = 50 // 기본 간격 (50 ~ 300)
  speedMultiplier: number = 0.5 // 리더 대비 속도 비율 (0.1 ~ 2.0)
  formationSpacing: number = 50 // V자형 내 NPC 간 간격 (20 ~ 200)

  constructor(
    world: Matter.World,
    npcs: MapSchema<Npc>,
    leaderId: string,
    formationType: NpcFormationType = 'v'
  ) {
    this.world = world
    this.npcs = npcs
    this.leaderId = leaderId
    this.formationType = formationType
  }

  spawnFollowers(count: number, size: number) {
    const leader = this.npcs.get(this.leaderId)
    if (!leader) return

    const leaderBody = this.world.bodies.find((b) => b.label === this.leaderId)
    if (!leaderBody) return

    if (this.formationType === 'scatter') {
      const radius = 100
      const minDist = 50
      const offsets: { x: number; y: number }[] = []
      for (let i = 0; i < count; i++) {
        let offset: { x: number; y: number }
        let tryCount = 0
        while (true) {
          const angle = Math.random() * 2 * Math.PI
          const r = Math.random() * radius
          offset = { x: Math.cos(angle) * r, y: Math.sin(angle) * r }
          // 모든 기존 오프셋과의 거리 체크
          const ok = offsets.every((o) => {
            const dx = o.x - offset.x
            const dy = o.y - offset.y
            return Math.sqrt(dx * dx + dy * dy) >= minDist
          })
          if (ok || tryCount++ > 100) break // 100번 시도 후엔 그냥 배치
        }
        offsets.push(offset)
        const id = `${this.leaderId}_follower_${i}`
        const x = leaderBody.position.x + offset.x
        const y = leaderBody.position.y + offset.y
        this.createFollower(x, y, size, id)
        this.followerRoles.set(id, 'scatter')
        this.scatterTargets.set(id, offset)
      }
      return
    }

    if (this.formationType === 'hline') {
      // 리더 기준 좌우로 일렬 배치 (리더 방향 기준)
      const centerIdx = count / 2 - 0.5
      const leaderBodyAngle = leaderBody.angle
      const perpX = Math.cos(leaderBodyAngle + Math.PI / 2)
      const perpY = Math.sin(leaderBodyAngle + Math.PI / 2)
      const forwardX = Math.cos(leaderBodyAngle)
      const forwardY = Math.sin(leaderBodyAngle)
      for (let i = 0; i < count; i++) {
        const id = `${this.leaderId}_follower_${i}`
        const offset = (i - centerIdx) * this.formationSpacing
        let x, y
        if (count % 2 === 1 && i === Math.floor(centerIdx + 0.5)) {
          // 홀수면 중앙은 리더 앞
          x = leaderBody.position.x + forwardX * this.baseDistance
          y = leaderBody.position.y + forwardY * this.baseDistance
        } else {
          x = leaderBody.position.x + perpX * offset
          y = leaderBody.position.y + perpY * offset
        }
        this.createFollower(x, y, size, id)
        this.followerRoles.set(id, 'hline')
      }
      return
    }

    // 역할 분배
    let idx = 0
    if (this.formationType === 'escort') {
      if (count === 1) {
        const id = `${this.leaderId}_follower_${idx++}`
        this.createFollower(
          leaderBody.position.x,
          leaderBody.position.y,
          size,
          id
        )
        this.followerRoles.set(id, 'front')
      } else if (count === 2) {
        const idL = `${this.leaderId}_follower_${idx++}`
        this.createFollower(
          leaderBody.position.x,
          leaderBody.position.y,
          size,
          idL
        )
        this.followerRoles.set(idL, 'left')
        const idR = `${this.leaderId}_follower_${idx++}`
        this.createFollower(
          leaderBody.position.x,
          leaderBody.position.y,
          size,
          idR
        )
        this.followerRoles.set(idR, 'right')
      } else if (count === 3) {
        const idF = `${this.leaderId}_follower_${idx++}`
        this.createFollower(
          leaderBody.position.x,
          leaderBody.position.y,
          size,
          idF
        )
        this.followerRoles.set(idF, 'front')
        const idL = `${this.leaderId}_follower_${idx++}`
        this.createFollower(
          leaderBody.position.x,
          leaderBody.position.y,
          size,
          idL
        )
        this.followerRoles.set(idL, 'left')
        const idR = `${this.leaderId}_follower_${idx++}`
        this.createFollower(
          leaderBody.position.x,
          leaderBody.position.y,
          size,
          idR
        )
        this.followerRoles.set(idR, 'right')
      } else {
        // 4개 이상: 박스 + 뒤
        const perSide = Math.floor(count / 4)
        const boxCount = perSide * 4
        for (let side = 0; side < 4; side++) {
          for (let j = 0; j < perSide; j++) {
            const id = `${this.leaderId}_follower_${idx++}`
            this.createFollower(
              leaderBody.position.x,
              leaderBody.position.y,
              size,
              id
            )
            this.followerRoles.set(id, 'box')
          }
        }
        const remainingCount = count - boxCount
        for (let i = 0; i < remainingCount; i++) {
          const id = `${this.leaderId}_follower_${idx++}`
          this.createFollower(
            leaderBody.position.x,
            leaderBody.position.y,
            size,
            id
          )
          this.followerRoles.set(id, 'back')
        }
      }
    } else {
      // V자형/일자형
      let left = 0,
        right = 0
      for (let i = 0; i < count; i++) {
        const id = `${this.leaderId}_follower_${i}`
        // 마지막 1개가 남았고, count가 홀수면 center
        if (count % 2 === 1 && i === count - 1) {
          this.createFollower(
            leaderBody.position.x,
            leaderBody.position.y,
            size,
            id
          )
          this.followerRoles.set(id, 'center')
        } else if (i % 2 === 0) {
          this.createFollower(
            leaderBody.position.x,
            leaderBody.position.y,
            size,
            id
          )
          this.followerRoles.set(id, 'left')
          left++
        } else {
          this.createFollower(
            leaderBody.position.x,
            leaderBody.position.y,
            size,
            id
          )
          this.followerRoles.set(id, 'right')
          right++
        }
      }
    }
    // console.log(`[FOLLOWER] 팔로워 생성 완료: leaderId=${this.leaderId}, count=${count}, myNpcIds=[${Array.from(this.myNpcIds).join(',')}]`);
  }

  private createFollower(x: number, y: number, size: number, id: string) {
    // 화면 영역 내로 좌표 보정
    const clampedX = clamp(x, MARGIN, SCREEN_WIDTH - MARGIN)
    const clampedY = clamp(y, MARGIN, SCREEN_HEIGHT - MARGIN)
    const body = createNpcBody(this.world, id, clampedX, clampedY, size / 2)

    const npc = new Npc()
    npc.id = id
    npc.x = clampedX
    npc.y = clampedY
    npc.owner_id = 'server'
    npc.size = size
    this.npcs.set(id, npc)
    this.myNpcIds.add(id) // 생성한 NPC ID 추가
    // 최초 방향은 임의로 (1,0) 전방
    this.npcDirs.set(id, { x: 1, y: 0 })
    // console.log(`[FOLLOWER] 팔로워 생성: id=${id}, x=${x}, y=${y}`);
  }

  // 모든 팔로워가 타겟에 도달했는지 체크
  private allFollowersAtTarget(
    target: { x: number; y: number } | null,
    threshold: number = 50
  ): boolean {
    const followerIds = Array.from(this.myNpcIds)
    const leader = this.npcs.get(this.leaderId)
    const leaderBody = this.world.bodies.find((b) => b.label === this.leaderId)
    if (!leader || !leaderBody) return false
    const leaderPos = leaderBody.position
    const leaderAngle = leaderBody.angle
    for (let i = 0; i < followerIds.length; i++) {
      const id = followerIds[i]
      const npc = this.npcs.get(id)
      if (!npc) continue
      let tx, ty
      if (target) {
        tx = target.x
        ty = target.y
      } else {
        const formationTarget = getFormationTargetForFollower(
          id,
          i,
          followerIds,
          this.followerRoles.get(id) || '',
          leaderPos,
          leaderAngle,
          this.formationType,
          this.baseDistance,
          this.formationAngle,
          this.formationSpacing,
          this.scatterTargets
        )
        tx = formationTarget.x
        ty = formationTarget.y
      }
      const dx = npc.x - tx
      const dy = npc.y - ty
      if (Math.sqrt(dx * dx + dy * dy) > threshold) return false
    }
    return true
  }

  moveAllFollowers(deltaTime: number) {
    const leader = this.npcs.get(this.leaderId)
    if (!leader) {
      console.log(
        `[FOLLOWER] moveAllFollowers: 리더 NPC(state) 없음: leaderId=${this.leaderId}`
      )
      return
    }

    const leaderBody = this.world.bodies.find((b) => b.label === this.leaderId)
    if (!leaderBody) {
      console.log(
        `[FOLLOWER] moveAllFollowers: 리더 NPC(body) 없음: leaderId=${this.leaderId}`
      )
      return
    }

    const leaderPos = leaderBody.position
    const leaderVelocity = leaderBody.velocity
    const leaderSpeed = Math.sqrt(
      leaderVelocity.x * leaderVelocity.x + leaderVelocity.y * leaderVelocity.y
    )

    // 리더의 이동 방향 계산
    const leaderDirX = leaderSpeed > 0 ? leaderVelocity.x / leaderSpeed : 0
    const leaderDirY = leaderSpeed > 0 ? leaderVelocity.y / leaderSpeed : 0
    const leaderAngle = Math.atan2(leaderDirY, leaderDirX)

    // 자신이 생성한 NPC만 이동
    const followerIds = Array.from(this.myNpcIds)
    // V자형일 때는 좌/우 그룹별로 index를 따로 부여
    let leftIdx = 0,
      rightIdx = 0,
      boxIdx = 0,
      backIdx = 0

    // 박스 대형용 오프셋 미리 계산
    let boxOffsets: { x: number; y: number }[] = []
    if (this.formationType === 'escort') {
      const followerCount = followerIds.length
      const perSide = Math.floor(followerCount / 4)
      const boxCount = perSide * 4
      const boxDistance = this.baseDistance + this.formationSpacing * 0.8
      if (boxCount > 0) {
        boxOffsets = getBoxEscortOffsets(boxCount, boxDistance)
      }
    }

    for (let i = 0; i < followerIds.length; i++) {
      const id = followerIds[i]
      const role = this.followerRoles.get(id)
      const npc = this.npcs.get(id)
      if (!npc) continue
      const followerBody = this.world.bodies.find((b) => b.label === id)
      if (!followerBody) continue
      const followerPos = followerBody.position

      let targetX, targetY, targetDistance
      // 임시 타겟이 활성화되어 있으면 해당 위치로 이동
      if (this.temporaryTargetActive && this.temporaryTarget) {
        // 임시 타겟 활성화 후 5초가 지나면 무조건 formation 복귀
        if (
          this.temporaryTargetActivatedAt &&
          Date.now() - this.temporaryTargetActivatedAt > 5000
        ) {
          this.temporaryTargetActive = false
          this.returningToFormation = true
          this.tempTargetOffsets.clear()
          this.temporaryTargetActivatedAt = null
        }
        // 팔로워별 임시 목표 오프셋이 없으면 생성
        let offset = this.tempTargetOffsets.get(id)
        if (!offset) {
          const angle = Math.random() * 2 * Math.PI
          const r = 100 + Math.random() * 100
          offset = { x: Math.cos(angle) * r, y: Math.sin(angle) * r }
          this.tempTargetOffsets.set(id, offset)
        }
        targetX = this.temporaryTarget.x + offset.x
        targetY = this.temporaryTarget.y + offset.y
        targetDistance = Math.sqrt(
          (targetX - followerPos.x) ** 2 + (targetY - followerPos.y) ** 2
        )
        // 목표점에 도달하면 새로운 오프셋으로 갱신
        if (targetDistance < 10) {
          const angle = Math.random() * 2 * Math.PI
          const r = 100 + Math.random() * 100
          this.tempTargetOffsets.set(id, {
            x: Math.cos(angle) * r,
            y: Math.sin(angle) * r,
          })
        }

        const safeX = clamp(targetX, MARGIN, SCREEN_WIDTH - MARGIN)
        const safeY = clamp(targetY, MARGIN, SCREEN_HEIGHT - MARGIN)
        const dx = safeX - followerPos.x
        const dy = safeY - followerPos.y
        const distanceToTarget = Math.sqrt(dx * dx + dy * dy)
        const speed = leaderSpeed * this.speedMultiplier
        const maxSpeed = Math.min(
          Math.max(speed * 1.5, distanceToTarget * 0.5),
          2
        )
        let force = distanceToTarget * 0.2
        if (distanceToTarget < 3) {
          force = 0
        } else {
          force = Math.min(force, maxSpeed)
        }
        if (distanceToTarget > 5) {
          const angle = Math.atan2(dy, dx)
          Matter.Body.setVelocity(followerBody, {
            x: Math.cos(angle) * force,
            y: Math.sin(angle) * force,
          })
          Matter.Body.setAngle(followerBody, leaderAngle)
        } else {
          Matter.Body.setVelocity(followerBody, { x: 0, y: 0 })
        }
        const defoldPos = matterToDefold(followerBody.position)
        npc.x = defoldPos.x
        npc.y = defoldPos.y
        const dirX = dx / (distanceToTarget || 1)
        const dirY = dy / (distanceToTarget || 1)
        npc.dirx = dirX
        npc.diry = dirY
        this.npcDirs.set(id, { x: dirX, y: dirY })
        continue
      }
      if (this.returningToFormation) {
        if (this.allFollowersAtTarget(null)) {
          this.returningToFormation = false
          // formation 복귀 완료 시점에 위치/속도 보정
          for (let j = 0; j < followerIds.length; j++) {
            const fid = followerIds[j]
            const followerBody2 = this.world.bodies.find((b) => b.label === fid)
            const npc2 = this.npcs.get(fid)
            if (!followerBody2 || !npc2) continue
            const formationTarget = getFormationTargetForFollower(
              fid,
              j,
              followerIds,
              this.followerRoles.get(fid) || '',
              leaderPos,
              leaderAngle,
              this.formationType,
              this.baseDistance,
              this.formationAngle,
              this.formationSpacing,
              this.scatterTargets
            )
            // const matterPos = defoldToMatter(formationTarget)
            // Matter.Body.setPosition(followerBody2, matterPos)
            Matter.Body.setPosition(followerBody2, formationTarget)
            Matter.Body.setVelocity(followerBody2, { x: 0, y: 0 })
            // NPC state를 formation target 위치로 직접 설정
            npc2.x = formationTarget.x
            npc2.y = formationTarget.y
          }
        } else {
          const formationTarget = getFormationTargetForFollower(
            id,
            i,
            followerIds,
            this.followerRoles.get(id) || '',
            leaderPos,
            leaderAngle,
            this.formationType,
            this.baseDistance,
            this.formationAngle,
            this.formationSpacing,
            this.scatterTargets
          )
          // const matterTarget = defoldToMatter(formationTarget)
          targetX = formationTarget.x
          targetY = formationTarget.y
          targetDistance = Math.sqrt(
            (targetX - followerPos.x) * (targetX - followerPos.x) +
              (targetY - followerPos.y) * (targetY - followerPos.y)
          )
          const safeX = clamp(targetX, MARGIN, SCREEN_WIDTH - MARGIN)
          const safeY = clamp(targetY, MARGIN, SCREEN_HEIGHT - MARGIN)
          const dx = safeX - followerPos.x
          const dy = safeY - followerPos.y
          const distanceToTarget = Math.sqrt(dx * dx + dy * dy)
          const speed = leaderSpeed * this.speedMultiplier
          const maxSpeed = Math.min(
            Math.max(speed * 1.5, distanceToTarget * 0.5),
            2
          )
          let force = distanceToTarget * 0.2
          if (distanceToTarget < 3) {
            force = 0
          } else {
            force = Math.min(force, maxSpeed)
          }
          if (distanceToTarget > 5) {
            const angle = Math.atan2(dy, dx)
            const leaderForceX = leaderVelocity.x * this.speedMultiplier
            const leaderForceY = leaderVelocity.y * this.speedMultiplier
            Matter.Body.setVelocity(followerBody, {
              x: Math.cos(angle) * force + leaderForceX,
              y: Math.sin(angle) * force + leaderForceY,
            })
            Matter.Body.setAngle(followerBody, leaderAngle)
          } else {
            Matter.Body.setVelocity(followerBody, { x: 0, y: 0 })
          }
          const defoldPos = matterToDefold(followerBody.position)
          npc.x = defoldPos.x
          npc.y = defoldPos.y
          const dirX = dx / (distanceToTarget || 1)
          const dirY = dy / (distanceToTarget || 1)
          npc.dirx = dirX
          npc.diry = dirY
          this.npcDirs.set(id, { x: dirX, y: dirY })
          continue
        }
      }
      if (role === 'scatter') {
        const offset = this.scatterTargets.get(id)
        if (offset) {
          targetX = leaderPos.x + offset.x
          targetY = leaderPos.y + offset.y
          targetDistance = Math.sqrt(offset.x * offset.x + offset.y * offset.y)
        } else {
          targetX = leaderPos.x
          targetY = leaderPos.y
          targetDistance = 0
        }
      } else if (this.formationType === 'escort') {
        const followerCount = followerIds.length
        const distance = this.baseDistance

        if (followerCount === 1 && role === 'front') {
          targetX = leaderPos.x + Math.cos(leaderAngle) * distance
          targetY = leaderPos.y + Math.sin(leaderAngle) * distance
          targetDistance = distance
        } else if (followerCount === 2) {
          if (role === 'left') {
            targetX =
              leaderPos.x + Math.cos(leaderAngle + Math.PI / 2) * distance
            targetY =
              leaderPos.y + Math.sin(leaderAngle + Math.PI / 2) * distance
          } else if (role === 'right') {
            targetX =
              leaderPos.x + Math.cos(leaderAngle - Math.PI / 2) * distance
            targetY =
              leaderPos.y + Math.sin(leaderAngle - Math.PI / 2) * distance
          }
          targetDistance = distance
        } else if (followerCount === 3) {
          if (role === 'front') {
            targetX = leaderPos.x + Math.cos(leaderAngle) * distance
            targetY = leaderPos.y + Math.sin(leaderAngle) * distance
          } else if (role === 'left') {
            targetX =
              leaderPos.x + Math.cos(leaderAngle + Math.PI / 2) * distance
            targetY =
              leaderPos.y + Math.sin(leaderAngle + Math.PI / 2) * distance
          } else if (role === 'right') {
            targetX =
              leaderPos.x + Math.cos(leaderAngle - Math.PI / 2) * distance
            targetY =
              leaderPos.y + Math.sin(leaderAngle - Math.PI / 2) * distance
          }
          targetDistance = distance
        } else {
          // 4개 이상: 박스 + 뒤
          const perSide = Math.floor(followerCount / 4)
          const boxCount = perSide * 4
          const boxDistance = this.baseDistance + this.formationSpacing * 0.8
          if (role === 'box') {
            const boxIdxNow = boxIdx++
            const off = boxOffsets[boxIdxNow]
            const cosA = Math.cos(leaderAngle)
            const sinA = Math.sin(leaderAngle)
            const rx = off.x * cosA - off.y * sinA
            const ry = off.x * sinA + off.y * cosA
            targetX = leaderPos.x + rx
            targetY = leaderPos.y + ry
            targetDistance = Math.sqrt(rx * rx + ry * ry)
          } else if (role === 'back') {
            const lineIdx = backIdx++
            targetDistance = boxDistance + (lineIdx + 1) * this.formationSpacing
            const targetAngle = leaderAngle + Math.PI
            targetX = leaderPos.x + Math.cos(targetAngle) * targetDistance
            targetY = leaderPos.y + Math.sin(targetAngle) * targetDistance
          }
        }
      } else if (this.formationType === 'v' && role === 'center') {
        // V자 대형이지만 center 팔로워는 항상 일자 대형처럼 리더 뒤로
        targetDistance = this.baseDistance
        const targetAngle = leaderAngle + Math.PI
        targetX = leaderPos.x + Math.cos(targetAngle) * targetDistance
        targetY = leaderPos.y + Math.sin(targetAngle) * targetDistance
      } else if (this.formationType === 'v') {
        // 기존 V자형
        if (role === 'left' || role === 'right') {
          const isLeftSide = role === 'left'
          const formationAngle = isLeftSide
            ? this.formationAngle
            : -this.formationAngle
          let index
          if (isLeftSide) {
            index = leftIdx++
          } else {
            index = rightIdx++
          }
          targetDistance = this.baseDistance + index * this.formationSpacing
          const targetAngle = leaderAngle + Math.PI + formationAngle
          targetX = leaderPos.x + Math.cos(targetAngle) * targetDistance
          targetY = leaderPos.y + Math.sin(targetAngle) * targetDistance
        }
      } else if (role === 'hline') {
        // 리더 기준 좌우로 등간격 배치 (리더 방향 기준)
        const centerIdx = followerIds.length / 2 - 0.5
        const myIdx = i
        const offset = (myIdx - centerIdx) * this.formationSpacing
        const perpX = Math.cos(leaderAngle + Math.PI / 2)
        const perpY = Math.sin(leaderAngle + Math.PI / 2)
        const forwardX = Math.cos(leaderAngle)
        const forwardY = Math.sin(leaderAngle)
        if (
          followerIds.length % 2 === 1 &&
          myIdx === Math.floor(centerIdx + 0.5)
        ) {
          // 홀수면 중앙은 리더 앞
          targetX = leaderPos.x + forwardX * this.baseDistance
          targetY = leaderPos.y + forwardY * this.baseDistance
          targetDistance = this.baseDistance
        } else {
          targetX = leaderPos.x + perpX * offset
          targetY = leaderPos.y + perpY * offset
          targetDistance = Math.abs(offset)
        }
      } else {
        // 일자형: 리더 뒤쪽으로 일렬 정렬
        const idx = i
        targetDistance = this.baseDistance + idx * this.formationSpacing
        const targetAngle = leaderAngle + Math.PI
        targetX = leaderPos.x + Math.cos(targetAngle) * targetDistance
        targetY = leaderPos.y + Math.sin(targetAngle) * targetDistance
      }

      // 벽에 부딪히지 않도록 안전 영역으로 보정
      const safeX = clamp(targetX, MARGIN, SCREEN_WIDTH - MARGIN)
      const safeY = clamp(targetY, MARGIN, SCREEN_HEIGHT - MARGIN)

      // 현재 위치와 목표 위치 사이의 거리 계산
      const dx = safeX - followerPos.x
      const dy = safeY - followerPos.y
      const distanceToTarget = Math.sqrt(dx * dx + dy * dy)

      // 실제 리더와의 거리 계산 (팔로워와 리더의 거리)
      const dxToLeader = leaderPos.x - followerPos.x
      const dyToLeader = leaderPos.y - followerPos.y
      const distToLeader = Math.sqrt(
        dxToLeader * dxToLeader + dyToLeader * dyToLeader
      )
      // 목표 간격
      const desiredDist = targetDistance
      // 간격 오차
      const distError = distToLeader - desiredDist
      const distErrorAbs = Math.abs(distError)

      // 속도 조절 (거리에 따라)
      const speed = leaderSpeed * this.speedMultiplier
      // maxSpeed: 기본값과 오차 기반값 중 작은 값, 그리고 상한선(2) 적용
      const maxSpeed = Math.min(
        Math.max(speed * 1.5, distErrorAbs * 0.5),
        2 // 상한선
      )

      // 힘(속도) 계산: 오차가 작으면 힘도 작게, 아주 작으면 0
      let force = distanceToTarget * 0.2 + distError * 0.1
      if (distErrorAbs < 3 && distanceToTarget < 3) {
        force = 0 // 거의 정지
      } else {
        force = Math.min(force, maxSpeed)
      }

      // 목표 지점으로 이동
      if (distanceToTarget > 5) {
        const angle = Math.atan2(dy, dx)
        const leaderForceX = leaderVelocity.x * this.speedMultiplier
        const leaderForceY = leaderVelocity.y * this.speedMultiplier
        Matter.Body.setVelocity(followerBody, {
          x: Math.cos(angle) * force + leaderForceX,
          y: Math.sin(angle) * force + leaderForceY,
        })
        Matter.Body.setAngle(followerBody, leaderAngle)
      } else {
        // 오차가 아주 작으면 속도 0으로 고정
        Matter.Body.setVelocity(followerBody, { x: 0, y: 0 })
      }

      // 위치 업데이트
      const defoldPos = matterToDefold(followerBody.position)
      npc.x = defoldPos.x
      npc.y = defoldPos.y

      // 방향 업데이트 (WanderManager 방식)
      const dirX = dx / distanceToTarget
      const dirY = dy / distanceToTarget
      npc.dirx = dirX
      npc.diry = dirY
      // 현재 방향 갱신
      this.npcDirs.set(id, { x: dirX, y: dirY })
      // 디버깅: 팔로워 이동 로그
      // console.log(`[FOLLOWER] 팔로워 이동: id=${id}, pos=(${npc.x},${npc.y}), target=(${targetX},${targetY}), dir=(${dirX},${dirY}), leader=(${leaderPos.x},${leaderPos.y})`);
    }
  }

  public getFollowerCount(): number {
    return this.myNpcIds.size
  }

  // NpcFollowerManager.ts에 추가
  public changeLeader(newLeaderId: string) {
    this.leaderId = newLeaderId
    // 모든 팔로워의 owner_id도 업데이트
    this.myNpcIds.forEach((followerId) => {
      const follower = this.npcs.get(followerId)
      if (follower) {
        follower.owner_id = newLeaderId
      }
    })
  }
}
