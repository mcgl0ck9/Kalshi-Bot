/**
 * PM2 Ecosystem Configuration
 *
 * Manages the Kalshi Edge Detector as a background daemon.
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 stop kalshi-bot
 *   pm2 restart kalshi-bot
 *   pm2 logs kalshi-bot
 *   pm2 monit
 *
 * For auto-start on system boot:
 *   pm2 startup
 *   pm2 save
 */

module.exports = {
  apps: [
    {
      // Main Bot Process
      name: 'kalshi-bot',
      script: 'dist/index.js',
      args: 'bot',
      cwd: __dirname,

      // Node.js settings
      interpreter: 'node',
      node_args: '--experimental-specifier-resolution=node',

      // Environment
      env: {
        NODE_ENV: 'production',
      },
      env_file: '.env',

      // Restart behavior
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,

      // Memory management
      max_memory_restart: '512M',

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      merge_logs: true,
      log_type: 'json',

      // Process management
      instances: 1,
      exec_mode: 'fork',

      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
    },

    // Scanner Process (scheduled scans)
    {
      name: 'kalshi-scanner',
      script: 'dist/index.js',
      args: '',  // Default: scheduled mode
      cwd: __dirname,

      // Node.js settings
      interpreter: 'node',
      node_args: '--experimental-specifier-resolution=node',

      // Environment
      env: {
        NODE_ENV: 'production',
      },
      env_file: '.env',

      // Restart behavior - scanner runs continuously with internal scheduling
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,

      // Memory management
      max_memory_restart: '256M',

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/pm2-scanner-error.log',
      out_file: 'logs/pm2-scanner-out.log',
      merge_logs: true,

      // Process management
      instances: 1,
      exec_mode: 'fork',

      // Graceful shutdown
      kill_timeout: 5000,
    },

    // Real-Time Monitor (Polymarket WebSocket)
    {
      name: 'kalshi-realtime',
      script: 'dist/realtime-monitor.js',
      cwd: __dirname,

      // Node.js settings
      interpreter: 'node',
      node_args: '--experimental-specifier-resolution=node',

      // Environment
      env: {
        NODE_ENV: 'production',
      },
      env_file: '.env',

      // Restart behavior
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,

      // Memory management
      max_memory_restart: '256M',

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/pm2-realtime-error.log',
      out_file: 'logs/pm2-realtime-out.log',
      merge_logs: true,

      // Process management
      instances: 1,
      exec_mode: 'fork',

      // Graceful shutdown
      kill_timeout: 5000,
    },
  ],

  // Deployment configuration (optional)
  deploy: {
    production: {
      user: 'deploy',
      host: 'your-server.com',
      ref: 'origin/main',
      repo: 'git@github.com:yourusername/kalshi-bot.git',
      path: '/home/deploy/kalshi-bot',
      'post-deploy':
        'npm install && npm run build && pm2 reload ecosystem.config.js --env production',
    },
  },
};
