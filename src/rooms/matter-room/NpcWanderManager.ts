import Matter from 'matter-js'
import { matterToDefold, createNpcBody, CATEGORY_NPC, SCREEN_WIDTH, SCREEN_HEIGHT } from './physics'
import { Npc, Player } from '../schema/MatterRoomState'
import { MapSchema } from '@colyseus/schema'
import { NpcFollowerManager, NpcFormationType } from './NpcFollowerManager'
import { detectObstacles, calculateAvoidanceDirection } from './NpcObstacleUtils'
import { getRandomTargetNear } from './NpcTargetUtils'

const NPC_MOVE_RADIUS = 1500;
const NPC_SPEED = 30;

export class NpcWanderManager {
  private world: Matter.World
  private stateNpcs: MapSchema<Npc>
  private statePlayers: MapSchema<Player>
  private npcTargets: Map<string, { x: number; y: number }> // 각 NPC별 목표 지점
  private npcDirs: Map<string, { x: number; y: number }> // 각 NPC별 현재 방향
  private myNpcIds: Set<string> = new Set() // 이 매니저가 생성한 NPC ID들
  public followerManagers: NpcFollowerManager[] = [] // 각 그룹별 팔로워 매니저

  constructor(world: Matter.World, stateNpcs: MapSchema<Npc>, statePlayers: MapSchema<Player>) {
    this.world = world
    this.stateNpcs = stateNpcs
    this.statePlayers = statePlayers
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
      this.stateNpcs.set(leader_id, npc);
      this.myNpcIds.add(leader_id); // 생성한 NPC ID 추가
      // 최초 방향은 임의로 (1,0) 전방
      this.npcDirs.set(leader_id, { x: 1, y: 0 });
      this.npcTargets.set(leader_id, getRandomTargetNear(x, y, NPC_MOVE_RADIUS, { x: 1, y: 0 }));

      if (followerCount && followerSize) {
        const formationTypes: NpcFormationType[] = ["v", "line", "escort", "scatter", "hline"];
        const randomFormation = formationTypes[i % formationTypes.length];
        const followerManager = new NpcFollowerManager(this.world, this.stateNpcs, leader_id, randomFormation);
        followerManager.statePlayers = this.statePlayers;
        followerManager.spawnFollowers(followerCount, followerSize);
        this.followerManagers.push(followerManager);
      }
    }
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

      // ===== 플레이어 감지: 전방 -45~+45도(부채꼴) 내에 플레이어가 있으면 임시 타겟 지정 =====
      const NPC_PLAYER_DETECT_DISTANCE = 200;
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
        // 이 NPC가 리더인 팔로워 매니저에 임시 타겟(플레이어 ID) 지정
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
        // 이전 방향과 새 방향의 차이가 너무 크면 회피하지 않음
        const angleDiff = Math.abs(Math.atan2(newDir.y, newDir.x) - Math.atan2(dir.y, dir.x));
        if (angleDiff < Math.PI / 2) { // 90도 이내의 회전만 허용
          dir = newDir;
          this.npcDirs.set(id, dir);
          // 새로운 회피 방향으로 목표 지점 재설정
          target = getRandomTargetNear(npcBody.position.x, npcBody.position.y, NPC_MOVE_RADIUS, dir);
          this.npcTargets.set(id, target);
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
        // 목표 도달 시 새 목표 (현재 이동 방향 기준 전방 반원)
        const curDir = dist > 0.01 ? { x: dx / dist, y: dy / dist } : dir;
        this.npcDirs.set(id, curDir);
        target = getRandomTargetNear(npcBody.position.x, npcBody.position.y, NPC_MOVE_RADIUS, curDir);
        this.npcTargets.set(id, target);
        continue;
      }

      const dirX = dx / dist;
      const dirY = dy / dist;
      Matter.Body.setVelocity(npcBody, {
        x: (dirX * NPC_SPEED) / 60,
        y: (dirY * NPC_SPEED) / 60,
      });

      // 천천히 회전하도록 보간 적용
      const currentAngle = npcBody.angle;
      const targetAngle = Math.atan2(dirY, dirX);
      let angleDiff = targetAngle - currentAngle;
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      const lerpFactor = 0.1;
      const newAngle = currentAngle + angleDiff * lerpFactor;
      Matter.Body.setAngle(npcBody, newAngle);

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
      // 임시 타겟 활성화 후 10초가 지나거나, 플레이어와의 거리가 300 이상이면 formation 복귀
      let shouldReturn = false;
      if (fm.temporaryTargetActive && fm.temporaryTargetActivatedAt) {
        // 10초 경과
        if (Date.now() - fm.temporaryTargetActivatedAt > 10000) {
          shouldReturn = true;
        }
        // 플레이어와 거리 300 이상
        if (fm.temporaryTargetPlayerId && this.statePlayers) {
          const player = this.statePlayers.get(fm.temporaryTargetPlayerId);
          const leaderBody = this.world.bodies.find((b) => b.label === fm.leaderId);
          if (player && leaderBody) {
            const dx = player.x - leaderBody.position.x;
            const dy = (SCREEN_HEIGHT - player.y) - leaderBody.position.y;
            if (Math.sqrt(dx * dx + dy * dy) > 300) {
              shouldReturn = true;
            }
          } else {
            shouldReturn = true; // 플레이어가 없어진 경우도 복귀
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
