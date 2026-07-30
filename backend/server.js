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

    const app = createApp();

    // Backend / API en su puerto dedicado.
    app.listen(config.port, () =>
      console.log(`⚖️  PGR Compras Públicas — backend/API → http://localhost:${config.port}`));

    // Frontend (PWA) en el puerto HTTP estándar (80), servido por el MISMO
    // proceso. Como el frontend llama a la API con rutas relativas (/api), así
    // no se requiere CORS ni configuración adicional. Si el puerto 80 está
    // ocupado o no hay permisos, el sistema sigue disponible en config.port.
    if (config.frontendPort && config.frontendPort !== config.port) {
      const web = app.listen(config.frontendPort, () =>
        console.log(`🌐 PGR Compras Públicas — frontend → http://localhost:${config.frontendPort}`));
      web.on('error', err =>
        console.error(`[web] No se pudo escuchar en el puerto ${config.frontendPort} (${err.code}); ` +
          `el sistema sigue accesible en http://localhost:${config.port}.`));
    }
  } catch (err) {
    console.error('FATAL: no se pudo iniciar el servidor:', err.message);
    process.exit(1);
  }
}

start();
