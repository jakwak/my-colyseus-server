import Matter from 'matter-js'
import { matterToDefold } from './physics'
import { Npc } from '../schema/MatterRoomState'
import { MapSchema } from '@colyseus/schema'

const MIN_X = 100;
const MAX_X = 1900;
const MIN_Y = 100;
const MAX_Y = 1900;
const NPC_MOVE_RADIUS = 100;
const NPC_SPEED = 80;

export class NpcWanderManager {
  private world: Matter.World
  private stateNpcs: MapSchema<Npc>
  private npcTargets: Map<string, { x: number; y: number }> // 각 NPC별 목표 지점

  constructor(world: Matter.World, stateNpcs: MapSchema<Npc>) {
    this.world = world
    this.stateNpcs = stateNpcs
    this.npcTargets = new Map()
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
      this.npcTargets.set(id, this.getRandomTargetNear(x, y, NPC_MOVE_RADIUS));
    }
  }

  // NPC별 임의 목표 지점 생성
  private getRandomTargetNear(x: number, y: number, distance: number) {
    let tx, ty;
    while (true) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * distance;
      tx = x + Math.cos(angle) * r;
      ty = y + Math.sin(angle) * r;
      if (tx >= MIN_X && tx <= MAX_X && ty >= MIN_Y && ty <= MAX_Y) break;
    }
    return { x: tx, y: ty };
  }

  // 모든 NPC 이동
  public moveAllNpcs(deltaTime: number) {
    for (const [id, npc] of this.stateNpcs.entries()) {
      const npcBody = this.world.bodies.find((b) => b.label === id);
      if (!npcBody) continue;
      let target = this.npcTargets.get(id);
      if (!target) {
        target = this.getRandomTargetNear(npcBody.position.x, npcBody.position.y, NPC_MOVE_RADIUS);
        this.npcTargets.set(id, target);
      }
      const dx = target.x - npcBody.position.x;
      const dy = target.y - npcBody.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 10) {
        // 목표 도달 시 새 목표
        target = this.getRandomTargetNear(npcBody.position.x, npcBody.position.y, NPC_MOVE_RADIUS);
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
    }
  }
}
