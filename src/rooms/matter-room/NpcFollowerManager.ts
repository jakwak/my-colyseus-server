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
      // 정확한 좌우 대칭을 위해 left/right 인덱스와 역할을 미리 배열로 준비
      const roles: ('left' | 'right' | 'center')[] = [];
      const isOdd = count % 2 === 1;
      const mid = Math.floor(count / 2);
      for (let i = 0; i < count; i++) {
        if (isOdd && i === mid) {
          roles.push('center');
        } else if (i < mid) {
          roles.push('left');
        } else {
          roles.push('right');
        }
      }
      let leftIdx = 0, rightIdx = 0;
      for (let i = 0; i < count; i++) {
        const id = `${this.leaderId}_follower_${i}`;
        this.createFollower(leaderBody.position.x, leaderBody.position.y, size, id);
        this.followerRoles.set(id, roles[i]);
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

  // 역할별 타겟 위치 계산 함수
  private getTargetPosition(id: string, i: number, role: string | undefined, followerBody: Matter.Body, followerIds: string[], leaderPos: any, leaderAngle: number) {
    return getFormationTargetForFollower(
      id,
      i,
      followerIds,
      role || '',
      leaderPos,
      leaderAngle,
      this.formationType,
      this.baseDistance,
      this.formationAngle,
      this.formationSpacing,
      this.scatterTargets
    );
  }

  // 이동 처리(공통): force/velocity/angle 보간
  private moveFollowerToTarget(followerBody: Matter.Body, npc: Npc, target: {x: number, y: number}, leaderAngle: number, leaderSpeed: number) {
    const safeX = clamp(target.x, MARGIN, SCREEN_WIDTH - MARGIN);
    const safeY = clamp(target.y, MARGIN, SCREEN_HEIGHT - MARGIN);
    const dx = safeX - followerBody.position.x;
    const dy = safeY - followerBody.position.y;
    const distanceToTarget = Math.sqrt(dx * dx + dy * dy);
    const speed = leaderSpeed * this.speedMultiplier;
    const maxSpeed = Math.min(Math.max(speed * 1.5, distanceToTarget * 0.5), 2);
    let force = distanceToTarget * 0.2;
    if (distanceToTarget < 3) {
      force = 0;
    } else {
      force = Math.min(force, maxSpeed);
    }
    if (distanceToTarget > 5) {
      const angle = Math.atan2(dy, dx);
      // 부드러운 회전 적용
      const currentAngle = followerBody.angle;
      let targetAngle = leaderAngle;
      let angleDiff = targetAngle - currentAngle;
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      const lerpFactor = 0.15;
      const newAngle = currentAngle + angleDiff * lerpFactor;
      Matter.Body.setVelocity(followerBody, {
        x: Math.cos(angle) * force,
        y: Math.sin(angle) * force,
      });
      Matter.Body.setAngle(followerBody, newAngle);
    } else {
      Matter.Body.setVelocity(followerBody, { x: 0, y: 0 });
    }
    const defoldPos = matterToDefold(followerBody.position);
    npc.x = defoldPos.x;
    npc.y = defoldPos.y;
    const dirX = dx / (distanceToTarget || 1);
    const dirY = dy / (distanceToTarget || 1);
    npc.dirx = dirX;
    npc.diry = dirY;
    this.npcDirs.set(npc.id, { x: dirX, y: dirY });
    return distanceToTarget;
  }

  // 임시 타겟 이동 처리
  private moveToTemporaryTarget(id: string, followerBody: Matter.Body, npc: Npc, leaderAngle: number, leaderSpeed: number) {
    // 팔로워별 임시 목표 오프셋이 없으면 생성
    let offset = this.tempTargetOffsets.get(id);
    if (!offset) {
      const angle = Math.random() * 2 * Math.PI;
      const r = 100 + Math.random() * 100;
      offset = { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
      this.tempTargetOffsets.set(id, offset);
    }
    const target = {
      x: (this.temporaryTarget?.x || 0) + offset.x,
      y: (this.temporaryTarget?.y || 0) + offset.y,
    };
    const distanceToTarget = this.moveFollowerToTarget(followerBody, npc, target, leaderAngle, leaderSpeed);
    // 목표점에 도달하면 새로운 오프셋으로 갱신
    if (distanceToTarget < 10) {
      const angle = Math.random() * 2 * Math.PI;
      const r = 100 + Math.random() * 100;
      this.tempTargetOffsets.set(id, { x: Math.cos(angle) * r, y: Math.sin(angle) * r });
    }
  }

  // formation 복귀 이동 처리
  private moveToFormation(id: string, i: number, role: string | undefined, followerBody: Matter.Body, npc: Npc, followerIds: string[], leaderPos: any, leaderAngle: number, leaderSpeed: number) {
    const target = this.getTargetPosition(id, i, role, followerBody, followerIds, leaderPos, leaderAngle);
    const distanceToTarget = this.moveFollowerToTarget(followerBody, npc, target, leaderAngle, leaderSpeed);
    if (distanceToTarget <= 5) {
      this.returningToFormation = false;
    }
  }

  // 일반 역할별 이동 처리
  private moveToRoleTarget(id: string, i: number, role: string | undefined, followerBody: Matter.Body, npc: Npc, followerIds: string[], leaderPos: any, leaderAngle: number, leaderSpeed: number) {
    const target = this.getTargetPosition(id, i, role, followerBody, followerIds, leaderPos, leaderAngle);
    this.moveFollowerToTarget(followerBody, npc, target, leaderAngle, leaderSpeed);
  }

  moveAllFollowers(deltaTime: number) {
    const leader = this.npcs.get(this.leaderId);
    if (!leader) {
      console.log(`[FOLLOWER] moveAllFollowers: 리더 NPC(state) 없음: leaderId=${this.leaderId}`);
      return;
    }
    const leaderBody = this.world.bodies.find((b) => b.label === this.leaderId);
    if (!leaderBody) {
      console.log(`[FOLLOWER] moveAllFollowers: 리더 NPC(body) 없음: leaderId=${this.leaderId}`);
      return;
    }
    const leaderPos = leaderBody.position;
    const leaderVelocity = leaderBody.velocity;
    const leaderSpeed = Math.sqrt(leaderVelocity.x * leaderVelocity.x + leaderVelocity.y * leaderVelocity.y);
    const leaderAngle = Math.atan2(leaderVelocity.y, leaderVelocity.x);
    const followerIds = Array.from(this.myNpcIds);

    // V자 대형 좌우 인덱스 계산을 위한 역할 배열 준비
    let vRoles: ('left' | 'right' | 'center')[] = [];
    if (this.formationType === 'v') {
      const count = followerIds.length;
      const isOdd = count % 2 === 1;
      const mid = Math.floor(count / 2);
      for (let i = 0; i < count; i++) {
        if (isOdd && i === mid) vRoles.push('center');
        else if (i < mid) vRoles.push('left');
        else vRoles.push('right');
      }
    }
    let leftIdx = 0, rightIdx = 0;

    for (let i = 0; i < followerIds.length; i++) {
      const id = followerIds[i];
      const role = this.followerRoles.get(id);
      const npc = this.npcs.get(id);
      if (!npc) continue;
      const followerBody = this.world.bodies.find((b) => b.label === id);
      if (!followerBody) continue;

      // V자 대형이면 left/right 인덱스를 별도로 계산해서 넘긴다
      let vIndex = i;
      if (this.formationType === 'v') {
        if (role === 'left') {
          vIndex = leftIdx++;
        } else if (role === 'right') {
          vIndex = rightIdx++;
        } else {
          vIndex = 0; // center
        }
      }
      if (this.temporaryTargetActive && this.temporaryTarget) {
        this.moveToTemporaryTarget(id, followerBody, npc, leaderAngle, leaderSpeed);
        continue;
      }
      if (this.returningToFormation) {
        this.moveToFormation(id, vIndex, role, followerBody, npc, followerIds, leaderPos, leaderAngle, leaderSpeed);
        continue;
      }
      this.moveToRoleTarget(id, vIndex, role, followerBody, npc, followerIds, leaderPos, leaderAngle, leaderSpeed);
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
