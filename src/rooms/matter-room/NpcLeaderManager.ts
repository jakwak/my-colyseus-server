import Matter from 'matter-js'
import { Npc } from '../schema/MatterRoomState'
import { MapSchema } from '@colyseus/schema'
import { SCREEN_WIDTH, SCREEN_HEIGHT } from './physics'

export class NpcLeaderManager {
  private leaderElectionInProgress: boolean = false
  private leaderElectionStartTime: number = 0
  private readonly LEADER_ELECTION_DELAY: number

  constructor(
    private world: Matter.World,
    private npcs: MapSchema<Npc>,
    private myNpcIds: Set<string>,
    private leaderId: string,
    electionDelay: number = 100
  ) {
    this.LEADER_ELECTION_DELAY = electionDelay
  }

  public handleLeaderlessState(deltaTime: number) {
    if (!this.leaderElectionInProgress) {
      // 리더 선출 시작
      console.log(`[FOLLOWER] 리더 ${this.leaderId} 사라짐, 새 리더 선출 시작`)
      this.leaderElectionInProgress = true
      this.leaderElectionStartTime = Date.now()
      return
    }

    // 지연 시간이 지나면 새 리더 선출
    if (Date.now() - this.leaderElectionStartTime >= this.LEADER_ELECTION_DELAY) {
      this.electNewLeader()
    } else {
      // 대기 중에는 팔로워들 제자리에서 대기
      this.makeFollowersWaitInPlace()
    }
  }

  private electNewLeader() {
    if (this.myNpcIds.size === 0) {
      console.log(`[FOLLOWER] 팔로워가 없어 그룹 해체`)
      return
    }

    // 가장 앞에 있는 팔로워를 새 리더로 선출
    const followerIds = Array.from(this.myNpcIds)
    const newLeaderId = this.selectBestLeaderCandidate(followerIds)
    
    if (!newLeaderId) {
      console.log(`[FOLLOWER] 적합한 리더 후보를 찾을 수 없음`)
      return
    }

    // 새 리더로 승격
    const newLeader = this.npcs.get(newLeaderId)
    if (newLeader) {
      console.log(`[FOLLOWER] 새 리더 선출: ${newLeaderId} (이전: ${this.leaderId})`)
      
      // 타입을 follower에서 leader로 변경
      newLeader.type = 'leader'
      newLeader.color = '#FFB300' // 리더 색상으로 변경
      
      // 새 리더 ID 설정
      const oldLeaderId = this.leaderId
      this.leaderId = newLeaderId
      
      // myNpcIds에서 새 리더 제거 (이제 리더이므로)
      this.myNpcIds.delete(newLeaderId)
      
      // 리더 선출 완료
      this.leaderElectionInProgress = false
      
      console.log(`[FOLLOWER] 리더십 승계 완료: ${oldLeaderId} -> ${newLeaderId}`)
    }
  }

  private selectBestLeaderCandidate(followerIds: string[]): string | null {
    if (followerIds.length === 0) return null

    // 전략 1: 중앙에 가장 가까운 팔로워 선택
    const centerX = SCREEN_WIDTH / 2
    const centerY = SCREEN_HEIGHT / 2
    
    let bestCandidate = followerIds[0]
    let bestDistance = Infinity

    for (const followerId of followerIds) {
      const follower = this.npcs.get(followerId)
      const followerBody = this.world.bodies.find(b => b.label === followerId)
      
      if (follower && followerBody) {
        const distance = Math.sqrt(
          Math.pow(followerBody.position.x - centerX, 2) + 
          Math.pow(followerBody.position.y - centerY, 2)
        )
        
        if (distance < bestDistance) {
          bestDistance = distance
          bestCandidate = followerId
        }
      }
    }

    return bestCandidate
  }

  private makeFollowersWaitInPlace() {
    for (const followerId of this.myNpcIds) {
      const followerBody = this.world.bodies.find(b => b.label === followerId)
      if (followerBody) {
        // 속도를 0으로 설정하여 제자리에서 대기
        Matter.Body.setVelocity(followerBody, { x: 0, y: 0 })
        Matter.Body.setAngularVelocity(followerBody, 0)
      }
    }
  }

  public isLeaderElectionInProgress(): boolean {
    return this.leaderElectionInProgress
  }

  public getLeaderId(): string {
    return this.leaderId
  }

  public setLeaderId(newLeaderId: string) {
    this.leaderId = newLeaderId
  }
} 