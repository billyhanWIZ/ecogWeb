// pm2 설정: pm2 start deploy/ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'ecog',
      script: 'server.js',
      cwd: __dirname + '/..',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '400M',
      out_file: '/var/log/ecog/out.log',
      error_file: '/var/log/ecog/error.log',
      time: true,
    },
  ],
};
