import crypto from 'node:crypto';
import { config } from '../config.js';

/*
 * Cifrado de campos en reposo (AES-256-GCM).
 *
 * Objetivo: que quien lea la base de datos directamente (un backup filtrado,
 * un DBA, un archivo .db robado) SOLO vea texto cifrado. La aplicación descifra
 * con una llave que vive FUERA de la BD (config.fieldEncryptionKey, definida en
 * la variable de entorno FIELD_ENCRYPTION_KEY).
 *
 * Formato del "sobre":  enc:v1:<base64( iv[12] | tag[16] | ciphertext )>
 * - El prefijo permite detectar si un valor ya está cifrado (migración gradual)
 *   y descifrar automáticamente en la capa de lectura (db.js) sin importar el
 *   alias de la columna.
 * - GCM autentica el contenido: alterar el texto cifrado se detecta al descifrar.
 *
 * IMPORTANTE: cambiar FIELD_ENCRYPTION_KEY hace ILEGIBLE todo lo ya cifrado.
 */

const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:v1:';
const KEY = config.fieldEncryptionKey; // Buffer de 32 bytes (resuelto en config.js)

// Detecta direcciones de correo dentro de una cadena (para saneo de auditoría).
const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
// Detecta un sobre de cifrado embebido dentro de una cadena (JSON de auditoría).
const ENVELOPE_RE = /enc:v1:[A-Za-z0-9+/=]+/g;
// Claves cuyo valor completo debe cifrarse aunque no "parezca" un correo.
const EMAIL_KEY_RE = /(^|_)email(_address)?$|external_from|correo/i;

/** ¿El valor ya viene cifrado (es un sobre)? */
export function isEncrypted(v) {
  return typeof v === 'string' && v.startsWith(PREFIX);
}

/** Cifra un valor escalar. Cadenas vacías y valores ya cifrados se devuelven tal cual. */
export function encryptField(plain) {
  if (plain == null) return plain;
  const s = String(plain);
  if (s === '' || isEncrypted(s)) return s;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const ct = Buffer.concat([cipher.update(s, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

/** Descifra un sobre. Si no es un sobre o falla la autenticación, devuelve el valor tal cual. */
export function decryptField(stored) {
  if (!isEncrypted(stored)) return stored;
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    // Llave incorrecta o dato manipulado: no rompemos la lectura.
    return stored;
  }
}

/**
 * Descifra en sitio cualquier columna cuyo VALOR COMPLETO sea un sobre.
 * Se usa en la capa de lectura (db.js) para que ninguna consulta muestre texto
 * cifrado, sin importar el alias de la columna.
 * Excluye 'details' (payload de auditoría): debe permanecer tal como se almacenó
 * para que la verificación de la cadena de hashes siga cuadrando.
 */
export function decryptRow(row) {
  if (!row || typeof row !== 'object') return row;
  for (const k in row) {
    const v = row[k];
    if (k !== 'details' && isEncrypted(v)) row[k] = decryptField(v);
  }
  return row;
}

/**
 * Recorre un objeto/array/cadena y cifra las direcciones de correo que encuentre.
 * Se usa al construir el detalle de auditoría, de modo que la bitácora quede
 * cifrada en reposo. No cifra dos veces (respeta sobres existentes).
 */
export function encryptEmailsDeep(value, keyName) {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (isEncrypted(value)) return value;
    EMAIL_RE.lastIndex = 0;
    if (EMAIL_RE.test(value)) {
      EMAIL_RE.lastIndex = 0;
      return value.replace(EMAIL_RE, m => encryptField(m));
    }
    // La clave dice "email"/"external_from" pero el valor no calza con el patrón:
    // ciframos el valor completo por precaución (p. ej. correos malformados).
    if (keyName && EMAIL_KEY_RE.test(keyName) && value) return encryptField(value);
    return value;
  }
  if (Array.isArray(value)) return value.map(v => encryptEmailsDeep(v));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = encryptEmailsDeep(v, k);
    return out;
  }
  return value;
}

/** Descifra los sobres embebidos dentro de una cadena (para mostrar la auditoría al auditor). */
export function decryptEmbedded(str) {
  if (typeof str !== 'string') return str;
  return str.replace(ENVELOPE_RE, m => decryptField(m));
}
