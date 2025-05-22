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
const WALL_THICKNESS = 10;
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
engine.gravity.y = 0;

// 경계선 생성 (상, 하, 좌, 우 벽)
const walls = [
  // 상단 벽
  Matter.Bodies.rectangle(SCREEN_WIDTH/2, WALL_THICKNESS/2, SCREEN_WIDTH, WALL_THICKNESS, { isStatic: true, label: "wall" }),
  // 하단 벽
  Matter.Bodies.rectangle(SCREEN_WIDTH/2, SCREEN_HEIGHT - WALL_THICKNESS/2, SCREEN_WIDTH, WALL_THICKNESS, { isStatic: true, label: "wall" }),
  // 좌측 벽
  Matter.Bodies.rectangle(WALL_THICKNESS/2, SCREEN_HEIGHT/2, WALL_THICKNESS, SCREEN_HEIGHT, { isStatic: true, label: "wall" }),
  // 우측 벽
  Matter.Bodies.rectangle(SCREEN_WIDTH - WALL_THICKNESS/2, SCREEN_HEIGHT/2, WALL_THICKNESS, SCREEN_HEIGHT, { isStatic: true, label: "wall" }),
  // 중앙 패드 (walls.go의 pad 스프라이트와 동일한 위치/크기)
  Matter.Bodies.rectangle(499, SCREEN_HEIGHT - 171, 960 * 0.2, WALL_THICKNESS, { isStatic: true, label: "pad" })
];
Matter.World.add(world, walls);

// 충돌 이벤트 리스너
Matter.Events.on(engine, 'collisionStart', (event) => {
  event.pairs.forEach((pair) => {
    const bodyA = pair.bodyA;
    const bodyB = pair.bodyB;
    
    // 벽이나 패드와 충돌한 경우
    if (bodyA.label === "wall" || bodyB.label === "wall" || bodyA.label === "pad" || bodyB.label === "pad") {
      const playerBody = (bodyA.label === "wall" || bodyA.label === "pad") ? bodyB : bodyA;
      if (playerBody.label !== "wall" && playerBody.label !== "pad") {
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
  
  // 고정된 속성으로 바디 생성
  const body = Matter.Bodies.circle(
    matterPos.x,
    matterPos.y,
    10,  // 반지름
    { 
      label: id,  // 플레이어 식별자
      restitution: 0.5,  // 반발 계수 (1.0 미만으로 조정)
      friction: 0.8,  // 마찰 계수 
      frictionAir: 0.8,  // 공기 저항
      isControllable: true,  // 제어 가능 상태
      inertia: Infinity,  // 회전 방지
      inverseInertia: 0,  // 회전 방지
      slop: 0  // 미세한 관통 허용치 (0으로 설정하여 정확한 충돌 처리)
    }
  );
  
  // 엔진 옵션 설정 - 정확한 충돌 처리 위해
  engine.positionIterations = 8;  // 위치 반복 계산 횟수 증가
  engine.velocityIterations = 8;  // 속도 반복 계산 횟수 증가
  
  // 처음에는 완전히 정지한 상태로 설정
  Matter.Body.setVelocity(body, { x: 0, y: 0 });
  Matter.Body.setAngularVelocity(body, 0);
  Matter.Body.setStatic(body, true);
  
  // 물체 추가
  Matter.World.add(world, body);
  
  // 정적 상태 해제 전에 한번 더 속도 초기화 (안전을 위해)
  setTimeout(() => {
    if (world.bodies.includes(body)) {
      Matter.Body.setVelocity(body, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(body, 0);
      Matter.Body.setStatic(body, false);
    }
  }, 1000);
  
  return body;
}

// 이동 처리
export function moveBody(body: Matter.Body, direction: { x: number; y: number }) {
  if (body.isControllable) {
    // Defold의 y축 방향을 Matter.js의 y축 방향으로 변환
    Matter.Body.setVelocity(body, { 
      x: direction.x * 5, 
      y: direction.y * 5  // y축 방향 반전 제거
    });
  }
}

// 패드 애니메이션 관련 상태 변수
const padInitialX = 499;
const padY = SCREEN_HEIGHT - 171;
let padDirection = 1; // 1: 오른쪽, -1: 왼쪽
const padSpeed = 100; // 초당 100픽셀
const padMaxDistance = 100; // 중앙에서 각각 100픽셀씩, 총 200픽셀

// 움직이는 패드 업데이트 함수
export function updateMovingPad(delta: number) {
  // 패드 바디 찾기
  const padBody = world.bodies.find(b => b.label === "pad");
  if (!padBody) return;

  // 패드의 현재 위치
  const currentX = padBody.position.x;
  
  // 중앙으로부터의 거리 계산
  const distanceFromCenter = currentX - padInitialX;
  
  // 방향 전환 확인
  if (Math.abs(distanceFromCenter) >= padMaxDistance) {
    padDirection = -padDirection;
  }
  
  // 새 위치 계산
  const newX = currentX + padDirection * padSpeed * (delta / 1000);
  
  // 패드 위치 업데이트
  setBodyPosition(padBody, { x: newX, y: padBody.position.y });
}

// 물리 업데이트
export function updatePhysics(delta: number) {
  const maxDelta = 16.667; // 60fps에 해당하는 시간
  const clampedDelta = Math.min(delta, maxDelta);
  
  // 움직이는 패드 업데이트
  updateMovingPad(clampedDelta);
  
  // 모든 플레이어의 속도 체크
  world.bodies.forEach((body) => {
    if (body.label !== "wall" && body.label !== "pad" && !body.isControllable) {
      const speed = Math.sqrt(body.velocity.x * body.velocity.x + body.velocity.y * body.velocity.y);
      if (speed < 0.1) { // 속도가 충분히 작아지면 다시 제어 가능하도록 설정
        body.isControllable = true;
      }
    }
  });
  
  Matter.Engine.update(engine, clampedDelta);
}

// 좌표 설정 함수
export function setBodyPosition(body: Matter.Body, pos: { x: number; y: number }) {
  // 현재 속도와 회전 속도 저장
  const currentVelocity = { x: body.velocity.x, y: body.velocity.y };
  const currentAngularVelocity = body.angularVelocity;
  
  // 위치 설정
  Matter.Body.setPosition(body, pos);
  
  // 속도 초기화
  Matter.Body.setVelocity(body, { x: 0, y: 0 });
  Matter.Body.setAngularVelocity(body, 0);
  
  // 정적으로 설정하고 다시 해제 (다른 객체에 영향 없이 이동하기 위함)
  const isStatic = body.isStatic;
  Matter.Body.setStatic(body, true);
  
  // 다음 프레임에서 다시 원래 상태로 복원
  setTimeout(() => {
    Matter.Body.setStatic(body, isStatic);
  }, 50);
}