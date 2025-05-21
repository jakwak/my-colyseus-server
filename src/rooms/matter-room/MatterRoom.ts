import { Room, Client } from "colyseus";
import { Schema, type, MapSchema } from "@colyseus/schema";
import { engine, world, createPlayer, moveBody, updatePhysics } from "./physics";
import Matter from "matter-js";

class Player extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("boolean") isControllable: boolean = true;
}

class State extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}

export class MatterRoom extends Room<State> {
  onCreate() {
    this.state = new State();
    
    this.onMessage("move", (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (player) {
        const body = world.bodies.find(b => b.label === client.sessionId);
        if (body) {
          moveBody(body, data);
          player.x = body.position.x;
          player.y = body.position.y;
          player.isControllable = body.isControllable;
        }
      }
    });

    // Matter.js 주기적 업데이트 (60FPS로 제한)
    this.setSimulationInterval((deltaTime) => {
      updatePhysics(deltaTime);
      // 플레이어 상태 업데이트
      world.bodies.forEach((body) => {
        const player = this.state.players.get(body.label);
        if (player) {
          player.x = body.position.x;
          player.y = body.position.y;
          player.isControllable = body.isControllable;
        }
      });
    }, 1000 / 60); // 60FPS로 고정
  }

  onJoin(client: Client) {
    const body = createPlayer(client.sessionId);
    const player = new Player();
    player.x = body.position.x;
    player.y = body.position.y;
    player.isControllable = body.isControllable;
    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client) {
    const body = world.bodies.find(b => b.label === client.sessionId);
    if (body) {
      Matter.World.remove(world, body);
    }
    this.state.players.delete(client.sessionId);
  }
}
