import Matter from "matter-js";

export const engine = Matter.Engine.create();
export const world = engine.world;

// 화면 크기 설정
const WALL_THICKNESS = 20;
const SCREEN_WIDTH = 960;
const SCREEN_HEIGHT = 640;

// 중력 설정 (y축 방향)
engine.gravity.y = 0;

// 경계선 생성
const walls = [
  Matter.Bodies.rectangle(SCREEN_WIDTH/2, -WALL_THICKNESS/2, SCREEN_WIDTH, WALL_THICKNESS, { isStatic: true }),
  Matter.Bodies.rectangle(SCREEN_WIDTH/2, SCREEN_HEIGHT + WALL_THICKNESS/2, SCREEN_WIDTH, WALL_THICKNESS, { isStatic: true }),
  Matter.Bodies.rectangle(-WALL_THICKNESS/2, SCREEN_HEIGHT/2, WALL_THICKNESS, SCREEN_HEIGHT, { isStatic: true }),
  Matter.Bodies.rectangle(SCREEN_WIDTH + WALL_THICKNESS/2, SCREEN_HEIGHT/2, WALL_THICKNESS, SCREEN_HEIGHT, { isStatic: true })
];
Matter.World.add(world, walls);

// 플레이어 생성
export function createPlayer(id: string) {
  const body = Matter.Bodies.circle(
    Math.random() * (SCREEN_WIDTH - 100) + 50,
    Math.random() * (SCREEN_HEIGHT - 100) + 50,
    20,
    { label: id, restitution: 0.9, friction: 0.1, frictionAir: 0.1 }
  );
  Matter.World.add(world, body);
  return body;
}

// 이동 처리
export function moveBody(body: Matter.Body, direction: { x: number; y: number }) {
  Matter.Body.setVelocity(body, { x: direction.x * 10, y: direction.y * 10 });
}

// 물리 업데이트
export function updatePhysics(delta: number) {
  Matter.Engine.update(engine, delta);
}