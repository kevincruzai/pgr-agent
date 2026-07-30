/* ════════════════════════════════════════════════════════════════
   Migración 009 — Cifrado de correos en reposo (AES-256-GCM)
   Cumplimiento: Ley de Ciberseguridad y Seguridad de la Información
   (DL 113/2024) — los correos deben quedar cifrados en la base de
   datos y en la bitácora de auditoría.

   La aplicación cifra los correos con una llave que vive FUERA de la
   BD (variable de entorno FIELD_ENCRYPTION_KEY). El texto cifrado
   (sobre "enc:v1:<base64>") es más largo que el texto plano, por lo
   que estas columnas deben ampliarse.

   Esta migración NO cifra los datos existentes: eso lo hace el script
   Node  `npm run encrypt-emails`  (idempotente), que debe ejecutarse
   una sola vez DESPUÉS de aplicar esta migración.

   Ejecutar: sqlcmd -S localhost\SQLEXPRESS -E -i 009_encrypt_email_columns.sql
   ════════════════════════════════════════════════════════════════ */

USE PGR_Compras;
GO

ALTER TABLE dbo.users             ALTER COLUMN email          NVARCHAR(512) NOT NULL;
GO
ALTER TABLE dbo.units             ALTER COLUMN email          NVARCHAR(512) NOT NULL;
GO
ALTER TABLE dbo.user_email_config ALTER COLUMN email_address  NVARCHAR(512) NOT NULL;
GO
ALTER TABLE dbo.user_email_config ALTER COLUMN email_password NVARCHAR(512) NOT NULL;
GO
ALTER TABLE dbo.correspondences   ALTER COLUMN external_from  NVARCHAR(512) NULL;
GO
