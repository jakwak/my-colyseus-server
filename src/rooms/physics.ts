import Matter from "matter-js";

export const engine = Matter.Engine.create();
export const world = engine.world;

// 중력 설정 (y축 방향)
engine.gravity.y = 0;

// 간단한 플레이어 바디 만들기
export function createPlayer(id: string) {
  const body = Matter.Bodies.circle(Math.random() * 500, Math.random() * 500, 20, {
    label: id,
    restitution: 0.9,
  });
  Matter.World.add(world, body);
  return body;
}

// 바디 이동 입력 처리
export function moveBody(body: Matter.Body, direction: { x: number; y: number }) {
  Matter.Body.setVelocity(body, {
    x: direction.x * 5,
    y: direction.y * 5,
  });
}

// 매 프레임마다 물리 엔진을 업데이트
export function updatePhysics(delta: number) {
  Matter.Engine.update(engine, delta);
}