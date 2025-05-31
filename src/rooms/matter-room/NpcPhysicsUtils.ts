import { SCREEN_WIDTH, SCREEN_HEIGHT } from './physics';

export function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

// 기존 physics.ts에서 가져온다고 가정
export function defoldToMatter(pos: { x: number, y: number }): { x: number, y: number } {
  // y축 반전 등 좌표계 변환 로직
  return { x: pos.x, y: SCREEN_HEIGHT - pos.y };
}

export function matterToDefold(pos: { x: number, y: number }): { x: number, y: number } {
  // y축 반전 등 좌표계 변환 로직
  return { x: pos.x, y: SCREEN_HEIGHT - pos.y };
} 