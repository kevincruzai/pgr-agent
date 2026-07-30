/* Instala el backend PGR como servicio Windows (arranque automático).
   El servicio corre como LocalSystem y sirve API + frontend (PWA) en :3621.
   Uso (en consola ELEVADA / Administrador):  node service-install.cjs       */
const path = require('path');
const { Service } = require('node-windows');

const svc = new Service({
  name: 'PGR Compras Publicas',
  description: 'Sistema de Compras Publicas UACP - PGR. Backend API + frontend (PWA) en http://localhost:3621',
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
