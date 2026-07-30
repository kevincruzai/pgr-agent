/* ════════════════════════════════════════════════════════════════
   Prepara la base de datos de PRUEBAS (por defecto PGR_Compras_Test).

   Aplica los mismos scripts de sql/ que la base real, sustituyendo el
   nombre de la base, y siembra los datos iniciales + demo que la suite
   de integración necesita (usuarios 01234567-8, 03456789-0, etc.).

   Ejecutar:  npm run test:db

   Motivo: las pruebas escriben en la bitácora de auditoría y crean/borran
   filas. Corriéndolas contra la base real se contaminaba el registro
   append-only (DL 113/2024) y se chocaba con el servicio en producción.

   Nota: este script lee la configuración de conexión directamente del
   entorno (no de config.js) para poder conectarse a `master` sin dejar
   ese nombre fijado en el módulo de configuración que después usa el seed.
   ════════════════════════════════════════════════════════════════ */
import 'dotenv/config';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_DIR = path.join(__dirname, '..', 'sql');
const env = process.env;

const TARGET_DB = env.DB_DATABASE || 'PGR_Compras_Test';
const SOURCE_DB = 'PGR_Compras';

if (TARGET_DB === SOURCE_DB) {
  console.error(`✖ DB_DATABASE es "${SOURCE_DB}": esto prepararía la base REAL.`);
  console.error('  Defina DB_DATABASE con otro nombre (por ejemplo PGR_Compras_Test) o use "npm run test:db".');
  process.exit(1);
}

/* Conexión leída del entorno, con los mismos valores por defecto que config.js */
const db = {
  trustedConnection: env.DB_TRUSTED_CONNECTION !== 'false',
  server: env.DB_SERVER || 'localhost',
  instance: env.DB_INSTANCE || '',
  port: env.DB_PORT ? Number(env.DB_PORT) : undefined,
  user: env.DB_USER || '',
  password: env.DB_PASSWORD || '',
  odbcDriver: env.DB_ODBC_DRIVER || 'ODBC Driver 18 for SQL Server',
  encrypt: env.DB_ENCRYPT === 'true',
  trustServerCertificate: env.DB_TRUST_SERVER_CERTIFICATE !== 'false',
};

const require = createRequire(import.meta.url);
const mssql = db.trustedConnection ? require('mssql/msnodesqlv8') : require('mssql');

function poolConfig(database) {
  const pool = { max: 4, min: 0, idleTimeoutMillis: 30000 };
  if (db.trustedConnection) {
    const server = db.instance ? `${db.server}\\${db.instance}` : db.server;
    return {
      connectionString: `Driver={${db.odbcDriver}};Server=${server};Database=${database};` +
        `Trusted_Connection=yes;TrustServerCertificate=${db.trustServerCertificate ? 'yes' : 'no'};`,
      pool,
    };
  }
  return {
    server: db.server, port: db.port, database, user: db.user, password: db.password, pool,
    options: { encrypt: db.encrypt, trustServerCertificate: db.trustServerCertificate, instanceName: db.instance || undefined },
  };
}

/** Divide un script en lotes por separadores GO (en línea propia). */
const splitBatches = sql => sql.split(/^\s*GO\s*$/gim).map(b => b.trim()).filter(Boolean);

console.log(`Preparando base de pruebas: ${TARGET_DB}\n`);

/* ── 1. Crear la base si no existe (conectado a master) ── */
const master = await new mssql.ConnectionPool(poolConfig('master')).connect();
await master.request().query(`IF DB_ID('${TARGET_DB}') IS NULL CREATE DATABASE [${TARGET_DB}];`);
console.log(`✔ Base ${TARGET_DB} disponible`);
await master.close();

/* ── 2. Aplicar los scripts de sql/ con el nombre de base sustituido ── */
const files = (await fs.readdir(SQL_DIR)).filter(f => f.endsWith('.sql')).sort();
const pool = await new mssql.ConnectionPool(poolConfig(TARGET_DB)).connect();

for (const file of files) {
  const raw = await fs.readFile(path.join(SQL_DIR, file), 'utf8');
  const sql = raw.split(SOURCE_DB).join(TARGET_DB);
  let batches = 0;
  for (const batch of splitBatches(sql)) {
    try {
      await pool.request().query(batch);
      batches++;
    } catch (err) {
      console.error(`✖ ${file}: ${err.message}`);
      await pool.close();
      process.exit(1);
    }
  }
  console.log(`✔ ${file} (${batches} lote(s))`);
}
await pool.close();

/* ── 3. Sembrar datos iniciales + demo ──
   Se llama seedAll() de forma explícita: seed.js solo se auto-ejecuta cuando es
   el script de entrada, y aquí lo estamos importando.
   config.js aún no se ha cargado en este proceso, así que tomará
   DB_DATABASE=TARGET_DB del entorno con el que se invocó este script. */
console.log('\nSembrando datos iniciales y demo...');
env.SEED_DEMO_DATA = 'true';
const { seedAll } = await import('./seed.js');
const { closePool } = await import('./db.js');
try {
  await seedAll();
  console.log(`✔ Datos sembrados en ${TARGET_DB}`);
} catch (err) {
  console.error('✖ Error al sembrar:', err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
