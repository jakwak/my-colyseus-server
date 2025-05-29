import Matter from 'matter-js'
import { matterToDefold } from './physics'
import { Npc } from '../schema/MatterRoomState'
import { MapSchema } from '@colyseus/schema'

const MIN_X = 100;
const MAX_X = 1900;
const MIN_Y = 100;
const MAX_Y = 1900;
const NPC_MOVE_RADIUS = 1500;
const NPC_SPEED = 80;

export class NpcWanderManager {
  private world: Matter.World
  private stateNpcs: MapSchema<Npc>
  private npcTargets: Map<string, { x: number; y: number }> // 각 NPC별 목표 지점
  private npcDirs: Map<string, { x: number; y: number }> // 각 NPC별 현재 방향
  private myNpcIds: Set<string> = new Set() // 이 매니저가 생성한 NPC ID들

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

  // NPC 여러 개 생성
  public spawnNpcs(count: number, size: number) {
    for (let i = 0; i < count; i++) {
      const id = `npc_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const x = Math.random() * (MAX_X - MIN_X) + MIN_X
      const y = Math.random() * (MAX_Y - MIN_Y) + MIN_Y
      const npcBody = Matter.Bodies.circle(x, y, size / 2, {
        label: id,
        isStatic: false,
      })
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
    }
  }

  // NPC별 임의 목표 지점 생성 (전방 -90~+90도 내에서만)
  private getRandomTargetNear(x: number, y: number, distance: number, dir: { x: number, y: number }) {
    let tx, ty;
    while (true) {
      // -90~+90도(전방 반원) 내 임의 각도
      const baseAngle = Math.atan2(dir.y, dir.x);
      const offset = (Math.random() - 0.5) * Math.PI; // -90~+90도
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
  }

  private moveTowardsTarget(npc: Npc, body: Matter.Body, target: Matter.Vector, deltaTime: number) {
    const currentPos = body.position
    const dx = target.x - currentPos.x
    const dy = target.y - currentPos.y
    const distanceToTarget = Math.sqrt(dx * dx + dy * dy)

    // 목표 지점이 너무 가까우면 새로운 목표 지점 설정
    if (distanceToTarget < 1000) {
      const angle = Math.random() * Math.PI * 2
      const distance = 1000 + Math.random() * 500 // 1000~1500 사이의 거리
      target.x = currentPos.x + Math.cos(angle) * distance
      target.y = currentPos.y + Math.sin(angle) * distance
      return
    }

    // 목표 지점으로 이동
    const angle = Math.atan2(dy, dx)
    const force = Math.min(distanceToTarget * 0.1, 10) // 최대 힘 제한

    Matter.Body.setVelocity(body, {
      x: Math.cos(angle) * force,
      y: Math.sin(angle) * force,
    })

    // 위치 업데이트
    const defoldPos = matterToDefold(body.position)
    npc.x = defoldPos.x
    npc.y = defoldPos.y

    // 방향 업데이트
    const dirX = dx / distanceToTarget
    const dirY = dy / distanceToTarget
    npc.dirx = dirX
    npc.diry = dirY
    this.npcDirs.set(npc.id, { x: dirX, y: dirY })
  }
}
