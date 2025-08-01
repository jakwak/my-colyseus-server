import { Client, Room } from '@colyseus/core'
import { MyState, User, ButtonPosition } from './MyState'

export class QRoom extends Room {
  maxClients = 20 // 최대 클라이언트 수 설정
  
  onCreate(options: any) {
    this.state = new MyState()
    this.setSeatReservationTime(60) // 60초로 증가

    this.onMessage('correctNumber', (client, number) => {
      this.state.correctNumber =  number
    })

    this.onMessage('numberClicked', (client, number) => {
      const user = this.state.users.get(client.sessionId)
      if (user) {
        user.answerNumber =  number
      }
    })

    this.onMessage('buttonPositions', (client, positions: any) => {
      // 기존 버튼 위치 정보 초기화
      this.state.buttonPositions.clear()
      
      // 새로운 버튼 위치 정보 설정
      Object.entries(positions).forEach(([buttonNumber, position]: [string, any]) => {
        const buttonPos = new ButtonPosition()
        buttonPos.x = position.x
        buttonPos.y = position.y
        buttonPos.size = position.size
        buttonPos.text = position.text || '' // 텍스트 정보 추가
        this.state.buttonPositions.set(buttonNumber, buttonPos)
      })
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
