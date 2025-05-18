import { Schema, MapSchema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("number") x: number = 100;
  @type("number") y: number = 100;
  @type("string") name: string = ""; // 플레이어 이름 추가
  @type("number") color: number = 1;  // 기본 색상 인덱스
}

export class MyState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}