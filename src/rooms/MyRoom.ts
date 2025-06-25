import { Room, Client } from "@colyseus/core";
import { MyState, Player } from "./schema/MyState";

export class MyRoom extends Room {
  maxClients = 12;
  state = new MyState();
  availableColors = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];  // 12개의 색상 인덱스로 확장

  onCreate(options: any) {
    // console.log("MyRoom created!===>", options);
    this.onMessage("move", (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (player) {
        player.x = data.x;
        player.y = data.y;
      }
    });

    this.onMessage("change_color", (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (player && typeof data.color_index === "number") {
        player.color = data.color_index;
      }
    });
  }

  // 사용 가능한 색상 중 랜덤하게 선택
  getRandomAvailableColor(): number {
    if (this.availableColors.length === 0) {
      // 모든 색상이 사용 중이면 첫 번째 색상 재사용
      return 1;
    }
    
    const randomIndex = Math.floor(Math.random() * this.availableColors.length);
    const color = this.availableColors[randomIndex];
    
    // 선택된 색상을 사용 가능 목록에서 제거
    this.availableColors.splice(randomIndex, 1);
    
    return color;
  }

  // 색상을 사용 가능 목록에 반환
  returnColorToPool(color: number) {
    if (!this.availableColors.includes(color)) {
      this.availableColors.push(color);
    }
  }

  onJoin(client: Client, options: any) {
    // console.log("onJoin!===>", options);
    const player = new Player(options.name, this.getRandomAvailableColor());        

    this.state.players.set(client.sessionId, player);
    console.log(`Player ${player.name} joined: ${client.sessionId} with color ${player.color}`);
  }

  onLeave(client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      // 플레이어가 사용하던 색상을 다시 사용 가능하게 만듦
      this.returnColorToPool(player.color);
    }
    this.state.players.delete(client.sessionId as any);
    console.log(`Player ${player.name} left:`, client.sessionId);
  }

  onDispose() {
    console.log("Room disposed");
  }
}
