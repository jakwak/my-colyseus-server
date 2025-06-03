import Matter from 'matter-js'
import { Bullet, Npc, Player } from '../schema/MatterRoomState'
import {
  createNpcBody,
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
} from './physics'
import { MapSchema } from '@colyseus/schema'
import { clamp, matterToDefold } from './NpcPhysicsUtils'
import {
  getFormationTargetForFollower,
} from './NpcFormationUtils'
import { NpcBaseController } from './NpcBaseController'
import { NpcCombatManager } from './NpcCombatManager'

const MARGIN = 40

export type NpcFormationType = 'v' | 'line' | 'escort' | 'scatter' | 'hline'

export class NpcFollowerManager extends NpcBaseController {
  public statePlayers: MapSchema<Player> | null = null;
  public leaderId: string
  public myNpcIds: Set<string> = new Set() // 이 매니저가 생성한 NPC ID들
  private npcDirs: Map<string, { x: number; y: number }> = new Map() // 각 NPC별 현재 방향
  public formationType: NpcFormationType
  public followerRoles: Map<
    string,
    'left' | 'right' | 'center' | 'front' | 'back' | 'box' | 'scatter' | 'hline'
  > = new Map()
  public scatterTargets: Map<string, { x: number; y: number }> = new Map()
  public temporaryTargetActive: boolean = false
  public returningToFormation: boolean = false
  public tempTargetOffsets: Map<string, { x: number; y: number }> = new Map()
  public temporaryTargetActivatedAt: number | null = null
  public temporaryTargetPlayerId: string | null = null;
  private followerTurnStates: Map<string, {
    isTurning: boolean;
    turnDirection: number; // 1: 90도, -1: -90도
    originalTargetAngle: number;
  }> = new Map();

  // 전투 시스템 추가
  private combatManager: NpcCombatManager | null = null
  public combatEnabled: boolean = true // 전투 활성화 여부

  // 직접 수정 가능한 속성들
  formationAngle: number = Math.PI / 4 // 45도 각도 (0 ~ π/2)
  baseDistance: number = 50 // 기본 간격 (50 ~ 300)
  speedMultiplier: number = 1 // 리더 대비 속도 비율 (0.1 ~ 2.0)
  formationSpacing: number = 50 // V자형 내 NPC 간 간격 (20 ~ 200)

  // 팔로워별 회피 상태 저장
  private evadeStates: Map<string, { evading: boolean, angle: number, startTime: number }> = new Map();

