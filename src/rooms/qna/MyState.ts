import { Schema, type, MapSchema } from '@colyseus/schema'

export class User extends Schema {
  @type('string') id: string = ''
  @type('string') username: string = ''
  @type('number') answerNumber: number = 0

  constructor(data?: { username?: string; id?: string }) {
    super()
    if (data) {
      this.username = data.username || ''
      this.id = data.id || ''
    }
  }
}

export class Question extends Schema {
  @type('string') id: string = ''
  @type('string') question: string = ''
  @type('string') correctAnswer: string = ''
  @type('string') wrongAnswer1: string = ''
  @type('string') wrongAnswer2: string = ''
  @type('string') wrongAnswer3: string = ''
}

export class QuestionSet extends Schema {
  @type('string') id: string = ''
  @type('string') name: string = ''
  @type({ map: Question }) questions = new MapSchema<Question>()
}

export class MyState extends Schema {
  @type('number') correctNumber: number = 0
  @type('boolean') teacherReady: boolean = false
  @type({ map: User }) users = new MapSchema<User>()
  @type({ map: QuestionSet }) questionSets = new MapSchema<QuestionSet>()
  @type(Question) currentQuestion: Question = new Question()
}
