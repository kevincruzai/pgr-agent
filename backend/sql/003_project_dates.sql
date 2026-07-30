/* ════════════════════════════════════════════════════════════════
   Migración 003 — Fechas de inicio y fin de proyecto (edición manual)
   Ejecutar: sqlcmd -S localhost\SQLEXPRESS -E -i 003_project_dates.sql
   ════════════════════════════════════════════════════════════════ */

USE PGR_Compras;
GO

IF COL_LENGTH('dbo.projects', 'start_date') IS NULL
  ALTER TABLE dbo.projects ADD start_date DATE NULL;
GO

IF COL_LENGTH('dbo.projects', 'end_date') IS NULL
  ALTER TABLE dbo.projects ADD end_date DATE NULL;
GO
