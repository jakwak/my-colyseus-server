import { Room, Client } from "@colyseus/core";
import { MyState, Player } from "./MyState";

export class MyRoom extends Room {
  maxClients = 4;
  state = new MyState();

  onCreate(options: any) {
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
