import { createRequire } from 'node:module';
import { config } from './config.js';
import { decryptRow } from './services/fieldCrypto.js';

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

/** Vincula los parámetros posicionales (?) a un request de mssql y ejecuta. */
function runOnRequest(request, sqlText, params = []) {
  let i = 0;
  // Prefijo "prm" — el driver ODBC autogenera @P1,@P2... y colisionaría con @p1
  const text = sqlText.replace(/\?/g, () => `@prm${i++}`);
  params.forEach((value, idx) => request.input(`prm${idx}`, value === undefined ? null : value));
  return request.query(text);
}

async function query(sqlText, params = []) {
  const pool = await getPool();
  return runOnRequest(pool.request(), sqlText, params);
}

/**
 * Ejecuta `fn` dentro de una transacción SERIALIZABLE.
 *
 * `fn` recibe helpers {all, get, run} ligados a la transacción, con la misma
 * firma que los de módulo. Se usa donde la corrección depende de leer y escribir
 * de forma atómica frente a OTROS PROCESOS (por ejemplo, el encadenado de hash
 * de la bitácora, que antes se serializaba solo dentro de un proceso).
 * Hace rollback y relanza si `fn` falla.
 */
export async function withTransaction(fn) {
  const pool = await getPool();
  const tx = new mssql.Transaction(pool);
  await tx.begin(mssql.ISOLATION_LEVEL.SERIALIZABLE);
  let committed = false;
  try {
    const txAll = async (sqlText, params = []) =>
      ((await runOnRequest(new mssql.Request(tx), sqlText, params)).recordset ?? []).map(decryptRow);
    const txGet = async (sqlText, params = []) => {
      const row = ((await runOnRequest(new mssql.Request(tx), sqlText, params)).recordset ?? [])[0];
      return row ? decryptRow(row) : row;
    };
    const txRun = async (sqlText, params = []) => {
      const result = await runOnRequest(new mssql.Request(tx), `${sqlText}; SELECT SCOPE_IDENTITY() AS lastID;`, params);
      const sets = result.recordsets || [];
      const lastID = (sets.length ? sets[sets.length - 1] : [])?.[0]?.lastID;
      return { lastID: lastID == null ? undefined : Number(lastID), changes: result.rowsAffected?.[0] ?? 0 };
    };
    const out = await fn({ all: txAll, get: txGet, run: txRun });
    await tx.commit();
    committed = true;
    return out;
  } finally {
    if (!committed) await tx.rollback().catch(() => {});
  }
}

/** Devuelve todas las filas (descifra en sitio las columnas con sobre de cifrado). */
export const all = async (sqlText, params = []) => ((await query(sqlText, params)).recordset ?? []).map(decryptRow);

/** Devuelve la primera fila o undefined (descifrada). */
export const get = async (sqlText, params = []) => {
  const row = ((await query(sqlText, params)).recordset ?? [])[0];
  return row ? decryptRow(row) : row;
};

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
