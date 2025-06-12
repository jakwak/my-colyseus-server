import Matter from 'matter-js'
import { createNpcBody, SCREEN_WIDTH, SCREEN_HEIGHT } from './physics'
import { Bullet, Npc, Player } from '../schema/MatterRoomState'
import { MapSchema } from '@colyseus/schema'
import { NpcFollowerManager, NpcFormationType } from './NpcFollowerManager'
import { detectObstacles, calculateAvoidanceDirection } from './NpcObstacleUtils'
import { getRandomTargetNear } from './NpcTargetUtils'
import { NpcBaseController } from './NpcBaseController'
import { NpcCombatManager } from './NpcCombatManager'
import { MatterRoom } from './MatterRoom'

const NPC_MOVE_RADIUS = 1500; // 모든 NPC의 이동 반경(1500)
const NPC_SPEED = 50; // 모든 NPC의 이동 속도(50)
const NPC_RETURN_TO_FORMATION_TIME = 10000; // 팔로워가 리더에게 돌아가는 시간(10초)
const NPC_RETURN_TO_FORMATION_DISTANCE = 800; // 팔로워가 리더에게 돌아가는 거리(800)

export class NpcWanderManager extends NpcBaseController {
  private npcTargets: Map<string, { x: number; y: number }> = new Map(); // 각 NPC별 목표 지점
  private npcDirs: Map<string, { x: number; y: number }> = new Map(); // 각 NPC별 현재 방향
  private myNpcIds: Set<string> = new Set(); // 이 매니저가 생성한 NPC ID들
  public followerManagers: NpcFollowerManager[] = [] // 각 그룹별 팔로워 매니저
  private statePlayers: MapSchema<Player>;
  private bullets: MapSchema<Bullet>;
  private combatManager?: NpcCombatManager;

  constructor(engine: Matter.Engine, npcs: MapSchema<Npc>, bullets: MapSchema<Bullet>, players: MapSchema<Player>) {
    super(engine, npcs);
    this.bullets = bullets;
    this.combatManager = new NpcCombatManager(engine, npcs, players, bullets);
    this.statePlayers = players;
  }
  // 임의의 NPC ID 반환
  public getRandomNpcId(): string | null {
    const npcIds = Array.from(this.myNpcIds)
    if (npcIds.length === 0) return null
    return npcIds[Math.floor(Math.random() * npcIds.length)]
  }

  // 새 리더 등록 메서드 추가
  public registerNewLeader(newLeaderId: string, oldLeaderId: string) {
    console.log(`[WANDER] 새 리더 등록 요청 받음: ${newLeaderId} (이전: ${oldLeaderId})`)
    
    // 1. 새 리더를 wandering NPC 목록에 추가
    this.myNpcIds.add(newLeaderId)
    
    // 2. 새 리더의 초기 방향과 타겟 설정
    this.npcDirs.set(newLeaderId, { x: 1, y: 0 })
    
    const newLeader = this.npcs.get(newLeaderId)
    if (newLeader) {
      // 현재 위치 근처에서 새로운 타겟 설정
      const target = getRandomTargetNear(newLeader.x, newLeader.y, NPC_MOVE_RADIUS, { x: 1, y: 0 })
      this.npcTargets.set(newLeaderId, target)
      console.log(`[WANDER] 새 리더 ${newLeaderId} wandering 시작, 타겟: (${target.x}, ${target.y})`)
    } else {
      console.log(`[WANDER] 새 리더 ${newLeaderId}를 찾을 수 없음`)
    }
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
      npc.type = 'leader';
      npc.x = x;
      npc.y = y;
      npc.size = size;
      npc.shape = 'circle';
      npc.hp = 100;
      npc.owner_id = 'server';
      npc.power = 10;
      npc.color = '#FFB300'; // 임의 색상
      this.npcs.set(leader_id, npc);
      this.myNpcIds.add(leader_id); // 생성한 NPC ID 추가
      this.npcDirs.set(leader_id, { x: 1, y: 0 });
      this.npcTargets.set(leader_id, getRandomTargetNear(x, y, NPC_MOVE_RADIUS, { x: 1, y: 0 }));
      
      if (followerCount && followerSize) {
        const followerManager = new NpcFollowerManager(
          this.engine,
          this.npcs,
          leader_id,
          'v',
          this.statePlayers,
          this.bullets
        );
        
        // WanderManager 참조 설정
        followerManager.setWanderManager(this);
        
        followerManager.spawnFollowers(followerCount, followerSize);
        followerManager.enableCombat();
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

      const detectedPlayer = this.combatManager?.detectPlayerInMovementDirection(id);
      if (detectedPlayer && detectedPlayer.distance <= 400) {
        for (const fm of this.followerManagers) {
          if (fm.leaderId === id && !fm.temporaryTargetActive) {
            fm.temporaryTargetPlayerId = detectedPlayer.playerId;
            fm.temporaryTargetActive = true;
            fm.temporaryTargetActivatedAt = Date.now();
            fm.returningToFormation = false;
            fm.enableCombat()
          }
        }
      }

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

      if (id.includes('follower')) {
        this.moveNpcToTarget(id, target, { speed: NPC_SPEED*2 });
      } else {
        this.moveNpcToTarget(id, target, { speed: NPC_SPEED });
      }
      
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
        fm.temporaryTargetActivatedAt = null;
        fm.temporaryTargetPlayerId = null;
        fm.disableCombat()
      }
      fm.moveAllFollowers(deltaTime);
    }
  }
}
