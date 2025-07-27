import { Schema, type, MapSchema } from "@colyseus/schema";

export class User extends Schema {
  @type("string") id: string = '';
  @type("string") username: string = '';
  @type("number") answer_number: number = 0;

  constructor(data?: { username?: string; id?: string }) {
    super();
    if (data) {
      this.username = data.username || '';
      this.id = data.id || '';
    }
  }
}

export class MyState extends Schema {
  @type("number") correct_number: number = 0;
  @type("boolean") all_ready: boolean = false;
  @type("boolean") teacher_ready: boolean = false;
  @type({ map: User }) users = new MapSchema<User>();
}