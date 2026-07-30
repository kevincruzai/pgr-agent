/* ════════════════════════════════════════════════════════════════
   Migración 002 — Soporte para correos externos importados vía IMAP
   Ejecutar: sqlcmd -S localhost\SQLEXPRESS -E -i 002_email_import.sql
   ════════════════════════════════════════════════════════════════ */

USE PGR_Compras;
GO

/* Remitente externo (correos importados que no provienen de un usuario interno) */
IF COL_LENGTH('dbo.correspondences', 'external_from') IS NULL
  ALTER TABLE dbo.correspondences ADD external_from NVARCHAR(300) NULL;
GO

/* UID IMAP para evitar importar el mismo correo dos veces */
IF COL_LENGTH('dbo.correspondences', 'imap_uid') IS NULL
  ALTER TABLE dbo.correspondences ADD imap_uid NVARCHAR(150) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_correspondences_imap_uid')
  CREATE INDEX IX_correspondences_imap_uid ON dbo.correspondences(to_user_id, imap_uid);
GO
