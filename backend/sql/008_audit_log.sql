/* ════════════════════════════════════════════════════════════════
   Migración 008 — Bitácora de auditoría del sistema
   Cumplimiento: Ley de Ciberseguridad y Seguridad de la Información
   (DL 113/2024) — registro actualizado de acciones del sistema.

   Integridad: cada registro guarda un hash SHA-256 que encadena el
   hash del registro anterior (estilo blockchain). Cualquier
   modificación o borrado de filas intermedias rompe la cadena y es
   detectable con la verificación (/api/admin/audit/verify).

   Ejecutar: sqlcmd -S localhost\SQLEXPRESS -E -i 008_audit_log.sql
   ════════════════════════════════════════════════════════════════ */

USE PGR_Compras;
GO

IF OBJECT_ID('dbo.audit_log','U') IS NULL
CREATE TABLE dbo.audit_log (
  id INT IDENTITY(1,1) PRIMARY KEY,
  event_time DATETIME2(3) NOT NULL DEFAULT SYSDATETIME(),
  event_time_iso NVARCHAR(30) NOT NULL,            -- timestamp exacto usado en el hash
  user_id INT NULL,                                 -- sin FK: la bitácora sobrevive a los usuarios
  user_name NVARCHAR(200) NOT NULL DEFAULT '',      -- copia del nombre al momento del evento
  impersonated_by INT NULL,                         -- admin en sesión de control ("login como")
  action NVARCHAR(120) NOT NULL,                    -- ej: POST /auth/login, PUT /projects/3
  entity NVARCHAR(60) NOT NULL DEFAULT '',          -- módulo afectado (projects, users, settings...)
  entity_id NVARCHAR(60) NULL,
  details NVARCHAR(MAX) NOT NULL DEFAULT '',        -- JSON saneado (sin contraseñas ni claves)
  success BIT NOT NULL DEFAULT 1,
  ip NVARCHAR(60) NOT NULL DEFAULT '',
  user_agent NVARCHAR(300) NOT NULL DEFAULT '',
  prev_hash NVARCHAR(64) NOT NULL DEFAULT '',
  row_hash NVARCHAR(64) NOT NULL DEFAULT ''
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_audit_log_time')
  CREATE INDEX IX_audit_log_time ON dbo.audit_log(event_time DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_audit_log_user')
  CREATE INDEX IX_audit_log_user ON dbo.audit_log(user_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_audit_log_action')
  CREATE INDEX IX_audit_log_action ON dbo.audit_log(action);
GO
