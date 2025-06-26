module.exports = {
  apps: [
    {
      name: 'colyseus-server-1',
      script: 'npm',
      args: 'start',
      cwd: '/Users/ondalssam/Desktop/my-colyseus-server',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: { NODE_ENV: 'development', PORT: 2567 }
    },
    {
      name: 'svkit-1',
      script: 'npm',
      args: 'run dev',
      cwd: '/Users/ondalssam/Desktop/svkit',
      instances: 1,
      autorestart: true,
      watch: false,
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
      watch: false,
      max_memory_restart: '1G',
      env: { NODE_ENV: 'development', PORT: 4173 }
    },
    {
      name: 'hello_fastapi',
      script: './start-server.sh',
      cwd: '/Users/ondalssam/Desktop/hello_fastapi',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: { PYTHONPATH: '/Users/ondalssam/Desktop/hello_fastapi', PORT: 8000 }
    }
  ]
}; 