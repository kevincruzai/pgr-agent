/* ════════════════════════════════════════════════════════════════
   Migración 004 — Adjuntos de correspondencia (importados vía IMAP)
   Ejecutar: sqlcmd -S localhost\SQLEXPRESS -E -i 004_attachments.sql
   ════════════════════════════════════════════════════════════════ */

USE PGR_Compras;
GO

IF OBJECT_ID('dbo.correspondence_attachments','U') IS NULL
CREATE TABLE dbo.correspondence_attachments (
  id INT IDENTITY(1,1) PRIMARY KEY,
  correspondence_id INT NOT NULL REFERENCES dbo.correspondences(id),
  filename NVARCHAR(300) NOT NULL,
  content_type NVARCHAR(150) NOT NULL DEFAULT 'application/octet-stream',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  stored_path NVARCHAR(500) NOT NULL,
  created_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_corr_attachments_corr')
  CREATE INDEX IX_corr_attachments_corr ON dbo.correspondence_attachments(correspondence_id);
GO
