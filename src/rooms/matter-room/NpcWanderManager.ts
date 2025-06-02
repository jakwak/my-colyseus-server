import Matter from 'matter-js'
import { createNpcBody, SCREEN_WIDTH, SCREEN_HEIGHT } from './physics'
import { Bullet, Npc, Player } from '../schema/MatterRoomState'
import { MapSchema } from '@colyseus/schema'
import { NpcFollowerManager, NpcFormationType } from './NpcFollowerManager'
import { detectObstacles, calculateAvoidanceDirection } from './NpcObstacleUtils'
import { getRandomTargetNear } from './NpcTargetUtils'
import { NpcBaseController } from './NpcBaseController'

const NPC_MOVE_RADIUS = 1500; // 모든 NPC의 이동 반경(1500)
const NPC_SPEED = 50; // 모든 NPC의 이동 속도(50)
const NPC_RETURN_TO_FORMATION_TIME = 10000; // 팔로워가 리더에게 돌아가는 시간(10초)
const NPC_RETURN_TO_FORMATION_DISTANCE = 800; // 팔로워가 리더에게 돌아가는 거리(800)

export class NpcWanderManager extends NpcBaseController {
  private npcTargets: Map<string, { x: number; y: number }> = new Map(); // 각 NPC별 목표 지점
  private npcDirs: Map<string, { x: number; y: number }> = new Map(); // 각 NPC별 현재 방향
  private myNpcIds: Set<string> = new Set(); // 이 매니저가 생성한 NPC ID들
  public followerManagers: NpcFollowerManager[] = [] // 각 그룹별 팔로워 매니저

  private bullets: MapSchema<Bullet>;

