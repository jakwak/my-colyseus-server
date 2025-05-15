import { Room, Client } from "@colyseus/core";
import { MyState, Player } from "./MyState";

export class MyRoom extends Room {
  maxClients = 4;
  state = new MyState();

  onCreate(options: any) {
    console.log("MyRoom created!", options);

    this.onMessage("message_type", (client, data) => {
        console.log("MyRoom received message from", client.sessionId, ":", data);
        // this.state.movePlayer(client.sessionId, data);
        this.broadcast("message_type", `(${client.sessionId}) ${data}`);
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
