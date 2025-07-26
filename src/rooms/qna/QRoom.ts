import { Client, Room } from "@colyseus/core";
import { MyState, User } from "./MyState";

export class QRoom extends Room {
  onCreate(options: any) {
    this.state = new MyState();
  }
  
  onJoin(client: Client<any, any>, options?: any, auth?: any): void | Promise<any> {
    console.log('onJoin options--->', options)
    client.send('__playground_message_types', {
      message: 'Hello from server',
    })
    if (options.username === '선생님') {
      this.state.teacher_ready = true
    } else {
      this.state.users.set(client.sessionId, new User({ username: options.username }))
    }
  }

  onLeave(client: Client<any, any>, consented?: boolean): void | Promise<any> {
    console.log('onLeave consented--->', consented)
    if (this.state.users.get(client.sessionId)) {
      this.state.users.delete(client.sessionId)
    }
  }
}