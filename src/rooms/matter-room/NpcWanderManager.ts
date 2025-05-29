import Matter from 'matter-js'
import { matterToDefold, createNpcBody, CATEGORY_NPC, SCREEN_WIDTH, SCREEN_HEIGHT } from './physics'
import { Npc } from '../schema/MatterRoomState'
import { MapSchema } from '@colyseus/schema'
import { NpcFollowerManager } from './NpcFollowerManager'

const MARGIN = 40;
const MIN_X = MARGIN;
const MAX_X = SCREEN_WIDTH - MARGIN;
const MIN_Y = MARGIN;
const MAX_Y = SCREEN_HEIGHT - MARGIN;
const NPC_MOVE_RADIUS = 1500;
const NPC_SPEED = 50;
const RAYCAST_DISTANCE = 50; // 레이캐스트 거리를 50으로 증가

export class NpcWanderManager {
  private world: Matter.World
  private stateNpcs: MapSchema<Npc>
  private npcTargets: Map<string, { x: number; y: number }> // 각 NPC별 목표 지점
  private npcDirs: Map<string, { x: number; y: number }> // 각 NPC별 현재 방향
  private myNpcIds: Set<string> = new Set() // 이 매니저가 생성한 NPC ID들
  public followerManagers: NpcFollowerManager[] = [] // 각 그룹별 팔로워 매니저

  constructor(world: Matter.World, stateNpcs: MapSchema<Npc>) {
    this.world = world
    this.stateNpcs = stateNpcs
    this.npcTargets = new Map()
    this.npcDirs = new Map()
  }

  // 임의의 NPC ID 반환
  public getRandomNpcId(): string | null {
    const npcIds = Array.from(this.myNpcIds)
    if (npcIds.length === 0) return null
    return npcIds[Math.floor(Math.random() * npcIds.length)]
  }

  // 레이캐스트로 장애물 감지
  private detectObstacles(npcBody: Matter.Body, dir: { x: number, y: number }): boolean {
    const start = npcBody.position;
    const end = {
      x: start.x + dir.x * RAYCAST_DISTANCE,
      y: start.y + dir.y * RAYCAST_DISTANCE
    };

    // 레이캐스트로 충돌 검사 (자기 자신 제외)
    const collisions = Matter.Query.ray(
      this.world.bodies.filter(body => body.id !== npcBody.id), // 자기 자신 제외
      start,
      end,
      1
    );
    return collisions.length > 0;
  }

  // 장애물 회피를 위한 새로운 방향 계산
  private calculateAvoidanceDirection(currentDir: { x: number, y: number }): { x: number, y: number } {
    // 현재 방향에서 -60도 ~ +60도 사이로 랜덤하게 회전
    const angle = Math.atan2(currentDir.y, currentDir.x);
    const randomAngle = (Math.random() * 2 - 1) * (Math.PI / 3); // -60도 ~ +60도
    const newAngle = angle + randomAngle;
    
    return {
      x: Math.cos(newAngle),
      y: Math.sin(newAngle)
    };
  }

