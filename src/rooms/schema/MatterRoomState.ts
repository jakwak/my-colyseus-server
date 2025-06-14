import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";

export class Player extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") dirx: number = 0;
  @type("number") diry: number = 0;  
  @type("string") color: string = ""; // 밝은 톤의 랜덤색상 (겹치지 않게 할당)
  @type("string") username: string = "무명인"; // 기본값
  @type("string") type: string = "model1"; // 비행기 모델
  @type("number") point: number = 0;
  @type("number") hp: number = 100;
}

export class Npc extends Schema {
  @type("string") owner_id: string = "";
  @type("string") id: string = "";  
  @type("string") type: string = "";  // 리더 또는 팔로워
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") size: number = 1;
  @type("string") shape: string = "circle"; // 예: "rectangle", "circle" 등
  @type("number") power: number = 0;
  @type("string") color: string = "#FFFFFF";
  @type("number") dirx: number = 0;
  @type("number") diry: number = 0;
  @type("number") hp: number = 100;
}

export class Bullet extends Schema {
  @type("string") id: string = "";
  @type("string") type: string = ""; // 예: "normal", "fire", "ice" 등
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") dirx: number = 0;
  @type("number") diry: number = 0;
  @type("number") power: number = 0;
  @type("number") velocity: number = 0;
  @type("string") owner_id: string = ""; // 누가 쐈는지
}

export class State extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Npc }) npcs = new MapSchema<Npc>();
  @type({ map: Bullet }) playerBullets = new MapSchema<Bullet>();
  @type({ map: Bullet }) npcBullets = new MapSchema<Bullet>();

} 