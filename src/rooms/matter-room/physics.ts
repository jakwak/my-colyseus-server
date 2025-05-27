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
    Matter.Bodies.rectangle(SCREEN_WIDTH/2, WALL_THICKNESS/2, SCREEN_WIDTH, WALL_THICKNESS, { isStatic: true, label: "wall_1" }),
    Matter.Bodies.rectangle(SCREEN_WIDTH/2, SCREEN_HEIGHT - WALL_THICKNESS/2, SCREEN_WIDTH, WALL_THICKNESS, { isStatic: true, label: "wall_2" }),
    Matter.Bodies.rectangle(WALL_THICKNESS/2, SCREEN_HEIGHT/2, WALL_THICKNESS, SCREEN_HEIGHT, { isStatic: true, label: "wall_3" }),
    Matter.Bodies.rectangle(SCREEN_WIDTH - WALL_THICKNESS/2, SCREEN_HEIGHT/2, WALL_THICKNESS, SCREEN_HEIGHT, { isStatic: true, label: "wall_4" }),
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
  });
  Matter.World.add(world, body);
  return body;
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

// 플레이어 생성 (위치 파라미터 추가)
export function createPlayer(world: Matter.World, id: string, startPos?: { x: number; y: number }) {
  // 디폴트 위치: 화면 가운데 위쪽
  const defoldPos = startPos || {
    x: SCREEN_WIDTH / 2,  // 화면 가운데 (480)
    y: SCREEN_HEIGHT * 0.75  // 화면 위쪽 (160)
  };
  const matterPos = defoldToMatter(defoldPos);
  
  const body = Matter.Bodies.circle(
    matterPos.x,
    matterPos.y,
    10,  // 반지름
    { 
      label: id,  // 플레이어 식별자
      restitution: 0.9,  // 반발 계수 (1.0 미만으로 조정)
      friction: 0.1,  // 마찰 계수 
      frictionAir: 0.1,  // 공기 저항
      inertia: Infinity,  // 회전 방지
      inverseInertia: 0,  // 회전 방지
      slop: 0  // 미세한 관통 허용치 (0으로 설정하여 정확한 충돌 처리)
    }
  );
  
  Matter.Body.setVelocity(body, { x: 0, y: 0 });
  Matter.Body.setAngularVelocity(body, 0);
  Matter.World.add(world, body);
  return body;
}

// 이동 처리
export function moveBody(body: Matter.Body, direction: { x: number; y: number }) {
  Matter.Body.setVelocity(body, { 
    x: direction.x * 10, 
    y: direction.y * 10 * -1
  });
}

// 패드 애니메이션 관련 상태 변수 (Room에서 관리 권장)
// ... 필요시 Room에서 직접 구현 ...

// 물리 업데이트
export function updatePhysics(engine: Matter.Engine, delta: number) {
  Matter.Engine.update(engine, delta);
}

// 좌표 설정 함수
export function setBodyPosition(body: Matter.Body, pos: { x: number; y: number }) {
  Matter.Body.setPosition(body, pos);
  Matter.Body.setVelocity(body, { x: 0, y: 0 });
  Matter.Body.setAngularVelocity(body, 0);
}