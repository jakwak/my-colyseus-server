import { Client, Room } from '@colyseus/core'
import { MyState, User } from './MyState'

export class QRoom extends Room {
  maxClients = 20 // 최대 클라이언트 수 설정
  
  onCreate(options: any) {
    this.state = new MyState()
    this.setSeatReservationTime(60) // 60초로 증가

    this.onMessage('correct_number', (client, number) => {
      this.state.correct_number =  number
      console.log('correct_number--->', this.state.correct_number)
    })

    this.onMessage('number_clicked', (client, number) => {
      const user = this.state.users.get(client.sessionId)
      if (user) {
        user.answer_number =  number
        console.log('number_clicked--->', user.username, user.answer_number)
      }
    })
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
      this.state.all_ready = false
      this.state.correct_number = 0
      console.log('teacher_ready--->', this.state.teacher_ready, this.state.all_ready, this.state.correct_number)
    }
    
    this.state.users.set(
      client.sessionId,
      new User({ username: options.username, id: client.sessionId })
    )
  }

  onLeave(client: Client<any, any>, consented?: boolean): void | Promise<any> {
    const user = this.state.users.get(client.sessionId)
    if (user) {
      if (user.username === '선생님') {
        this.state.teacher_ready = false
        this.state.all_ready = false
        this.state.correct_number = 0
      }
      this.state.users.delete(client.sessionId)
    }
  }
}
