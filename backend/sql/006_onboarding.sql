/* ════════════════════════════════════════════════════════════════
   Migración 006 — Asistente de bienvenida (configuración de correo)
   Los usuarios existentes no ven el asistente (se marcan completados);
   los nuevos registros inician con onboarding_done = 0.
   Ejecutar: sqlcmd -S localhost\SQLEXPRESS -E -i 006_onboarding.sql
   ════════════════════════════════════════════════════════════════ */

USE PGR_Compras;
GO

IF COL_LENGTH('dbo.users', 'onboarding_done') IS NULL
BEGIN
  ALTER TABLE dbo.users ADD onboarding_done BIT NOT NULL DEFAULT 0;
END
GO

/* Usuarios preexistentes: no mostrarles el asistente */
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.users') AND name='onboarding_done')
  UPDATE dbo.users SET onboarding_done=1 WHERE created_at < SYSDATETIME();
GO
