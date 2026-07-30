/*
 * Re-verificación del cifrado de correos (léase: ¿quedó operativo?).
 *
 * Ejecutar:  npm run verify-encryption   (desde la carpeta backend)
 *
 * SOLO LECTURA — no modifica datos. Comprueba, contra la BD real:
 *  1) Puertos del servicio (3621 backend, 80 frontend).
 *  2) Columnas ampliadas (migración 009).
 *  3) Correos CIFRADOS en reposo (lo que ve la BD): users, units,
 *     user_email_config, correspondences.
 *  4) Que la app / la IA los leen EN CLARO (funcional).
 *
 * Debe correrse desde backend/ para que dotenv cargue el mismo
 * FIELD_ENCRYPTION_KEY que usa el servicio (si no, la llave no coincide).
 */
import net from 'node:net';
import { all, closePool } from './src/db.js';

let pass = 0, pend = 0, fail = 0;
const OK   = (n) => { console.log(`  ✅ ${n}`); pass++; };
const BAD  = (n) => { console.log(`  ❌ ${n}`); fail++; };
const PEND = (n) => { console.log(`  ⏳ ${n}`); pend++; };

const tcp = (port) => new Promise(r => {
  const s = net.connect({ host: '127.0.0.1', port, timeout: 1500 });
  s.on('connect', () => { s.destroy(); r(true); });
  s.on('error', () => r(false));
  s.on('timeout', () => { s.destroy(); r(false); });
});

/** Cuenta cuántas filas tienen el valor CIFRADO en reposo (SUBSTRING evita el auto-descifrado). */
async function atRest(table, col) {
  const rows = await all(`SELECT SUBSTRING(${col},1,7) AS pref FROM ${table} WHERE ${col} IS NOT NULL AND ${col} <> ''`);
  return { total: rows.length, enc: rows.filter(r => r.pref === 'enc:v1:').length };
}

async function main() {
  console.log('\n═══════ RE-VERIFICACIÓN DE CIFRADO DE CORREOS ═══════');

  console.log('\n[1] Servicio / puertos');
  (await tcp(3621)) ? OK('backend escuchando en :3621') : BAD('backend NO responde en :3621');
  const p80 = await tcp(80);
  p80 ? OK('frontend escuchando en :80') : PEND('frontend en :80 — servicio sin reiniciar con el código nuevo');

  console.log('\n[2] Columnas ampliadas (migración 009)');
  const col = await all("SELECT c.max_length AS ml FROM sys.columns c WHERE c.object_id=OBJECT_ID('dbo.users') AND c.name='email'");
  const widened = col[0] && (col[0].ml >= 1024 || col[0].ml === -1); // NVARCHAR(512)=1024 bytes
  widened ? OK('users.email ampliada (>= NVARCHAR(512))') : PEND('columnas aún en NVARCHAR(200) — migración 009 no aplicada');

  console.log('\n[3] Correos CIFRADOS en reposo (lo que ve la base de datos)');
  const targets = [
    ['dbo.users', 'email'], ['dbo.units', 'email'],
    ['dbo.user_email_config', 'email_address'], ['dbo.user_email_config', 'email_password'],
    ['dbo.correspondences', 'external_from'],
  ];
  let anyPlain = false, anyData = false;
  for (const [t, c] of targets) {
    let r; try { r = await atRest(t, c); } catch (e) { console.log(`  ⚠ ${t}.${c}: no se pudo leer (${e.message})`); continue; }
    if (r.total === 0) { console.log(`  · ${t}.${c}: (sin datos)`); continue; }
    anyData = true;
    if (r.enc === r.total) OK(`${t}.${c}: ${r.enc}/${r.total} cifrados`);
    else { PEND(`${t}.${c}: ${r.enc}/${r.total} cifrados — resto en TEXTO PLANO`); anyPlain = true; }
  }

  console.log('\n[4] La app / la IA leen EN CLARO (funcional)');
  const usr = await all("SELECT TOP 5 email FROM users WHERE email <> ''");
  usr.length && usr.every(u => !String(u.email).startsWith('enc:v1:'))
    ? OK('correos de usuarios se leen en claro (admin, envío, login)')
    : (usr.length ? BAD('algún correo se leyó todavía cifrado (revisar llave)') : console.log('  · (sin usuarios con correo)'));
  const msgs = await all(`SELECT TOP 5 c.subject, c.created_at, c.external_from, u.name AS from_name
    FROM correspondences c LEFT JOIN users u ON c.from_user_id=u.id ORDER BY c.id DESC`);
  if (msgs.length) {
    const corpus = msgs.map(m => `[${m.created_at}] DE: ${m.from_name || m.external_from || 'Sistema'} | ASUNTO: ${m.subject}`).join('\n');
    !corpus.includes('enc:v1:') ? OK('el corpus que recibiría la IA NO tiene sobres enc:v1:') : BAD('el corpus de la IA contiene texto cifrado sin descifrar');
  } else console.log('  · (sin correspondencia para simular el corpus de la IA)');

  console.log('\n═══════ VEREDICTO ═══════');
  if (fail > 0) {
    console.log('❌ HAY FALLOS — revisar arriba (posible desajuste de FIELD_ENCRYPTION_KEY).');
  } else if (!p80 || !widened || anyPlain || !anyData) {
    console.log('⏳ PENDIENTE: el cifrado aún no está completo/activo.');
    console.log('   Ejecuta  deploy\\actualizar-local.bat  (como admin) y vuelve a correr:  npm run verify-encryption');
  } else {
    console.log('✅ OPERATIVO: los correos están cifrados en reposo y la app/IA los leen en claro.');
  }
  console.log(`\n(OK: ${pass} | Pendientes: ${pend} | Fallos: ${fail})\n`);
  await closePool().catch(() => {});
  process.exit(fail ? 1 : 0);
}

main().catch(async e => { console.error('ERROR en la verificación:', e.message); await closePool().catch(() => {}); process.exit(1); });
