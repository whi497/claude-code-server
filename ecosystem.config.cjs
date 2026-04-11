// PM2 ecosystem config for claude-code-server
// Usage:
//   pm2 start ecosystem.config.cjs
//   pm2 restart claude-code-server
//   pm2 stop claude-code-server
//   pm2 logs claude-code-server
//   pm2 delete claude-code-server

const path = require('path');

module.exports = {
  apps: [
    {
      name: 'claude-code-server',
      cwd: path.join(__dirname, 'server'),
      script: path.join(__dirname, 'start-server.sh'),
      interpreter: '/bin/bash',
      env: {
        PORT: process.env.PORT || 3001,
        NODE_ENV: 'production',
        PROJECT_ROOT: __dirname,
        // Inherit ANTHROPIC_API_KEY from shell env
      },
      // Restart policy
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,       // 2s between restarts
      max_memory_restart: '2G',

      // Logging
      error_file: path.join(__dirname, 'logs', 'error.log'),
      out_file: path.join(__dirname, 'logs', 'out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',

      // Watch (disabled by default — use pm2 restart to apply code changes)
      watch: false,

      // Graceful shutdown
      kill_timeout: 10000,       // 10s to cleanup before SIGKILL
    },
  ],
};
