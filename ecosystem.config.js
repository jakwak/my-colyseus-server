module.exports = {
  apps: [
    {
      name: 'colyseus',
      script: './node_modules/.bin/tsx',
      args: 'src/index.ts',
      interpreter: 'npx',
      interpreter_args: 'tsx',
      cwd: '/Users/ondalssam/Desktop/my-colyseus-server',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '400M',
      min_uptime: '15s',
      max_restarts: 5,
      restart_delay: 8000,
      kill_timeout: 15000,
      listen_timeout: 20000,
      exp_backoff_restart_delay: 100,
      health_check_grace_period: 3000,
      health_check_fatal_exceptions: true,
      max_memory_restart: '300M',
      node_args: '--max-old-space-size=400 --expose-gc',
      env: { 
        NODE_ENV: 'development', 
        PORT: 2567,
        MAX_NPCS: '15',
        SPAWN_COOLDOWN: '2000',
        MAX_MEMORY_MB: '150'
      },
    },
    {
      name: 'svkit-1',
      script: 'npm',
      args: 'run dev',
      cwd: '/Users/ondalssam/Desktop/svkit',
      instances: 1,
      autorestart: true,
      watch: true,
      max_memory_restart: '1G',
      env: { NODE_ENV: 'development', PORT: 5173 }
    },
    {
      name: 'svkit-2',
      script: 'npm',
      args: 'run preview',
      cwd: '/Users/ondalssam/Desktop/svkit',
      instances: 1,
      autorestart: true,
      watch: true,
      max_memory_restart: '1G',
      env: { NODE_ENV: 'development', PORT: 4173 }
    },
    {
      name: 'hello_fastapi',
      script: './start-server.sh',
      cwd: '/Users/ondalssam/Desktop/hello_fastapi',
      instances: 1,
      autorestart: true,
      watch: true,
      max_memory_restart: '1G',
      env: { PYTHONPATH: '/Users/ondalssam/Desktop/hello_fastapi', PORT: 8000 }
    }
  ]
}; 