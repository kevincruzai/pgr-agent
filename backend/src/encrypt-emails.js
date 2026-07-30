/*
 * Cifra los correos ya existentes en la base de datos (una sola vez).
 *
 * Ejecutar DESPUÉS de aplicar la migración 009 (que amplía las columnas):
 *   npm run encrypt-emails
 *
 * Es idempotente: usa un filtro SQL  NOT LIKE 'enc:v1:%'  para tocar solo las
 * filas que aún están en texto plano, así que puede correrse varias veces sin
 * doble cifrado.
 *
 * NO reescribe la bitácora (audit_log): cifrar registros históricos rompería la
 * cadena de hashes anti-manipulación (DL 113/2024). Los eventos NUEVOS de la
 * bitácora sí se guardan con los correos cifrados.
 */
import { all, run, closePool } from './db.js';
import { encryptField } from './services/fieldCrypto.js';

async function encryptColumn(table, col) {
  // El filtro corre sobre el valor ALMACENADO (aún en claro); el auto-descifrado
  // de la capa de lectura es un no-op sobre texto plano.
  const rows = await all(
    `SELECT id, ${col} AS val FROM ${table} WHERE ${col} IS NOT NULL AND ${col} <> '' AND ${col} NOT LIKE 'enc:v1:%'`
  );
  for (const r of rows) {
    await run(`UPDATE ${table} SET ${col}=? WHERE id=?`, [encryptField(r.val), r.id]);
  }
  console.log(`  ${table}.${col}: ${rows.length} fila(s) cifrada(s)`);
  return rows.length;
}

async function main() {
  console.log('🔐 Cifrando correos existentes en reposo (AES-256-GCM)...');
  let total = 0;
  total += await encryptColumn('dbo.users', 'email');
  total += await encryptColumn('dbo.units', 'email');
  total += await encryptColumn('dbo.user_email_config', 'email_address');
  total += await encryptColumn('dbo.user_email_config', 'email_password');
  total += await encryptColumn('dbo.correspondences', 'external_from');
  console.log(`✅ Listo. ${total} valor(es) cifrado(s) en total.`);
  console.log('ℹ  La bitácora (audit_log) no se reescribe por diseño; los nuevos eventos ya se cifran.');
  await closePool();
}

main().catch(async err => {
  console.error('ERROR al cifrar correos:', err.message);
  await closePool().catch(() => {});
  process.exit(1);
});
