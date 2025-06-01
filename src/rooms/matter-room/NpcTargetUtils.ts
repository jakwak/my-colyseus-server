import { SCREEN_WIDTH, SCREEN_HEIGHT } from './physics';

const MARGIN = 40;
const MIN_X = MARGIN;
const MAX_X = SCREEN_WIDTH - MARGIN;
const MIN_Y = MARGIN;
const MAX_Y = SCREEN_HEIGHT - MARGIN;

export function getRandomTargetNear(x: number, y: number, distance: number, dir: { x: number, y: number }) {
  let tx, ty;
  while (true) {
    // -45~+45도(전방 반원) 내 임의 각도
    const baseAngle = Math.atan2(dir.y, dir.x);
    const offset = (Math.random() - 0.5) * Math.PI / 4; // -45~+45도
    const angle = baseAngle + offset;
    const r = Math.random() * distance;
    tx = x + Math.cos(angle) * r;
    ty = y + Math.sin(angle) * r;
    if (tx >= MIN_X && tx <= MAX_X && ty >= MIN_Y && ty <= MAX_Y) break;
  }
  return { x: tx, y: ty };
} 