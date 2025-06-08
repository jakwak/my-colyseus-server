import Matter from 'matter-js';
import { MapSchema } from '@colyseus/schema';
import { Npc, Player } from '../schema/MatterRoomState';
import { SCREEN_WIDTH, SCREEN_HEIGHT } from './physics';
import { clamp, matterToDefold } from './NpcPhysicsUtils';
import { MatterRoom } from './MatterRoom';

export class NpcBaseController {
  protected engine: Matter.Engine;
  protected world: Matter.World;
  protected npcs: MapSchema<Npc>;
  protected MARGIN = 40;

  constructor(engine: Matter.Engine, npcs: MapSchema<Npc>) {
    this.engine = engine;
    this.world = engine.world;
    this.npcs = npcs;
  }

  /**
   * NPC를 목표 위치로 이동시키고, 회전도 부드럽게 보간
   * @param npcId NPC의 ID
   * @param target 목표 위치 {x, y}
   * @param options {speed, angle} (angle은 목표 회전 각도, 없으면 이동 방향)
   */
  protected moveNpcToTarget(npcId: string, target: {x: number, y: number}, options: {speed: number, angle?: number}) {
    const npc = this.npcs.get(npcId);
    const body = this.world.bodies.find((b) => b.label === npcId);
    if (!npc || !body) return;
    const safeX = clamp(target.x, this.MARGIN, SCREEN_WIDTH - this.MARGIN);
    const safeY = clamp(target.y, this.MARGIN, SCREEN_HEIGHT - this.MARGIN);
    const dx = safeX - body.position.x;
    const dy = safeY - body.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const speed = options.speed;
    let force = speed;
    if (distance < 3) force = 0;
    if (distance > 5) {
      const moveAngle = Math.atan2(dy, dx);
      Matter.Body.setVelocity(body, {
        x: Math.cos(moveAngle) * force / 60,
        y: Math.sin(moveAngle) * force / 60,
      });
      this.setNpcAngleSmooth(body, options.angle ?? moveAngle);
    } else {
      Matter.Body.setVelocity(body, { x: 0, y: 0 });
    }
    this.syncNpcState(npc, body, dx, dy, distance);
  }

  /**
   * NPC의 각도를 목표 각도로 부드럽게 보간
   */
  protected setNpcAngleSmooth(body: Matter.Body, targetAngle: number, lerpFactor: number = 0.15) {
    const currentAngle = body.angle;
    let angleDiff = targetAngle - currentAngle;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
    const newAngle = currentAngle + angleDiff * lerpFactor;
    Matter.Body.setAngle(body, newAngle);
  }

  /**
   * Matter.js 바디의 위치/방향을 Npc state에 동기화
   */
  protected syncNpcState(npc: Npc, body: Matter.Body, dx: number, dy: number, distance: number) {
    const defoldPos = matterToDefold(body.position);
    npc.x = defoldPos.x;
    npc.y = defoldPos.y;
    npc.dirx = dx / (distance || 1);
    npc.diry = dy / (distance || 1);
  }

  // NPC 제거 메서드
  public removeNpc(npcId: string) {
    // npcId가 npc_로 시작하는지 확인
    if (!npcId.startsWith('npc_')) {
      return;
    }

    // 물리 엔진에서 바디 제거
    const npcBody = this.world.bodies.find((body) => body.label === npcId);
    if (npcBody) {
      // NPC 상태에서 제거
      this.npcs.delete(npcId);
      // 1초 후에 제거
      setTimeout(() => {
        // 바디의 모든 속성 제거
        Matter.Body.setStatic(npcBody, true);
        Matter.Body.setVelocity(npcBody, { x: 0, y: 0 });
        Matter.Body.setAngularVelocity(npcBody, 0);
        Matter.Body.setPosition(npcBody, { x: 0, y: 0 });
        
        // 월드에서 제거
        Matter.World.remove(this.world, npcBody);

      }, 2000);
    }
  }
} 