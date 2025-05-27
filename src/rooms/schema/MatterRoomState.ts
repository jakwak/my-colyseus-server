import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";

// 물리 바디 정보를 담을 클래스
export class PhysicsBody extends Schema {
  @type("string") id: string = "";
  @type("string") label: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") width: number = 0;
  @type("number") height: number = 0;
  @type("number") radius: number = 0;
  @type("string") shape: string = "rectangle"; // "rectangle" 또는 "circle"
  @type("boolean") isStatic: boolean = false;
}

export class Player extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") color: string = ""; // 밝은 톤의 랜덤색상 (겹치지 않게 할당)
  @type("string") username: string = "무명인"; // 기본값
}

export class Npc extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") owner_id: string = "";
  @type("number") size: number = 1;
  @type("string") shape: string = "circle"; // 예: "rectangle", "circle" 등
  @type("number") power: number = 0;
  @type("string") color: string = "#FFFFFF";
  @type("number") dirx: number = 0;
  @type("number") diry: number = 0;
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
  @type([PhysicsBody]) debugBodies = new ArraySchema<PhysicsBody>();
  @type({ map: Npc }) npcs = new MapSchema<Npc>();
  @type({ map: Bullet }) bullets = new MapSchema<Bullet>();

  // 밝은 톤의 색상 목록 (중복 방지)
  availableColors: string[] = [
    "#FFB300", // Vivid Yellow
    "#FF7043", // Orange
    "#FF8A65", // Light Orange
    "#FFD54F", // Light Yellow
    "#81C784", // Light Green
    "#4FC3F7", // Light Blue
    "#64B5F6", // Blue
    "#BA68C8", // Purple
    "#F06292", // Pink
    "#A1887F", // Brown
    "#90A4AE", // Gray Blue
    "#AED581", // Lime Green
    "#FFFFFF"  // White
  ];

  // 색상 랜덤 할당 (중복 방지)
  getRandomAvailableColor(): string {
    if (this.availableColors.length === 0) {
      return "#FFB300";
    }
    const idx = Math.floor(Math.random() * this.availableColors.length);
    const color = this.availableColors[idx];
    this.availableColors.splice(idx, 1);
    return color;
  }

  // 색상 반환
  returnColorToPool(color: string) {
    if (color && !this.availableColors.includes(color)) {
      this.availableColors.push(color);
    }
  }
} 