  // 여러 그룹을 독립적으로 관리 (각 wander NPC마다 별도의 followerManager)
  public spawnNpcs(count: number, size: number, followerCount?: number, followerSize?: number) {
    for (let i = 0; i < count; i++) {
      const leader_id = `npc_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const x = Math.random() * (MAX_X - MIN_X) + MIN_X
      const y = Math.random() * (MAX_Y - MIN_Y) + MIN_Y
      const npcBody = createNpcBody(this.world, leader_id, x, y, size / 2)
      Matter.World.add(this.world, npcBody);
      const npc = new Npc();
      npc.id = leader_id;
      npc.x = x;
      npc.y = y;
      npc.size = size;
      npc.shape = 'circle';
      npc.owner_id = 'server';
      npc.power = 10;
      npc.color = '#FFB300'; // 임의 색상
      this.stateNpcs.set(leader_id, npc);
      this.myNpcIds.add(leader_id); // 생성한 NPC ID 추가
      // 최초 방향은 임의로 (1,0) 전방
      this.npcDirs.set(leader_id, { x: 1, y: 0 });
      this.npcTargets.set(leader_id, this.getRandomTargetNear(x, y, NPC_MOVE_RADIUS, { x: 1, y: 0 }));

      if (followerCount && followerSize) {
        const formationTypes: ("v" | "line" | "escort")[] = ["v", "line", "escort"];
        const randomFormation = formationTypes[Math.floor(Math.random() * formationTypes.length)];
        const followerManager = new NpcFollowerManager(this.world, this.stateNpcs, leader_id, randomFormation);
        followerManager.spawnFollowers(followerCount, followerSize);
        this.followerManagers.push(followerManager);
      }
    }
  }

  // NPC별 임의 목표 지점 생성 (전방 -90~+90도 내에서만)
  private getRandomTargetNear(x: number, y: number, distance: number, dir: { x: number, y: number }) {
    let tx, ty;
    while (true) {
      // -90~+90도(전방 반원) 내 임의 각도
      const baseAngle = Math.atan2(dir.y, dir.x);
      const offset = (Math.random() - 0.5) * Math.PI / 2; // -45~+45도
      const angle = baseAngle + offset;
      const r = Math.random() * distance;
      tx = x + Math.cos(angle) * r;
      ty = y + Math.sin(angle) * r;
      if (tx >= MIN_X && tx <= MAX_X && ty >= MIN_Y && ty <= MAX_Y) break;
    }
    return { x: tx, y: ty };
  }

  // 모든 NPC 이동
  public moveAllNpcs(deltaTime: number) {
    // 자신이 생성한 NPC만 이동
    for (const id of this.myNpcIds) {
      const npc = this.stateNpcs.get(id);
      if (!npc) continue;

      const npcBody = this.world.bodies.find((b) => b.label === id);
      if (!npcBody) continue;

      let target = this.npcTargets.get(id);
      let dir = this.npcDirs.get(id) || { x: 1, y: 0 };

      // 장애물 감지 및 회피 (연속 회피 방지)
      if (this.detectObstacles(npcBody, dir)) {
        const newDir = this.calculateAvoidanceDirection(dir);
        // 이전 방향과 새 방향의 차이가 너무 크면 회피하지 않음
        const angleDiff = Math.abs(Math.atan2(newDir.y, newDir.x) - Math.atan2(dir.y, dir.x));
        if (angleDiff < Math.PI / 2) { // 90도 이내의 회전만 허용
          dir = newDir;
          this.npcDirs.set(id, dir);
          // 새로운 회피 방향으로 목표 지점 재설정
          target = this.getRandomTargetNear(npcBody.position.x, npcBody.position.y, NPC_MOVE_RADIUS, dir);
          this.npcTargets.set(id, target);
        }
      }

      if (!target) {
        target = this.getRandomTargetNear(npcBody.position.x, npcBody.position.y, NPC_MOVE_RADIUS, dir);
        this.npcTargets.set(id, target);
      }

      const dx = target.x - npcBody.position.x;
      const dy = target.y - npcBody.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < 10) {
        // 목표 도달 시 새 목표 (현재 이동 방향 기준 전방 반원)
        const curDir = dist > 0.01 ? { x: dx / dist, y: dy / dist } : dir;
        this.npcDirs.set(id, curDir);
        target = this.getRandomTargetNear(npcBody.position.x, npcBody.position.y, NPC_MOVE_RADIUS, curDir);
        this.npcTargets.set(id, target);
        continue;
      }

      const dirX = dx / dist;
      const dirY = dy / dist;
      Matter.Body.setVelocity(npcBody, {
        x: (dirX * NPC_SPEED) / 60,
        y: (dirY * NPC_SPEED) / 60,
      });

      // State 동기화
      const defoldPos = matterToDefold(npcBody.position);
      npc.x = defoldPos.x;
      npc.y = defoldPos.y;
      npc.dirx = dirX;
      npc.diry = dirY;
      
      // 현재 방향 갱신
      this.npcDirs.set(id, { x: dirX, y: dirY });
    }

    // 각 그룹별 팔로워 이동
    for (const fm of this.followerManagers) {
      fm.moveAllFollowers(deltaTime);
    }
  }
}
