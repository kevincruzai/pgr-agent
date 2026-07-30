import crypto from 'node:crypto';
import { all, get, run } from '../db.js';

/*
 * Bitácora de auditoría (DL 113/2024 — registro de acciones del sistema).
 *
 * - Registro AUTOMÁTICO de toda petición que modifica datos (POST/PUT/DELETE)
 *   vía middleware, más eventos explícitos (login fallido, impersonación,
 *   descarga de documentos).
 * - Integridad: hash SHA-256 encadenado (row_hash = H(prev_hash | payload)).
 *   Alterar o borrar una fila intermedia rompe la cadena → detectable.
 * - Las escrituras se serializan en una cola para preservar el encadenado;
 *   nunca interrumpen la petición del usuario (fallos solo se loguean).
 * - Saneo: contraseñas, claves de API y tokens jamás se escriben.
 */

const SENSITIVE_KEYS = /pass|password|clave|secret|token|api_key|email_password/i;

function sanitize(value, depth = 0) {
  if (value == null || depth > 3) return value == null ? value : '[...]';
  if (Array.isArray(value)) return value.slice(0, 20).map(v => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 30)) {
      out[k] = SENSITIVE_KEYS.test(k) ? '[REDACTADO]' : sanitize(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 300) return value.slice(0, 300) + '…';
  return value;
}

function computeHash(prevHash, payload) {
  return crypto.createHash('sha256').update(prevHash + '|' + payload, 'utf8').digest('hex');
}

/** Carga el payload canónico de una fila (debe coincidir entre escritura y verificación). */
function rowPayload(r) {
  return JSON.stringify([
    r.event_time_iso, r.user_id ?? null, r.user_name || '', r.impersonated_by ?? null,
    r.action, r.entity || '', r.entity_id ?? null, r.details || '',
    r.success ? 1 : 0, r.ip || '',
  ]);
}

let queue = Promise.resolve();
let lastHash = null; // se inicializa de forma diferida desde la BD

async function writeEvent(evt) {
  if (lastHash === null) {
    const last = await get('SELECT TOP 1 row_hash FROM audit_log ORDER BY id DESC');
    lastHash = last?.row_hash || 'GENESIS';
  }
  const row = {
    event_time_iso: new Date().toISOString(),
    user_id: evt.userId ?? null,
    user_name: (evt.userName || '').slice(0, 190),
    impersonated_by: evt.impersonatedBy ?? null,
    action: String(evt.action || '').slice(0, 115),
    entity: String(evt.entity || '').slice(0, 55),
    entity_id: evt.entityId != null ? String(evt.entityId).slice(0, 55) : null,
    details: JSON.stringify(sanitize(evt.details ?? {})).slice(0, 4000),
    success: evt.success !== false,
    ip: String(evt.ip || '').slice(0, 55),
    user_agent: String(evt.userAgent || '').slice(0, 290),
  };
  const prev = lastHash;
  const hash = computeHash(prev, rowPayload(row));
  await run(`INSERT INTO audit_log(event_time_iso,user_id,user_name,impersonated_by,action,entity,entity_id,details,success,ip,user_agent,prev_hash,row_hash)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [row.event_time_iso, row.user_id, row.user_name, row.impersonated_by, row.action, row.entity,
     row.entity_id, row.details, row.success ? 1 : 0, row.ip, row.user_agent, prev, hash]);
  lastHash = hash;
}

/** Registra un evento. Nunca lanza: la auditoría no debe romper la operación. */
export function audit(evt) {
  queue = queue
    .then(() => writeEvent(evt))
    .catch(err => console.error('[audit] No se pudo registrar el evento:', err.message));
  return queue;
}

/** Evento construido desde una petición Express. */
export function auditFromReq(req, action, extra = {}) {
  return audit({
    userId: req.user?.id,
    userName: req.user?.name,
    impersonatedBy: req.user?.impersonated_by ?? null,
    ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '',
    userAgent: req.headers['user-agent'] || '',
    action,
    ...extra,
  });
}

/* Rutas con registro explícito (identidad especial o datos sensibles) */
const SKIP_AUTO = new Set(['/auth/login']);

/** Middleware: registra automáticamente toda mutación de la API al finalizar la respuesta.
    Usa req.originalUrl (inmutable) porque los routers de Express recortan req.path. */
export function auditMiddleware() {
  return (req, res, next) => {
    const fullPath = (req.originalUrl || '').split('?')[0];           // ej: /api/projects/3/status
    const apiPath = fullPath.replace(/^\/api/, '');                   // ej: /projects/3/status
    if (req.method === 'GET' || SKIP_AUTO.has(apiPath)) return next();
    res.on('finish', () => {
      const segs = apiPath.split('/').filter(Boolean);
      const entity = segs[0] === 'admin' ? `admin/${segs[1] || ''}` : (segs[0] || '');
      const idSeg = segs.find(s => /^\d+$/.test(s));
      auditFromReq(req, `${req.method} ${fullPath}`, {
        entity,
        entityId: idSeg || null,
        success: res.statusCode < 400,
        details: { status: res.statusCode, body: req.body && Object.keys(req.body).length ? req.body : undefined },
      });
    });
    next();
  };
}

/** Verifica la integridad de toda la cadena. Devuelve el primer punto de ruptura si existe. */
export async function verifyChain() {
  const rows = await all(`SELECT id, event_time_iso, user_id, user_name, impersonated_by, action, entity,
    entity_id, details, success, ip, prev_hash, row_hash FROM audit_log ORDER BY id ASC`);
  let prev = 'GENESIS';
  for (const r of rows) {
    if (r.prev_hash !== prev) {
      return { ok: false, total: rows.length, broken_at_id: r.id, reason: 'El hash previo no coincide (fila eliminada o insertada)' };
    }
    const expected = computeHash(prev, rowPayload(r));
    if (expected !== r.row_hash) {
      return { ok: false, total: rows.length, broken_at_id: r.id, reason: 'El contenido de la fila fue alterado' };
    }
    prev = r.row_hash;
  }
  return { ok: true, total: rows.length, last_hash: prev === 'GENESIS' ? null : prev };
}
