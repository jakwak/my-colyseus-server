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
      max_restarts: 3,
      restart_delay: 8000,
      kill_timeout: 15000,
      listen_timeout: 20000,
      env: { 
        NODE_ENV: 'development', 
        PORT: 2567,
        MAX_NPCS: '15',
        SPAWN_COOLDOWN: '2000',
        MAX_MEMORY_MB: '150'
      },
      error_file: '/Users/ondalssam/Desktop/my-colyseus-server/logs/colyseus-error.log',
      out_file: '/Users/ondalssam/Desktop/my-colyseus-server/logs/colyseus-out.log',
      log_file: '/Users/ondalssam/Desktop/my-colyseus-server/logs/colyseus-combined.log',
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: false,
      log_type: 'text',
      disable_source_map_support: true,
      node_args: '--max-old-space-size=400'
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