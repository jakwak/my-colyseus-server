import { NpcFormationType } from './NpcFollowerManager';

export function getBoxEscortOffsets(count: number, boxDistance: number) {
  const offsets: { x: number; y: number }[] = [];
  const perSide = Math.floor(count / 4);
  for (let side = 0; side < 4; side++) {
    for (let j = 0; j < perSide; j++) {
      const t = (j + 0.5) / perSide;
      let x = 0, y = 0;
      if (side === 0) { x = -boxDistance + t * 2 * boxDistance; y = -boxDistance; }
      else if (side === 1) { x = boxDistance; y = -boxDistance + t * 2 * boxDistance; }
      else if (side === 2) { x = boxDistance - t * 2 * boxDistance; y = boxDistance; }
      else if (side === 3) { x = -boxDistance; y = boxDistance - t * 2 * boxDistance; }
      offsets.push({ x, y });
    }
  }
  return offsets;
}

export function getFormationTargetForFollower(
  id: string,
  i: number,
  followerIds: string[],
  role: string,
  leaderPos: { x: number, y: number },
  leaderAngle: number,
  formationType: NpcFormationType,
  baseDistance: number,
  formationAngle: number,
  formationSpacing: number,
  scatterTargets: Map<string, { x: number, y: number }>
): { x: number, y: number } {
  let leftIdx = 0, rightIdx = 0, boxIdx = 0, backIdx = 0;
  if (formationType === 'escort') {
    const followerCount = followerIds.length;
    const distance = baseDistance;
    if (followerCount === 1 && role === 'front') {
      return { x: leaderPos.x + Math.cos(leaderAngle) * distance, y: leaderPos.y + Math.sin(leaderAngle) * distance };
    } else if (followerCount === 2) {
      if (role === 'left') {
        return { x: leaderPos.x + Math.cos(leaderAngle + Math.PI / 2) * distance, y: leaderPos.y + Math.sin(leaderAngle + Math.PI / 2) * distance };
      } else if (role === 'right') {
        return { x: leaderPos.x + Math.cos(leaderAngle - Math.PI / 2) * distance, y: leaderPos.y + Math.sin(leaderAngle - Math.PI / 2) * distance };
      }
    } else if (followerCount === 3) {
      if (role === 'front') {
        return { x: leaderPos.x + Math.cos(leaderAngle) * distance, y: leaderPos.y + Math.sin(leaderAngle) * distance };
      } else if (role === 'left') {
        return { x: leaderPos.x + Math.cos(leaderAngle + Math.PI / 2) * distance, y: leaderPos.y + Math.sin(leaderAngle + Math.PI / 2) * distance };
      } else if (role === 'right') {
        return { x: leaderPos.x + Math.cos(leaderAngle - Math.PI / 2) * distance, y: leaderPos.y + Math.sin(leaderAngle - Math.PI / 2) * distance };
      }
    } else {
      // 4개 이상: 박스 + 뒤
      const perSide = Math.floor(followerCount / 4);
      const boxCount = perSide * 4;
      const boxDistance = baseDistance + formationSpacing * 0.8;
      let boxOffsets: { x: number; y: number }[] = [];
      if (boxCount > 0) boxOffsets = getBoxEscortOffsets(boxCount, boxDistance);
      if (role === 'box') {
        const idx = followerIds.indexOf(id);
        const off = boxOffsets[idx];
        const cosA = Math.cos(leaderAngle);
        const sinA = Math.sin(leaderAngle);
        const rx = off.x * cosA - off.y * sinA;
        const ry = off.x * sinA + off.y * cosA;
        return { x: leaderPos.x + rx, y: leaderPos.y + ry };
      } else if (role === 'back') {
        const idx = followerIds.indexOf(id) - boxCount;
        const targetDistance = boxDistance + (idx + 1) * formationSpacing;
        const targetAngle = leaderAngle + Math.PI;
        return { x: leaderPos.x + Math.cos(targetAngle) * targetDistance, y: leaderPos.y + Math.sin(targetAngle) * targetDistance };
      }
    }
  } else if ((formationType === 'v') && role === 'center') {
    const targetDistance = baseDistance;
    const targetAngle = leaderAngle + Math.PI;
    return { x: leaderPos.x + Math.cos(targetAngle) * targetDistance, y: leaderPos.y + Math.sin(targetAngle) * targetDistance };
  } else if (formationType === 'v') {
    if (role === 'left' || role === 'right') {
      const isLeftSide = role === 'left';
      const formationAng = isLeftSide ? formationAngle : -formationAngle;
      
      // 전체 follower 수와 현재 인덱스를 기반으로 side 내 순서 계산
      const isOdd = followerIds.length % 2 === 1;
      const centerIdx = isOdd ? Math.floor(followerIds.length / 2) : -1;
      
      // center를 제외한 실제 인덱스 계산
      let adjustedIndex = i;
      if (isOdd && i > centerIdx) {
        adjustedIndex = i - 1;  // center 이후는 1씩 감소
      }
      
      // 같은 side 내에서의 순서 (0, 1, 2...)
      const sideIndex = Math.floor(adjustedIndex / 2);
      
      const targetDistance = baseDistance + sideIndex * formationSpacing;
      const targetAngle = leaderAngle + Math.PI + formationAng;
      return { x: leaderPos.x + Math.cos(targetAngle) * targetDistance, y: leaderPos.y + Math.sin(targetAngle) * targetDistance };
    }
  } else if (role === 'hline') {
    const centerIdx = followerIds.length / 2 - 0.5;
    const myIdx = followerIds.indexOf(id);
    const offset = (myIdx - centerIdx) * formationSpacing;
    const perpX = Math.cos(leaderAngle + Math.PI / 2);
    const perpY = Math.sin(leaderAngle + Math.PI / 2);
    const forwardX = Math.cos(leaderAngle);
    const forwardY = Math.sin(leaderAngle);
    if (followerIds.length % 2 === 1 && myIdx === Math.floor(centerIdx + 0.5)) {
      return { x: leaderPos.x + forwardX * baseDistance, y: leaderPos.y + forwardY * baseDistance };
    } else if (followerIds.length % 2 === 0 && (myIdx === Math.floor(centerIdx) || myIdx === Math.ceil(centerIdx))) {
      const sideOffset = myIdx === Math.floor(centerIdx) ? -30 : 30;
      return { x: leaderPos.x + perpX * sideOffset, y: leaderPos.y + perpY * sideOffset };
    } else {
      return { x: leaderPos.x + perpX * offset, y: leaderPos.y + perpY * offset };
    }
  } else if (role === 'scatter') {
    const offset = scatterTargets.get(id);
    if (offset) {
      return { x: leaderPos.x + offset.x, y: leaderPos.y + offset.y };
    } else {
      return { x: leaderPos.x, y: leaderPos.y };
    }
  } else {
    // 일자형: 리더 뒤쪽으로 일렬 정렬
    const idx = followerIds.indexOf(id);
    const targetDistance = baseDistance + idx * formationSpacing;
    const targetAngle = leaderAngle + Math.PI;
    return { x: leaderPos.x + Math.cos(targetAngle) * targetDistance, y: leaderPos.y + Math.sin(targetAngle) * targetDistance };
  }
  // fallback
  return { x: leaderPos.x, y: leaderPos.y };
} 