import { Schema, MapSchema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("number") x: number;
  @type("number") y: number;
  @type("string") name: string; // 플레이어 이름 추가
  @type("number") color: number = 1;  // 기본 색상 인덱스

  constructor(name: string, color: number) {
    super();
    this.name = name || "Guest";
    this.color = color || 1;
    
    // 랜덤 위치 생성 (800x600 화면 기준)
    const screenWidth = 800;
    const screenHeight = 600;
    const padding = 50; // 화면 가장자리에서 여유 공간
    
    // 화면 내에서 랜덤한 위치 생성 (가장자리 제외)
    this.x = Math.floor(Math.random() * (screenWidth - 2 * padding)) + padding;
    this.y = Math.floor(Math.random() * (screenHeight - 2 * padding)) + padding;
  }
}

export class MyState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}