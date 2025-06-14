import Matter from "matter-js";

// Matter.js 타입 확장 (isControllable 제거)
declare module "matter-js" {
  interface Body {
    // isControllable 속성 제거
  }
  interface IBodyDefinition {
    // isControllable 속성 제거
  }
}

// 카테고리 비트마스크 정의
export const CATEGORY_PLAYER = 0x0001;
export const CATEGORY_WALL   = 0x0002;
export const CATEGORY_BULLET = 0x0004;
export const CATEGORY_NPC    = 0x0008;

// 화면 크기 설정
export const WALL_THICKNESS = 20;
export const SCREEN_WIDTH = 2000;
export const SCREEN_HEIGHT = 2000;

export function createEngineAndWorld() {
  const engine = Matter.Engine.create();
  engine.gravity.y = 0;
  return { engine, world: engine.world };
}

export function addWalls(world: Matter.World) {
  const walls = [
    createWallBody(SCREEN_WIDTH/2, WALL_THICKNESS/2, SCREEN_WIDTH, WALL_THICKNESS, "wall_1"),
    createWallBody(SCREEN_WIDTH/2, SCREEN_HEIGHT - WALL_THICKNESS/2, SCREEN_WIDTH, WALL_THICKNESS, "wall_2"),
    createWallBody(WALL_THICKNESS/2, SCREEN_HEIGHT/2, WALL_THICKNESS, SCREEN_HEIGHT, "wall_3"),
    createWallBody(SCREEN_WIDTH - WALL_THICKNESS/2, SCREEN_HEIGHT/2, WALL_THICKNESS, SCREEN_HEIGHT, "wall_4"),
    // Matter.Bodies.rectangle(499, SCREEN_HEIGHT - 171, 960 * 0.2, WALL_THICKNESS, { isStatic: true, label: "pad" })
  ];
  Matter.World.add(world, walls);
}

export function createNpcBody(world: Matter.World, id: string, x: number, y: number, size: number) {
  const matterPos = defoldToMatter({ x, y });
  const body = Matter.Bodies.circle(matterPos.x, matterPos.y, size, {
    label: id,
    isStatic: false,
    restitution: 1.5,
    friction: 0.01,
    frictionAir: 0.01,
    collisionFilter: {
      category: CATEGORY_NPC,
      mask: CATEGORY_WALL | CATEGORY_BULLET // NPC는 플레이어, 벽, 총알과만 충돌
    }
  });
  Matter.World.add(world, body);
  return body;
}

export function createPlayerBody(world: Matter.World, id: string) {
  // 플레이어 수에 따라 시작 위치 결정
  const playerCount = world.bodies.filter(body => body.label.startsWith('player_')).length;
  
  // 4의 배수 간격으로 위치 계산
  const position = playerCount % 4;
  let defoldPos;
  
  switch(position) {
    case 0: // 아래쪽
      defoldPos = {
        x: SCREEN_WIDTH / 2,
        y: SCREEN_HEIGHT * 0.1
      };
      break;
    case 1: // 위쪽
      defoldPos = {
        x: SCREEN_WIDTH / 2,
        y: SCREEN_HEIGHT * 0.9
      };
      break;
    case 2: // 왼쪽
      defoldPos = {
        x: SCREEN_WIDTH * 0.1,
        y: SCREEN_HEIGHT / 2
      };
      break;
    case 3: // 오른쪽
      defoldPos = {
        x: SCREEN_WIDTH * 0.9,
        y: SCREEN_HEIGHT / 2
      };
      break;
  }
  
  const matterPos = defoldToMatter(defoldPos);
  
  const body = Matter.Bodies.circle(
    matterPos.x,
    matterPos.y,
    10,  // 반지름
    { 
      label: "player_" + id,  // 플레이어 식별자
      restitution: 0.9,  // 반발 계수 (1.0 미만으로 조정)
      friction: 0.1,  // 마찰 계수 
      frictionAir: 0.1,  // 공기 저항
      inertia: Infinity,  // 회전 방지
      inverseInertia: 0,  // 회전 방지
      slop: 0,  // 미세한 관통 허용치 (0으로 설정하여 정확한 충돌 처리)
      collisionFilter: {
        category: CATEGORY_PLAYER,
        mask: CATEGORY_WALL | CATEGORY_BULLET | CATEGORY_NPC // 플레이어는 벽, 총알, NPC와만 충돌
      }
    }
  );
  
  Matter.Body.setVelocity(body, { x: 0, y: 0 });
  Matter.Body.setAngularVelocity(body, 0);
  Matter.World.add(world, body);
  return body;
}

export function createBulletBody(x: number, y: number, radius: number, label: string) {
  return Matter.Bodies.circle(x, y, radius, {
    label,
    isSensor: true,
    frictionAir: 0,
    collisionFilter: {
      category: CATEGORY_BULLET,
      mask: CATEGORY_PLAYER | CATEGORY_WALL | CATEGORY_NPC // 총알은 플레이어, 벽, NPC와만 충돌
    }
  });
}

export function createWallBody(x: number, y: number, width: number, height: number, label: string) {
  return Matter.Bodies.rectangle(x, y, width, height, {
    isStatic: true,
    label,
    collisionFilter: {
      category: CATEGORY_WALL,
      mask: CATEGORY_PLAYER | CATEGORY_BULLET | CATEGORY_NPC // 벽은 플레이어, 총알, NPC와만 충돌
    }
  });
}

// 좌표 변환 함수
export function defoldToMatter(pos: { x: number; y: number }) {
  return {
    x: pos.x,
    y: SCREEN_HEIGHT - pos.y  // y축 반전
  };
}

export function matterToDefold(pos: { x: number; y: number }) {
  return {
    x: pos.x,
    y: SCREEN_HEIGHT - pos.y  // y축 반전
  };
}

// 중력 설정 (y축 방향)
// engine.gravity.y = 0;

// 이동 처리
export function moveBody(body: Matter.Body, direction: { x: number; y: number }) {
  Matter.Body.setVelocity(body, { 
    x: direction.x * 10, 
    y: direction.y * 10 * -1
  });
}

// 좌표 설정 함수
export function setBodyPosition(body: Matter.Body, pos: { x: number; y: number }) {
  Matter.Body.setPosition(body, pos);
  Matter.Body.setVelocity(body, { x: 0, y: 0 });
  Matter.Body.setAngularVelocity(body, 0);
}