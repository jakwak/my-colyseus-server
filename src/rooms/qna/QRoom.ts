import { Client, Room } from '@colyseus/core'
import { MyState, User } from './MyState'

export class QRoom extends Room {
  maxClients = 20 // 최대 클라이언트 수 설정
  
  onCreate(options: any) {
    this.state = new MyState()
    this.setSeatReservationTime(60) // 60초로 증가

    this.onMessage('correctNumber', (client, number) => {
      this.state.correctNumber =  number
      console.log('correctNumber--->', this.state.correctNumber)
    })

    this.onMessage('numberClicked', (client, number) => {
      const user = this.state.users.get(client.sessionId)
      if (user) {
        user.answerNumber =  number
        console.log('numberClicked--->', user.username, user.answerNumber)
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
    
    if (options.username === '선생님') {
      this.state.teacherReady = true
      this.state.correctNumber = 0
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
        this.state.teacherReady = false
        this.state.correctNumber = 0
      }
      this.state.users.delete(client.sessionId)
    }
  }
}
