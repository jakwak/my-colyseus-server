import Matter from "matter-js";

// Matter.js 타입 확장
declare module "matter-js" {
  interface Body {
    isControllable: boolean;
  }
  interface IBodyDefinition {
    isControllable?: boolean;
  }
}

// 물리 엔진과 월드 생성
export const engine = Matter.Engine.create();
export const world = engine.world;

// 화면 크기 설정
const WALL_THICKNESS = 20;
const SCREEN_WIDTH = 960;
const SCREEN_HEIGHT = 640;

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
engine.gravity.y = 0.5;

// 경계선 생성 (상, 하, 좌, 우 벽)
const walls = [
  // 상단 벽
  Matter.Bodies.rectangle(SCREEN_WIDTH/2, WALL_THICKNESS/2, SCREEN_WIDTH, WALL_THICKNESS, { isStatic: true, label: "wall" }),
  // 하단 벽
  Matter.Bodies.rectangle(SCREEN_WIDTH/2, SCREEN_HEIGHT - WALL_THICKNESS/2, SCREEN_WIDTH, WALL_THICKNESS, { isStatic: true, label: "wall" }),
  // 좌측 벽
  Matter.Bodies.rectangle(WALL_THICKNESS/2, SCREEN_HEIGHT/2, WALL_THICKNESS, SCREEN_HEIGHT, { isStatic: true, label: "wall" }),
  // 우측 벽
  Matter.Bodies.rectangle(SCREEN_WIDTH - WALL_THICKNESS/2, SCREEN_HEIGHT/2, WALL_THICKNESS, SCREEN_HEIGHT, { isStatic: true, label: "wall" })
];
Matter.World.add(world, walls);

// 충돌 이벤트 리스너
Matter.Events.on(engine, 'collisionStart', (event) => {
  event.pairs.forEach((pair) => {
    const bodyA = pair.bodyA;
    const bodyB = pair.bodyB;
    
    // 벽과 충돌한 경우
    if (bodyA.label === "wall" || bodyB.label === "wall") {
      const playerBody = bodyA.label === "wall" ? bodyB : bodyA;
      if (playerBody.label !== "wall") {
        // 충돌한 플레이어의 속도가 임계값 이하일 때까지 제어 불가 상태로 설정
        playerBody.isControllable = false;
      }
    }
  });
});

// 플레이어 생성
export function createPlayer(id: string) {
  const defoldPos = {
    x: Math.random() * (SCREEN_WIDTH - 100) + 50,
    y: Math.random() * (SCREEN_HEIGHT - 100) + 50
  };
  const matterPos = defoldToMatter(defoldPos);
  
  const body = Matter.Bodies.circle(
    matterPos.x,
    matterPos.y,
    20,  // 반지름
    { 
      label: id,  // 플레이어 식별자
      restitution: 1.5,  // 반발 계수 (1.0보다 크면 충돌할 때마다 에너지가 증가)
      friction: 0.05,  // 마찰 계수 (낮을수록 미끄러움)
      frictionAir: 0.05,  // 공기 저항 (낮을수록 더 오래 움직임)
      isControllable: true  // 제어 가능 상태
    }
  );
  Matter.World.add(world, body);
  return body;
}

// 이동 처리
export function moveBody(body: Matter.Body, direction: { x: number; y: number }) {
  if (body.isControllable) {
    // Defold의 y축 방향을 Matter.js의 y축 방향으로 변환
    Matter.Body.setVelocity(body, { 
      x: direction.x * 10, 
      y: direction.y * 10  // y축 방향 반전 제거
    });
  }
}

// 물리 업데이트
export function updatePhysics(delta: number) {
  const maxDelta = 16.667; // 60fps에 해당하는 시간
  const clampedDelta = Math.min(delta, maxDelta);
  
  // 모든 플레이어의 속도 체크
  world.bodies.forEach((body) => {
    if (body.label !== "wall" && !body.isControllable) {
      const speed = Math.sqrt(body.velocity.x * body.velocity.x + body.velocity.y * body.velocity.y);
      if (speed < 0.1) { // 속도가 충분히 작아지면 다시 제어 가능하도록 설정
        body.isControllable = true;
      }
    }
  });
  
  Matter.Engine.update(engine, clampedDelta);
}