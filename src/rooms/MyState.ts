import { Schema, MapSchema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") name: string;
  @type("number") x: number = 200;
  @type("number") y: number = 200;
}

export class MyState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}