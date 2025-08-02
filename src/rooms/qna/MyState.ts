import { Schema, type, MapSchema, ArraySchema } from '@colyseus/schema'

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

export class Answer extends Schema {
  @type('number') x: number = 0
  @type('number') y: number = 0
  @type('number') size: number = 48
  @type('string') text: string = ''
  @type('boolean') isCorrect: boolean = false
}

export class Question extends Schema {
  @type('string') id: string = ''
  @type('string') question: string = ''
  @type({ array: Answer }) answers = new ArraySchema<Answer>()
}

export class QuestionSet extends Schema {
  @type('string') id: string = ''
  @type('string') name: string = ''
  @type({ map: Question }) questions = new MapSchema<Question>()
}

export class MyState extends Schema {
  @type('number') correctNumber: number = 0
  @type('boolean') teacherReady: boolean = false
  @type('boolean') isVerticalAlign: boolean = false
  @type({ map: User }) users = new MapSchema<User>()
  @type({ map: QuestionSet }) questionSets = new MapSchema<QuestionSet>()
  @type(Question) currentQuestion: Question = new Question()
}