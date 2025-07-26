import config from '@colyseus/tools'
import { monitor } from '@colyseus/monitor'
import { playground } from '@colyseus/playground'

/**
 * Import your Room files
 */
import { MyRoom } from './rooms/MyRoom'
import { MatterRoom } from './rooms/matter-room/MatterRoom'
import { QRoom } from './rooms/qna/QRoom'

export default config({
  options: {
    devMode: true,
  },
  initializeGameServer: (gameServer) => {
    /**
     * Define your room handlers:
     */
    gameServer.define('my_room', MyRoom)
    gameServer.define('q_room', QRoom)

    // matter_room 정의
    gameServer.define('matter_room', MatterRoom)
  },

  initializeExpress: (app) => {
    app.use(
      require('cors')({
        origin: process.env.ALLOWED_ORIGINS?.split(',') || [
          'http://localhost:3000',
          'http://localhost:4173',
          'http://localhost:5173',
        ],
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type'],
        credentials: true,
      })
    )

    /**
     * Bind your custom express routes here:
     * Read more: https://expressjs.com/en/starter/basic-routing.html
     */
    app.get('/hello_world', (req, res) => {
      res.send("It's time to kick ass and chew bubblegum!")
    })

    /**
     * Use @colyseus/playground
     * (It is not recommended to expose this route in a production environment)
     */
    if (process.env.NODE_ENV !== 'production') {
      app.use('/', playground())
    }

    /**
     * Use @colyseus/monitor
     * It is recommended to protect this route with a password
     * Read more: https://docs.colyseus.io/tools/monitor/#restrict-access-to-the-panel-using-a-password
     */
    app.use('/monitor', monitor())
  },

  beforeListen: () => {
    /**
     * Before before gameServer.listen() is called.
     */

    console.log('[APP_CONFIG] 서버 시작...')

    // 개발 환경에서만 상세한 에러 로그
    if (process.env.NODE_ENV !== 'production') {
      process.on('uncaughtException', (error) => {
        console.error('Uncaught Exception:', error)
      })
    } else {
      // 프로덕션에서는 에러 로그만 남기고 서버는 계속 실행
      process.on('uncaughtException', (error) => {
        console.error('Critical Error:', error.message)
      })
    }

    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason)
    })

    // 메모리 사용량 모니터링 강화
    setInterval(() => {
      const memUsage = process.memoryUsage()
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024)
      const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024)
      const externalMB = Math.round(memUsage.external / 1024 / 1024)

      if (heapUsedMB > 100) {
        console.warn(
          `메모리 사용량: ${heapUsedMB}MB / ${heapTotalMB}MB (외부: ${externalMB}MB)`
        )

        // 가비지 컬렉션 강제 실행 (Node.js가 --expose-gc 플래그로 실행된 경우)
        if (global.gc) {
          global.gc()
          console.log('가비지 컬렉션 강제 실행 완료')
        }
      }

      if (heapUsedMB > 200) {
        console.error(`메모리 사용량이 200MB를 초과했습니다: ${heapUsedMB}MB`)
        console.error('서버를 재시작합니다...')
        process.exit(1) // 서버 재시작
      }

      // 메모리 누수 감지 (외부 메모리가 지속적으로 증가하는 경우)
      if (externalMB > 50) {
        console.warn(`외부 메모리 사용량이 높습니다: ${externalMB}MB`)
      }
    }, 5000) // 5초마다 체크
  },
})
