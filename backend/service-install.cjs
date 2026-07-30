/* Instala el backend PGR como servicio Windows (arranque automático).
   El servicio corre como LocalSystem y sirve el frontend (PWA) en :80 y la
   API/backend en :3621 (mismo proceso).
   Uso (en consola ELEVADA / Administrador):  node service-install.cjs       */
const path = require('path');
const { Service } = require('node-windows');

const svc = new Service({
  name: 'PGR Compras Publicas',
  description: 'Sistema de Compras Publicas UACP - PGR. Frontend (PWA) en http://localhost:80 y backend/API en http://localhost:3621',
  script: path.join(__dirname, 'server.js'),
  nodeOptions: '--use-system-ca',
  workingDirectory: __dirname,
  // Resiliencia: reinicia si el proceso se cae (espera creciente entre intentos).
  wait: 2,
  grow: 0.5,
  maxRestarts: 20,
});

svc.on('install', () => {
  console.log('[ok] Servicio instalado. Iniciando...');
  svc.start();
});
svc.on('alreadyinstalled', () => console.log('[i] El servicio ya estaba instalado.'));
svc.on('start', () => console.log(`[ok] Servicio "${svc.name}" iniciado en http://localhost:3621`));
svc.on('error', (err) => console.error('[x] Error del servicio:', err));

svc.install();
