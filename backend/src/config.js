import 'dotenv/config';
import crypto from 'node:crypto';

const env = process.env;
const isProduction = env.NODE_ENV === 'production';

if (isProduction && !env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET es obligatorio en producción.');
  process.exit(1);
}

/*
 * Llave de 32 bytes para el cifrado de campos en reposo (AES-256-GCM).
 * - FIELD_ENCRYPTION_KEY: 64 hex o base64 de 32 bytes. Si es otra cadena, se
 *   deriva una llave estable con scrypt.
 * - En producción es OBLIGATORIA (sin ella el cifrado sería trivial de romper).
 * - En desarrollo, si no se define, se deriva de JWT_SECRET para no exigir
 *   configuración extra. ⚠ Cambiar esta llave hace ILEGIBLE lo ya cifrado.
 */
function resolveFieldEncryptionKey() {
  const raw = env.FIELD_ENCRYPTION_KEY;
  if (raw) {
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
    const b64 = Buffer.from(raw, 'base64');
    if (b64.length === 32) return b64;
    return crypto.scryptSync(raw, 'pgr-field-enc-v1', 32);
  }
  if (isProduction) {
    console.error('FATAL: FIELD_ENCRYPTION_KEY es obligatorio en producción (cifrado de correos en reposo).');
    process.exit(1);
  }
  return crypto.scryptSync(env.JWT_SECRET || 'pgr-dev-secret-no-usar-en-produccion', 'pgr-field-enc-v1', 32);
}

export const config = {
  isProduction,
  port: Number(env.PORT || 3621),
  // Puerto del frontend (PWA). El mismo proceso Express lo sirve en el puerto
  // HTTP estándar (80) además de la API en `port`. Poner 0 para desactivarlo.
  frontendPort: env.FRONTEND_PORT !== undefined ? Number(env.FRONTEND_PORT) : 80,
  jwtSecret: env.JWT_SECRET || 'pgr-dev-secret-no-usar-en-produccion',
  jwtExpiresIn: env.JWT_EXPIRES_IN || '12h',
  fieldEncryptionKey: resolveFieldEncryptionKey(),
  corsOrigin: env.CORS_ORIGIN ? env.CORS_ORIGIN.split(',') : '*',
  admin: {
    documentNumber: env.ADMIN_DOC || '00000000-0',
    password: env.ADMIN_PASSWORD || 'AdminPGR2024!',
  },
  seedDemoData: env.SEED_DEMO_DATA !== 'false',
  // Tolera certificados TLS no verificables en IMAP/SMTP (antivirus tipo AVG/Avast
  // que interceptan los puertos de correo). Solo para equipos de desarrollo.
  emailAllowInvalidCerts: env.EMAIL_ALLOW_INVALID_CERTS === 'true',
  db: {
    // true → autenticación Windows vía msnodesqlv8 (ODBC); false → SQL auth vía tedious
    trustedConnection: env.DB_TRUSTED_CONNECTION !== 'false',
    connectionString: env.DB_CONNECTION_STRING || '',
    server: env.DB_SERVER || 'localhost',
    instance: env.DB_INSTANCE || '',
    port: env.DB_PORT ? Number(env.DB_PORT) : undefined,
    database: env.DB_DATABASE || 'PGR_Compras',
    user: env.DB_USER || '',
    password: env.DB_PASSWORD || '',
    odbcDriver: env.DB_ODBC_DRIVER || 'ODBC Driver 18 for SQL Server',
    encrypt: env.DB_ENCRYPT === 'true',
    trustServerCertificate: env.DB_TRUST_SERVER_CERTIFICATE !== 'false',
    poolMax: Number(env.DB_POOL_MAX || 10),
  },
};
