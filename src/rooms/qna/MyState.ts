import { Schema, type, MapSchema } from "@colyseus/schema";

export class User extends Schema {
  @type("string") username: string = '';
  @type("number") answer_number: number = 0;
}

export class MyState extends Schema {
  @type("number") correct_number: number = 0;
  @type("boolean") all_ready: boolean = false;
  @type("boolean") teacher_ready: boolean = false;
  @type({ map: User }) users = new MapSchema<User>();
}