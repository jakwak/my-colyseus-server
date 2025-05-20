import { Room, Client } from "colyseus";
import { Schema, type, MapSchema } from "@colyseus/schema";
import { createPlayer, moveBody, updatePhysics, world } from "./physics";
import Matter from "matter-js";

class Player extends Schema {
  @type("number") x = 100;
  @type("number") y = 100;
}

class State extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}

export class MatterRoom extends Room<State> {
  playerBodies = new Map<string, Matter.Body>();

  onCreate(options: any) {
    this.state = new State();

    this.onMessage("move", (client, data: { x: number; y: number }) => {
      const body = this.playerBodies.get(client.sessionId);
      if (body) {
        // 이동 벡터 정규화
        const length = Math.sqrt(data.x * data.x + data.y * data.y);
        if (length > 0) {
          data.x = data.x / length;
          data.y = data.y / length;
        }
        moveBody(body, data);
      }
    });

    // Matter.js 주기적 업데이트 (60FPS로 제한)
    this.setSimulationInterval((deltaTime) => {
      updatePhysics(deltaTime);
      // 플레이어 상태 업데이트
      this.playerBodies.forEach((body, id) => {
        const player = this.state.players.get(id);
        if (player) {
          player.x = body.position.x;
          player.y = body.position.y;
        }
      });
    }); // 60FPS로 고정
  }

  onJoin(client: Client) {
    const player = new Player();
    this.state.players.set(client.sessionId, player);

    const body = createPlayer(client.sessionId);
    this.playerBodies.set(client.sessionId, body);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    const body = this.playerBodies.get(client.sessionId);
    if (body) {
      Matter.World.remove(world, body);
    }
    this.playerBodies.delete(client.sessionId);
  }
}
