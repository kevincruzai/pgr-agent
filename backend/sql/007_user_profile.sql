/* ════════════════════════════════════════════════════════════════
   Migración 007 — Perfil de usuario y clave temporal obligatoria
   - must_change_password: el admin crea usuarios con clave temporal
     que deben cambiar en su primer ingreso.
   - phone / position: datos de perfil (teléfono y cargo).
   Ejecutar: sqlcmd -S localhost\SQLEXPRESS -E -i 007_user_profile.sql
   ════════════════════════════════════════════════════════════════ */

USE PGR_Compras;
GO

IF COL_LENGTH('dbo.users', 'must_change_password') IS NULL
  ALTER TABLE dbo.users ADD must_change_password BIT NOT NULL DEFAULT 0;
GO

IF COL_LENGTH('dbo.users', 'phone') IS NULL
  ALTER TABLE dbo.users ADD phone NVARCHAR(50) NOT NULL DEFAULT '';
GO

IF COL_LENGTH('dbo.users', 'position') IS NULL
  ALTER TABLE dbo.users ADD position NVARCHAR(150) NOT NULL DEFAULT '';
GO
