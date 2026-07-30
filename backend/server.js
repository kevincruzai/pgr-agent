import { config } from './src/config.js';
import { getPool } from './src/db.js';
import { seedAll } from './src/seed.js';
import { createApp } from './src/app.js';
import { startSyncScheduler } from './src/services/syncScheduler.js';
import { startAlertScanner } from './src/services/alertScanner.js';

async function start() {
  try {
    await getPool();
    console.log(`🗄️  Conectado a SQL Server (${config.db.database})`);
    await seedAll();
    startSyncScheduler();
    startAlertScanner();
    createApp().listen(config.port, () =>
      console.log(`⚖️  PGR Compras Públicas API → http://localhost:${config.port}`));
  } catch (err) {
    console.error('FATAL: no se pudo iniciar el servidor:', err.message);
    process.exit(1);
  }
}

start();
