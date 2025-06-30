import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") username: string = "무명인"; // 기본값
  @type("number") score: number = 0;
  @type("boolean") isTeacher: boolean = false; // 교사 여부
  @type("boolean") hasAnswered: boolean = false; // 답변 제출 여부
  @type("number") selectedAnswer: number = 0; // 선택한 답안 (1,2,3,4)
}

export class QuizQuestion extends Schema {
  @type("number") correctAnswer: number = 0; // 정답 번호 (1,2,3,4)
  @type("boolean") isActive: boolean = false; // 문제 활성화 상태
  @type("number") timeLimit: number = 30; // 제한 시간 (초)
  @type("number") startTime: number = 0; // 문제 시작 시간
  @type("string") questionText: string = ""; // 문제 텍스트
  @type("string") option1: string = ""; // 선택지 1
  @type("string") option2: string = ""; // 선택지 2
  @type("string") option3: string = ""; // 선택지 3
  @type("string") option4: string = ""; // 선택지 4
}

export class QuizSession extends Schema {
  @type(QuizQuestion) currentQuestion = new QuizQuestion();
  @type("number") questionNumber: number = 0; // 현재 문제 번호
  @type("boolean") waitingForTeacher: boolean = true; // 교사 답변 대기 중
  @type("boolean") waitingForStudents: boolean = false; // 학생 답변 대기 중
  @type("number") roundStartTime: number = 0; // 라운드 시작 시간
}

export class StudentAnswer extends Schema {
  @type("string") playerId: string = ""; // 플레이어 ID
  @type("string") playerName: string = ""; // 플레이어 이름
  @type("number") selectedAnswer: number = 0; // 선택한 답안
  @type("boolean") isCorrect: boolean = false; // 정답 여부
  @type("number") answerTime: number = 0; // 답변 시간
  @type("number") scoreEarned: number = 0; // 획득한 점수
}

export class State extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type(QuizSession) quizSession = new QuizSession();
  @type({ map: StudentAnswer }) studentAnswers = new MapSchema<StudentAnswer>();
  @type("boolean") gameStarted: boolean = false; // 게임 시작 여부
  @type("number") roundNumber: number = 0; // 현재 라운드 번호
}