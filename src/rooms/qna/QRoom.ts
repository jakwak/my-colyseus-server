import { Client, Room } from '@colyseus/core'
import { MyState, User } from './MyState'

export class QRoom extends Room {
  maxClients = 20 // 최대 클라이언트 수 설정
  
  onCreate(options: any) {
    this.state = new MyState()
    this.setSeatReservationTime(15)
  }

  onJoin(
    client: Client<any, any>,
    options?: any,
    auth?: any
  ): void | Promise<any> {
    if (!options?.username) {
      client.send('error', { message: 'Username is required' })
      return
    }
    
    client.send('__playground_message_types', {
      message: 'Hello from server',
    })
    
    if (options.username === '선생님') {
      this.state.teacher_ready = true
    }
    
    this.state.users.set(
      client.sessionId,
      new User({ username: options.username, id: client.sessionId })
    )
  }

  onLeave(client: Client<any, any>, consented?: boolean): void | Promise<any> {
    if (this.state.users.get(client.sessionId)) {
      this.state.users.delete(client.sessionId)
    }
  }
}
