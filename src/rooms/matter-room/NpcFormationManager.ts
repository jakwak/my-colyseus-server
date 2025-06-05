import Matter from 'matter-js'
import { MapSchema } from '@colyseus/schema'
import { Npc } from '../schema/MatterRoomState'
import { getFormationTargetForFollower } from './NpcFormationUtils'
import { SCREEN_WIDTH, SCREEN_HEIGHT } from './physics'

export type NpcFormationType = 'v' | 'line' | 'escort' | 'scatter' | 'hline'

export class NpcFormationManager {
  constructor(
    private world: Matter.World,
    private npcs: MapSchema<Npc>,
    private myNpcIds: Set<string>,
    private followerRoles: Map<string, 'left' | 'right' | 'center' | 'front' | 'back' | 'box' | 'scatter' | 'hline'>,
    private scatterTargets: Map<string, { x: number; y: number }>,
    private formationType: NpcFormationType,
    private baseDistance: number,
    private formationAngle: number,
    private formationSpacing: number
  ) {}

  public assignRole(id: string, index: number, totalCount: number) {
    if (this.formationType === 'scatter') {
      this.followerRoles.set(id, 'scatter')
      // scatter 타겟 생성
      const angle = Math.random() * 2 * Math.PI
      const r = Math.random() * 100
      this.scatterTargets.set(id, {
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
      })
    } else if (this.formationType === 'hline') {
      this.followerRoles.set(id, 'hline')
    } else if (this.formationType === 'escort') {
      // escort 로직
      if (totalCount === 1) {
        this.followerRoles.set(id, 'front')
      } else if (totalCount === 2) {
        this.followerRoles.set(id, index === 0 ? 'left' : 'right')
      } else if (totalCount === 3) {
        if (index === 0) this.followerRoles.set(id, 'front')
        else if (index === 1) this.followerRoles.set(id, 'left')
        else this.followerRoles.set(id, 'right')
      } else {
        const perSide = Math.floor(totalCount / 4)
        const boxCount = perSide * 4
        if (index < boxCount) {
          this.followerRoles.set(id, 'box')
        } else {
          this.followerRoles.set(id, 'back')
        }
      }
    } else if (this.formationType === 'v') {
      // V자형
      const isOdd = totalCount % 2 === 1
      const centerIdx = Math.floor(totalCount / 2)

      if (isOdd && index === centerIdx) {
        this.followerRoles.set(id, 'center')
      } else {
        let adjustedIndex = index
        if (isOdd && index > centerIdx) {
          adjustedIndex = index - 1
        }
        this.followerRoles.set(id, adjustedIndex % 2 === 0 ? 'left' : 'right')
      }
    } else {
      // 기본 line 형태
      this.followerRoles.set(id, 'back')
    }
  }

  public getTargetPosition(
    id: string,
    i: number,
    role: string | undefined,
    followerIds: string[],
    leaderPos: any,
    leaderAngle: number
  ) {
    // 리더의 위치를 Matter.js 좌표계로 변환
    const leaderX = leaderPos.x
    const leaderY = leaderPos.y

    const target = getFormationTargetForFollower(
      id,
      i,
      followerIds,
      role || '',
      { x: leaderX, y: leaderY },
      leaderAngle,
      this.formationType,
      this.baseDistance,
      this.formationAngle,
      this.formationSpacing,
      this.scatterTargets
    )

    return target
  }

  public getRole(id: string): 'left' | 'right' | 'center' | 'front' | 'back' | 'box' | 'scatter' | 'hline' | undefined {
    return this.followerRoles.get(id)
  }

  public removeRole(id: string) {
    this.followerRoles.delete(id)
    this.scatterTargets.delete(id)
  }

  public getFormationType(): NpcFormationType {
    return this.formationType
  }

  public setFormationType(type: NpcFormationType) {
    this.formationType = type
  }

  public getBaseDistance(): number {
    return this.baseDistance
  }

  public setBaseDistance(distance: number) {
    this.baseDistance = distance
  }

  public getFormationAngle(): number {
    return this.formationAngle
  }

  public setFormationAngle(angle: number) {
    this.formationAngle = angle
  }

  public getFormationSpacing(): number {
    return this.formationSpacing
  }

  public setFormationSpacing(spacing: number) {
    this.formationSpacing = spacing
  }
} 