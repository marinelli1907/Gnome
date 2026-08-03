// PM2 app definition for the Gnome public website (standalone Next.js server).
// Lives on the VPS at /var/www/gnome-web; deploy.sh rsyncs the bundle here.
module.exports = {
  apps: [
    {
      name: 'gnome-web',
      cwd: '/var/www/gnome-web',
      script: 'server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3007,
        HOSTNAME: '127.0.0.1', // only nginx talks to it
      },
      max_memory_restart: '300M',
      autorestart: true,
    },
  ],
};