  constructor(world: Matter.World, npcs: MapSchema<Npc>, statePlayers: MapSchema<Player>, bullets: MapSchema<Bullet>) {
    super(world, npcs, statePlayers);
    this.bullets = bullets;
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
      const leader_id = `npc_leader_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const x = Math.random() * (SCREEN_WIDTH - 2 * 40) + 40;
      const y = Math.random() * (SCREEN_HEIGHT - 2 * 40) + 40;
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
      this.npcs.set(leader_id, npc);
      this.myNpcIds.add(leader_id); // 생성한 NPC ID 추가
      this.npcDirs.set(leader_id, { x: 1, y: 0 });
      this.npcTargets.set(leader_id, getRandomTargetNear(x, y, NPC_MOVE_RADIUS, { x: 1, y: 0 }));
      if (followerCount && followerSize) {
        const formationTypes: NpcFormationType[] = ["v", "line", "escort", "scatter", "hline"];
        const randomFormation = formationTypes[i % formationTypes.length];
        const followerManager = new NpcFollowerManager(this.world, this.npcs, leader_id, randomFormation, this.statePlayers, this.bullets);
        followerManager.statePlayers = this.statePlayers;
        followerManager.spawnFollowers(followerCount, followerSize);
        this.followerManagers.push(followerManager);
      }
    }
  }
  // 모든 NPC 이동
  public moveAllNpcs(deltaTime: number) {
    for (const id of this.myNpcIds) {
      const npc = this.npcs.get(id);
      if (!npc) continue;
      const npcBody = this.world.bodies.find((b) => b.label === id);
      if (!npcBody) continue;
      let target = this.npcTargets.get(id);
      let dir = this.npcDirs.get(id) || { x: 1, y: 0 };

      // ===== 플레이어 감지: 전방 -45~+45도(부채꼴) 내에 플레이어가 있으면 임시 타겟 지정 =====
      const NPC_PLAYER_DETECT_DISTANCE = 400;
      const NPC_PLAYER_DETECT_ANGLE = Math.PI / 4; // 45도
      let foundPlayer: string | null = null;
      for (const [playerId, player] of this.statePlayers.entries()) {
        if (!player) continue;
        const playerMatterY = typeof player.y === 'number' ? SCREEN_HEIGHT - player.y : 0;
        const dx = player.x - npcBody.position.x;
        const dy = playerMatterY - npcBody.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > NPC_PLAYER_DETECT_DISTANCE) continue;
        const npcAngle = Math.atan2(dir.y, dir.x);
        const toPlayerAngle = Math.atan2(dy, dx);
        let angleDiff = toPlayerAngle - npcAngle;
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
        if (Math.abs(angleDiff) <= NPC_PLAYER_DETECT_ANGLE) {
          foundPlayer = playerId;
          break;
        }
      }
      if (foundPlayer !== null) {
        for (const fm of this.followerManagers) {
          if (fm.leaderId === id && !fm.temporaryTargetActive) {
            fm.temporaryTargetPlayerId = foundPlayer;
            fm.temporaryTargetActive = true;
            fm.temporaryTargetActivatedAt = Date.now();
            fm.returningToFormation = false;
          }
        }
      }
      // ===== 기존 장애물 감지 및 회피 =====
      if (detectObstacles(this.world, npcBody, dir, this.statePlayers)) {
        const newDir = calculateAvoidanceDirection(dir);
        const angleDiff = Math.abs(Math.atan2(newDir.y, newDir.x) - Math.atan2(dir.y, dir.x));
        if (angleDiff < Math.PI / 2) {
          dir = newDir;
          this.npcDirs.set(id, dir);
          // 벽 근처라면 맵 중앙 쪽으로 목표 강제 이동
          const MARGIN = 80;
          if (npcBody.position.x < MARGIN*1.5 || npcBody.position.x > SCREEN_WIDTH - MARGIN*1.5 ||
              npcBody.position.y < MARGIN*1.5 || npcBody.position.y > SCREEN_HEIGHT - MARGIN*1.5) {
            target = { x: SCREEN_WIDTH/2, y: SCREEN_HEIGHT/2 };
            this.npcTargets.set(id, target);
          } else {
            target = getRandomTargetNear(npcBody.position.x, npcBody.position.y, NPC_MOVE_RADIUS, dir);
            this.npcTargets.set(id, target);
          }
        }
      }
      if (!target) {
        target = getRandomTargetNear(npcBody.position.x, npcBody.position.y, NPC_MOVE_RADIUS, dir);
        this.npcTargets.set(id, target);
      }
      const dx = target.x - npcBody.position.x;
      const dy = target.y - npcBody.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 10) {
        const curDir = dist > 0.01 ? { x: dx / dist, y: dy / dist } : dir;
        this.npcDirs.set(id, curDir);
        const newTarget = getRandomTargetNear(npcBody.position.x, npcBody.position.y, NPC_MOVE_RADIUS, curDir);
        this.npcTargets.set(id, newTarget);
        continue;
      }
      this.moveNpcToTarget(id, target, { speed: NPC_SPEED });
      const dx2 = target.x - npcBody.position.x;
      const dy2 = target.y - npcBody.position.y;
      const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      this.npcDirs.set(id, { x: dx2 / (dist2 || 1), y: dy2 / (dist2 || 1) });
    }
    for (const fm of this.followerManagers) {
      let shouldReturn = false;
      if (fm.temporaryTargetActive && fm.temporaryTargetActivatedAt) {
        if (Date.now() - fm.temporaryTargetActivatedAt > NPC_RETURN_TO_FORMATION_TIME) {
          shouldReturn = true;
        }
        if (fm.temporaryTargetPlayerId && this.statePlayers) {
          const player = this.statePlayers.get(fm.temporaryTargetPlayerId);
          const leaderBody = this.world.bodies.find((b) => b.label === fm.leaderId);
          if (player && leaderBody) {
            const dx = player.x - leaderBody.position.x;
            const dy = (SCREEN_HEIGHT - player.y) - leaderBody.position.y;
            if (Math.sqrt(dx * dx + dy * dy) > NPC_RETURN_TO_FORMATION_DISTANCE) {
              shouldReturn = true;
            }
          }
        }
      }
      if (shouldReturn) {
        fm.temporaryTargetActive = false;
        fm.returningToFormation = true;
        fm.tempTargetOffsets.clear();
        fm.temporaryTargetActivatedAt = null;
        fm.temporaryTargetPlayerId = null;
      }
      fm.moveAllFollowers(deltaTime);
    }
  }
}
