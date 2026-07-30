import { createRequire } from 'node:module';
import { config } from './config.js';

const require = createRequire(import.meta.url);
// Autenticación Windows requiere el driver nativo msnodesqlv8 (ODBC);
// SQL auth usa tedious (JS puro), apto para servidores remotos en producción.
const mssql = config.db.trustedConnection ? require('mssql/msnodesqlv8') : require('mssql');

function buildPoolConfig() {
  const d = config.db;
  const pool = { max: d.poolMax, min: 0, idleTimeoutMillis: 30000 };

  if (d.trustedConnection) {
    const server = d.instance ? `${d.server}\\${d.instance}` : d.server;
    const connectionString = d.connectionString ||
      `Driver={${d.odbcDriver}};Server=${server};Database=${d.database};` +
      `Trusted_Connection=yes;TrustServerCertificate=${d.trustServerCertificate ? 'yes' : 'no'};`;
    return { connectionString, pool };
  }

  return {
    server: d.server,
    port: d.port,
    database: d.database,
    user: d.user,
    password: d.password,
    pool,
    options: {
      encrypt: d.encrypt,
      trustServerCertificate: d.trustServerCertificate,
      instanceName: d.instance || undefined,
    },
  };
}

let poolPromise = null;

export function getPool() {
  if (!poolPromise) {
    poolPromise = new mssql.ConnectionPool(buildPoolConfig())
      .connect()
      .then(pool => {
        pool.on('error', err => console.error('[db] Error en el pool:', err.message));
        return pool;
      })
      .catch(err => {
        poolPromise = null;
        throw err;
      });
  }
  return poolPromise;
}

async function query(sqlText, params = []) {
  const pool = await getPool();
  const request = pool.request();
  let i = 0;
  // Prefijo "prm" — el driver ODBC autogenera @P1,@P2... y colisionaría con @p1
  const text = sqlText.replace(/\?/g, () => `@prm${i++}`);
  params.forEach((value, idx) => request.input(`prm${idx}`, value === undefined ? null : value));
  return request.query(text);
}

/** Devuelve todas las filas. */
export const all = async (sqlText, params = []) => (await query(sqlText, params)).recordset ?? [];

/** Devuelve la primera fila o undefined. */
export const get = async (sqlText, params = []) => ((await query(sqlText, params)).recordset ?? [])[0];

/** Ejecuta INSERT/UPDATE/DELETE. Devuelve { lastID, changes }. */
export const run = async (sqlText, params = []) => {
  const result = await query(`${sqlText}; SELECT SCOPE_IDENTITY() AS lastID;`, params);
  const sets = result.recordsets || [];
  const lastSet = sets.length ? sets[sets.length - 1] : [];
  const lastID = lastSet?.[0]?.lastID;
  return {
    lastID: lastID == null ? undefined : Number(lastID),
    changes: result.rowsAffected?.[0] ?? 0,
  };
};

export async function closePool() {
  if (poolPromise) {
    const pool = await poolPromise.catch(() => null);
    poolPromise = null;
    if (pool) await pool.close();
  }
}
