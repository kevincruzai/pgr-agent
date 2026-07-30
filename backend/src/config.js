import 'dotenv/config';

const env = process.env;
const isProduction = env.NODE_ENV === 'production';

if (isProduction && !env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET es obligatorio en producción.');
  process.exit(1);
}

export const config = {
  isProduction,
  port: Number(env.PORT || 3621),
  jwtSecret: env.JWT_SECRET || 'pgr-dev-secret-no-usar-en-produccion',
  jwtExpiresIn: env.JWT_EXPIRES_IN || '12h',
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
