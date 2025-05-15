import { Room, Client } from "@colyseus/core";
import { MyState, Player } from "./MyState";

export class MyRoom extends Room {
  maxClients = 12;
  state = new MyState();

  onCreate(options: any) {
    console.log("MyRoom created!", options);

    this.onMessage("move", (client, data) => {
      console.log("MyRoom received move from", client.sessionId, ":", data);
      const player = this.state.players.get(client.sessionId);
      if (player) {
        player.name = data.name;
        player.x = data.x;
        player.y = data.y;
      }
    });
  }

  onJoin(client: Client, options: any) {
    this.state.players.set(client.sessionId, new Player());
  }

  onLeave(client: Client, consented: boolean) {
    this.state.players.delete(client.sessionId);
  }

  onDispose() {
  }
}