  constructor(
    world: Matter.World,
    npcs: MapSchema<Npc>,
    leaderId: string,
    formationType: NpcFormationType = 'v',
    statePlayers?: MapSchema<Player>,
    bullets?: MapSchema<Bullet>
  ) {
    super(world, npcs, statePlayers as MapSchema<Player>);
    this.leaderId = leaderId;
    this.formationType = formationType;
    if (statePlayers) this.statePlayers = statePlayers;

    // 전투 매니저 초기화
    if (bullets && statePlayers) {
      this.combatManager = new NpcCombatManager(world, npcs, statePlayers, bullets)
    }
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
      this.assignRole(id, i, count)
    }
  }

  private assignRole(id: string, index: number, totalCount: number) {
    if (this.formationType === 'scatter') {
      this.followerRoles.set(id, 'scatter')
      // scatter 타겟 생성
      const angle = Math.random() * 2 * Math.PI
      const r = Math.random() * 100
      this.scatterTargets.set(id, { 
        x: Math.cos(angle) * r, 
        y: Math.sin(angle) * r 
      })
    } else if (this.formationType === 'hline') {
      this.followerRoles.set(id, 'hline')
    } else if (this.formationType === 'escort') {
      // escort 로직 (기존과 동일)
      if (totalCount === 1) {
        this.followerRoles.set(id, 'front')
      } else if (totalCount === 2) {
        this.followerRoles.set(id, index === 0 ? 'left' : 'right')
      } else if (totalCount === 3) {
        if (index === 0) this.followerRoles.set(id, 'front')
        else if (index === 1) this.followerRoles.set(id, 'left')
        else this.followerRoles.set(id, 'right')
      } else {
        const perSide = Math.floor(totalCount / 4)
        const boxCount = perSide * 4
        if (index < boxCount) {
          this.followerRoles.set(id, 'box')
        } else {
          this.followerRoles.set(id, 'back')
        }
      }
    } else if (this.formationType === 'v') {
      // V자형: getFormationTargetForFollower의 로직과 일치시키기
      const isOdd = totalCount % 2 === 1
      const centerIdx = Math.floor(totalCount / 2)
      
      if (isOdd && index === centerIdx) {
        this.followerRoles.set(id, 'center')
      } else {
        // left/right 교대 할당 (center 제외하고)
        let adjustedIndex = index
        if (isOdd && index > centerIdx) {
          adjustedIndex = index - 1  // center 이후 인덱스들은 1씩 감소
        }
        this.followerRoles.set(id, adjustedIndex % 2 === 0 ? 'left' : 'right')
      }
    } else {
      // 기본 line 형태
      this.followerRoles.set(id, 'back')  // 또는 적절한 기본 역할
    }
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
  private moveFollowerToTarget(followerBody: Matter.Body, npc: Npc, target: {x: number, y: number}, leaderAngle: number, leaderSpeed: number, useFixedSpeed?: boolean, fixedSpeed?: number) {
    const safeX = clamp(target.x, MARGIN, SCREEN_WIDTH - MARGIN);
    const safeY = clamp(target.y, MARGIN, SCREEN_HEIGHT - MARGIN);
    const dx = safeX - followerBody.position.x;
    const dy = safeY - followerBody.position.y;
    const distanceToTarget = Math.sqrt(dx * dx + dy * dy);
    
    // 속도 계산 - 임시 타겟이면 고정 속도, 아니면 리더 속도 기반
    let speed: number;
    if (useFixedSpeed && fixedSpeed !== undefined) {
      speed = fixedSpeed;
    } else {
      speed = leaderSpeed * this.speedMultiplier;
    }
    
    const maxSpeed = Math.min(Math.max(speed * 1.5, distanceToTarget * 0.5), useFixedSpeed ? fixedSpeed || 200 : 2);
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
    // 플레이어 추적: 플레이어의 현재 위치를 직접 타겟으로 설정
    let targetX = 0, targetY = 0;
    if (this.temporaryTargetPlayerId && this.statePlayers) {
      const player = this.statePlayers.get(this.temporaryTargetPlayerId);
      if (player) {
        targetX = player.x;
        targetY = SCREEN_HEIGHT - player.y;
      }
    }

    // 플레이어 위치를 직접 타겟으로 설정 (오프셋 제거)
    const target = {
      x: targetX,
      y: targetY,
    };

    const dx = target.x - followerBody.position.x;
    const dy = target.y - followerBody.position.y;
    const distanceToTarget = Math.sqrt(dx * dx + dy * dy);

    let evadeState = this.evadeStates.get(id);

    if (evadeState && evadeState.evading) {
      // 회피 중: 1.5초(1500ms) 동안은 무조건 직진
      if (Date.now() - evadeState.startTime >= 3000) {
        // 회피 종료, 다음 프레임부터는 타겟 추적 및 재회피 가능
        this.evadeStates.set(id, { evading: false, angle: 0, startTime: 0 });
      } else {
        const moveAngle = evadeState.angle;
        const speed = 2;
        Matter.Body.setVelocity(followerBody, {
          x: Math.cos(moveAngle) * speed,
          y: Math.sin(moveAngle) * speed,
        });
        npc.x = followerBody.position.x;
        npc.y = SCREEN_HEIGHT - followerBody.position.y;
        npc.dirx = Math.cos(moveAngle);
        npc.diry = Math.sin(moveAngle) * 0.5;
        return;
      }
    }

    // 회피 중이 아니면, 플레이어에게 가까워질 때 회피 진입
    if (!evadeState || !evadeState.evading) {
      if (distanceToTarget <= 100) { // 회피 거리를 100으로 증가 (더 일찍 회피)
        // 현재 이동 방향 기준으로 30도(또는 -30도) 회전하여 회피
        const currentMoveAngle = Math.atan2(dy, dx);
        const evadeAngle = currentMoveAngle + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 6); // 30도
        this.evadeStates.set(id, { evading: true, angle: evadeAngle, startTime: Date.now() });
        return;
      }
    }

    // 플레이어를 향해 직진
    this.moveFollowerToTarget(followerBody, npc, target, leaderAngle, leaderSpeed, true, 3); // 고정 속도로 직진
  }

  // formation 복귀 이동 처리
  private moveToFormation(id: string, i: number, role: string | undefined, followerBody: Matter.Body, npc: Npc, followerIds: string[], leaderPos: any, leaderAngle: number, leaderSpeed: number) {
    const target = this.getTargetPosition(id, i, role, followerBody, followerIds, leaderPos, leaderAngle);
    // 대형 복귀 시에는 리더 속도 기반 사용
    const distanceToTarget = this.moveFollowerToTarget(followerBody, npc, target, leaderAngle, leaderSpeed, false);
    if (distanceToTarget <= 5) {
      this.returningToFormation = false;
    }
  }

  // 일반 역할별 이동 처리
  private moveToRoleTarget(id: string, i: number, role: string | undefined, followerBody: Matter.Body, npc: Npc, followerIds: string[], leaderPos: any, leaderAngle: number, leaderSpeed: number) {
    const target = this.getTargetPosition(id, i, role, followerBody, followerIds, leaderPos, leaderAngle);
    // 일반 대형 유지 시에는 리더 속도 기반 사용
    this.moveFollowerToTarget(followerBody, npc, target, leaderAngle, leaderSpeed, false);
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
    

    for (let i = 0; i < followerIds.length; i++) {
      const id = followerIds[i];
      const role = this.followerRoles.get(id);
      const npc = this.npcs.get(id);
      if (!npc) continue;
      const followerBody = this.world.bodies.find((b) => b.label === id);
      if (!followerBody) continue;

      if (this.temporaryTargetActive && this.temporaryTargetPlayerId) {
        this.moveToTemporaryTarget(id, followerBody, npc, leaderAngle, leaderSpeed);
        continue;
      }
      if (this.returningToFormation) {
        this.moveToFormation(id, i, role, followerBody, npc, followerIds, leaderPos, leaderAngle, leaderSpeed);
        continue;
      }
      this.moveToRoleTarget(id, i, role, followerBody, npc, followerIds, leaderPos, leaderAngle, leaderSpeed);
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
