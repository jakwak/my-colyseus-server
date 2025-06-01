import Matter from 'matter-js';
import { SCREEN_HEIGHT } from './physics';
import { MapSchema } from '@colyseus/schema';
import { Player } from '../schema/MatterRoomState';

export function detectObstacles(world: Matter.World, npcBody: Matter.Body, dir: { x: number, y: number }, statePlayers: MapSchema<Player>): boolean {
  const start = npcBody.position;
  const NUM_RAYS = 5;
  const ANGLE_RANGE = Math.PI / 6; // 30도
  const OBSTACLE_DISTANCE = 100;
  let found = false;
  const baseAngle = Math.atan2(dir.y, dir.x);
  // 장애물 감지
  for (let i = 0; i < NUM_RAYS; i++) {
    const t = i / (NUM_RAYS - 1);
    const angleOffset = (t - 0.5) * 2 * ANGLE_RANGE;
    const rayAngle = baseAngle + angleOffset;
    const end = {
      x: start.x + Math.cos(rayAngle) * OBSTACLE_DISTANCE,
      y: start.y + Math.sin(rayAngle) * OBSTACLE_DISTANCE
    };
    const collisions = Matter.Query.ray(
      world.bodies.filter(body => 
        body.id !== npcBody.id && !body.label.startsWith('npc_') // npc_로 시작하는 바디도 장애물에서 제외
      ),
      start,
      end,
      10
    );
    if (collisions.length > 0) found = true;
  }
  // 플레이어 감지 (이 부분은 필요시 분리)
  // ... (플레이어 감지 로직은 NpcWanderManager에서 직접 처리하는 것이 더 명확할 수 있음) ...
  return found;
}

export function calculateAvoidanceDirection(currentDir: { x: number, y: number }): { x: number, y: number } {
  // 현재 방향에서 -60도 ~ +60도 사이로 랜덤하게 회전
  const angle = Math.atan2(currentDir.y, currentDir.x);
  const randomAngle = (Math.random() * 2 - 1) * (Math.PI / 6); // -30도 ~ +30도
  const newAngle = angle + randomAngle;
  return {
    x: Math.cos(newAngle),
    y: Math.sin(newAngle)
  };
} 