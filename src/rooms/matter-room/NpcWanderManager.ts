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

  // 여러 그룹을 독립적으로 관리 (각 wander NPC마다 별도의 followerManager)
  public spawnNpcs(count: number, size: number, followerCount?: number, followerSize?: number) {
    for (let i = 0; i < count; i++) {
      const id = `npc_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const x = Math.random() * (MAX_X - MIN_X) + MIN_X
      const y = Math.random() * (MAX_Y - MIN_Y) + MIN_Y
      const npcBody = createNpcBody(this.world, id, x, y, size / 2)
      Matter.World.add(this.world, npcBody);
      const npc = new Npc();
      npc.id = id;
      npc.x = x;
      npc.y = y;
      npc.size = size;
      npc.shape = 'circle';
      npc.owner_id = 'server';
      npc.power = 10;
      npc.color = '#FFB300'; // 임의 색상
      this.stateNpcs.set(id, npc);
      this.myNpcIds.add(id); // 생성한 NPC ID 추가
      // 최초 방향은 임의로 (1,0) 전방
      this.npcDirs.set(id, { x: 1, y: 0 });
      this.npcTargets.set(id, this.getRandomTargetNear(x, y, NPC_MOVE_RADIUS, { x: 1, y: 0 }));
      // console.log(`[WANDER] NPC 생성: id=${id}, x=${x}, y=${y}`);
      // 각 wander NPC마다 별도의 followerManager 생성
      if (followerCount && followerSize) {
        const followerManager = new NpcFollowerManager(this.world, this.stateNpcs, id);
        followerManager.spawnFollowers(followerCount, followerSize);
        this.followerManagers.push(followerManager);
        // console.log(`[WANDER] FollowerManager 생성: leaderId=${id}, followerCount=${followerCount}`);
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
        // console.log(`[WANDER] NPC 목표 갱신: id=${id}, newTarget=(${target.x},${target.y})`);
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
      // 디버깅: NPC 이동 로그
      //console.log(`[WANDER] NPC 이동: id=${id}, pos=(${npc.x},${npc.y}), target=(${target.x},${target.y}), dir=(${dirX},${dirY})`);
    }
    // 각 그룹별 팔로워 이동
    for (const fm of this.followerManagers) {
      // 디버깅: 팔로워 매니저별 리더 ID 및 팔로워 수
      // console.log(`[WANDER] FollowerManager move: leaderId=${fm.leaderId}, followerCount=${fm.getFollowerCount ? fm.getFollowerCount() : 'N/A'}`);
      fm.moveAllFollowers(deltaTime, "escort");
    }
  }
}
