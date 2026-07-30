/* Desinstala el servicio Windows del backend PGR.
   Uso (en consola ELEVADA / Administrador):  node service-uninstall.cjs */
const path = require('path');
const { Service } = require('node-windows');

const svc = new Service({
  name: 'PGR Compras Publicas',
  script: path.join(__dirname, 'server.js'),
});

svc.on('uninstall', () => console.log('[ok] Servicio desinstalado.'));
svc.on('error', (err) => console.error('[x] Error:', err));

svc.uninstall();
