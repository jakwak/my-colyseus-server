import config from '@colyseus/tools'
import { monitor } from '@colyseus/monitor'
import { playground } from '@colyseus/playground'

/**
 * Import your Room files
 */
import { MyRoom } from './rooms/MyRoom'
import { MatterRoom } from './rooms/matter-room/MatterRoom'

export default config({
  initializeGameServer: (gameServer) => {
    /**
     * Define your room handlers:
     */
    gameServer.define('my_room', MyRoom)
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
    
    // 개발 환경에서만 상세한 에러 로그
    if (process.env.NODE_ENV !== "production") {
        process.on('uncaughtException', (error) => {
            console.error('Uncaught Exception:', error);
        });
    } else {
        // 프로덕션에서는 에러 로그만 남기고 서버는 계속 실행
        process.on('uncaughtException', (error) => {
            console.error('Critical Error:', error.message);
        });
    }

    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

    // 메모리 사용량 모니터링
    setInterval(() => {
        const memUsage = process.memoryUsage();
        if (memUsage.heapUsed > 100 * 1024 * 1024) { // 100MB 이상 사용 시 경고
          console.log(`메모리 사용량: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
          console.warn('메모리 사용량이 높습니다! 메모리 사용량을 줄이세요!');
        }
    }, 10000);
  },
})
