/* ════════════════════════════════════════════════════════════════
   PGR - Sistema de Compras Públicas UACP
   Esquema de base de datos para SQL Server (2017+)
   Ejecutar: sqlcmd -S localhost\SQLEXPRESS -E -i 001_schema.sql
   ════════════════════════════════════════════════════════════════ */

IF DB_ID('PGR_Compras') IS NULL
  CREATE DATABASE PGR_Compras;
GO

USE PGR_Compras;
GO

/* ─── Unidades Solicitantes ─── */
IF OBJECT_ID('dbo.units','U') IS NULL
CREATE TABLE dbo.units (
  id INT IDENTITY(1,1) PRIMARY KEY,
  name NVARCHAR(200) NOT NULL,
  code NVARCHAR(50) NOT NULL UNIQUE,
  description NVARCHAR(500) NOT NULL DEFAULT '',
  responsible_name NVARCHAR(200) NOT NULL DEFAULT '',
  email NVARCHAR(200) NOT NULL DEFAULT '',
  phone NVARCHAR(50) NOT NULL DEFAULT '',
  is_active BIT NOT NULL DEFAULT 1,
  created_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME()
);
GO

/* ─── Usuarios del sistema ─── */
IF OBJECT_ID('dbo.users','U') IS NULL
CREATE TABLE dbo.users (
  id INT IDENTITY(1,1) PRIMARY KEY,
  name NVARCHAR(200) NOT NULL,
  email NVARCHAR(200) NOT NULL DEFAULT '',
  document_type NVARCHAR(20) NOT NULL DEFAULT 'DUI',
  document_number NVARCHAR(50) NOT NULL UNIQUE,
  password_hash NVARCHAR(200) NOT NULL,
  role NVARCHAR(50) NOT NULL DEFAULT 'analista',
  unit_id INT NULL REFERENCES dbo.units(id),
  avatar_color NVARCHAR(20) NOT NULL DEFAULT '#0066cc',
  is_active BIT NOT NULL DEFAULT 1,
  created_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME()
);
GO

/* ─── Roles del sistema ─── */
IF OBJECT_ID('dbo.roles','U') IS NULL
CREATE TABLE dbo.roles (
  id INT IDENTITY(1,1) PRIMARY KEY,
  name NVARCHAR(50) NOT NULL UNIQUE,
  display_name NVARCHAR(100) NOT NULL,
  description NVARCHAR(300) NOT NULL DEFAULT '',
  is_system BIT NOT NULL DEFAULT 0,
  created_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME()
);
GO

/* ─── Categorías de Proyectos ─── */
IF OBJECT_ID('dbo.categories','U') IS NULL
CREATE TABLE dbo.categories (
  id INT IDENTITY(1,1) PRIMARY KEY,
  name NVARCHAR(100) NOT NULL,
  color NVARCHAR(20) NOT NULL DEFAULT '#0066cc',
  icon NVARCHAR(50) NOT NULL DEFAULT 'folder',
  description NVARCHAR(300) NOT NULL DEFAULT '',
  created_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME()
);
GO

/* ─── Proyectos de Compra ─── */
IF OBJECT_ID('dbo.projects','U') IS NULL
CREATE TABLE dbo.projects (
  id INT IDENTITY(1,1) PRIMARY KEY,
  title NVARCHAR(300) NOT NULL,
  description NVARCHAR(MAX) NOT NULL DEFAULT '',
  unit_id INT NULL REFERENCES dbo.units(id),
  category_id INT NULL REFERENCES dbo.categories(id),
  status NVARCHAR(30) NOT NULL DEFAULT 'borrador',
  priority NVARCHAR(20) NOT NULL DEFAULT 'media',
  budget_estimated DECIMAL(18,2) NOT NULL DEFAULT 0,
  legal_reference NVARCHAR(200) NOT NULL DEFAULT '',
  deadline DATE NULL,
  assigned_to INT NULL REFERENCES dbo.users(id),
  created_by INT NULL REFERENCES dbo.users(id),
  created_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME(),
  updated_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_projects_status')
  CREATE INDEX IX_projects_status ON dbo.projects(status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_projects_deadline')
  CREATE INDEX IX_projects_deadline ON dbo.projects(deadline);
GO

/* ─── Correspondencia (Gmail-like) ─── */
IF OBJECT_ID('dbo.correspondences','U') IS NULL
CREATE TABLE dbo.correspondences (
  id INT IDENTITY(1,1) PRIMARY KEY,
  subject NVARCHAR(300) NOT NULL,
  body NVARCHAR(MAX) NOT NULL DEFAULT '',
  from_user_id INT NULL REFERENCES dbo.users(id),
  to_user_id INT NULL REFERENCES dbo.users(id),
  project_id INT NULL REFERENCES dbo.projects(id),
  label NVARCHAR(30) NOT NULL DEFAULT 'inbox',
  is_read BIT NOT NULL DEFAULT 0,
  is_starred BIT NOT NULL DEFAULT 0,
  is_archived BIT NOT NULL DEFAULT 0,
  ai_category NVARCHAR(50) NOT NULL DEFAULT '',
  ai_priority NVARCHAR(20) NOT NULL DEFAULT '',
  ai_summary NVARCHAR(500) NOT NULL DEFAULT '',
  created_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_correspondences_to_user')
  CREATE INDEX IX_correspondences_to_user ON dbo.correspondences(to_user_id, is_archived, is_read);
GO

/* ─── Alertas del Sistema ─── */
IF OBJECT_ID('dbo.alerts','U') IS NULL
CREATE TABLE dbo.alerts (
  id INT IDENTITY(1,1) PRIMARY KEY,
  project_id INT NULL REFERENCES dbo.projects(id),
  user_id INT NULL REFERENCES dbo.users(id),
  type NVARCHAR(40) NOT NULL DEFAULT 'info',
  title NVARCHAR(300) NOT NULL,
  message NVARCHAR(MAX) NOT NULL DEFAULT '',
  is_read BIT NOT NULL DEFAULT 0,
  trigger_date DATE NULL,
  created_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_alerts_user')
  CREATE INDEX IX_alerts_user ON dbo.alerts(user_id, is_read);
GO

/* ─── Solicitudes de Compra (Ley LACAP) ─── */
IF OBJECT_ID('dbo.procurement_requests','U') IS NULL
CREATE TABLE dbo.procurement_requests (
  id INT IDENTITY(1,1) PRIMARY KEY,
  code NVARCHAR(50) NOT NULL UNIQUE,
  project_id INT NULL REFERENCES dbo.projects(id),
  unit_id INT NULL REFERENCES dbo.units(id),
  title NVARCHAR(300) NOT NULL,
  description NVARCHAR(MAX) NOT NULL DEFAULT '',
  legal_basis NVARCHAR(200) NOT NULL DEFAULT 'LACAP Art. 39 - Licitación Pública',
  procurement_type NVARCHAR(40) NOT NULL DEFAULT 'licitacion_publica',
  estimated_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  status NVARCHAR(30) NOT NULL DEFAULT 'borrador',
  justification NVARCHAR(MAX) NOT NULL DEFAULT '',
  created_by INT NULL REFERENCES dbo.users(id),
  approved_by INT NULL REFERENCES dbo.users(id),
  created_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME(),
  updated_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME()
);
GO

/* ─── Configuración del sistema ─── */
IF OBJECT_ID('dbo.settings','U') IS NULL
CREATE TABLE dbo.settings (
  id INT IDENTITY(1,1) PRIMARY KEY,
  [key] NVARCHAR(100) NOT NULL UNIQUE,
  value NVARCHAR(MAX) NOT NULL DEFAULT '',
  updated_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME()
);
GO

/* ─── Eventos / Timeline de Proyectos ─── */
IF OBJECT_ID('dbo.project_events','U') IS NULL
CREATE TABLE dbo.project_events (
  id INT IDENTITY(1,1) PRIMARY KEY,
  project_id INT NOT NULL REFERENCES dbo.projects(id),
  user_id INT NULL REFERENCES dbo.users(id),
  event_type NVARCHAR(40) NOT NULL DEFAULT 'note',
  title NVARCHAR(300) NOT NULL,
  description NVARCHAR(MAX) NOT NULL DEFAULT '',
  old_value NVARCHAR(200) NOT NULL DEFAULT '',
  new_value NVARCHAR(200) NOT NULL DEFAULT '',
  created_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_project_events_project')
  CREATE INDEX IX_project_events_project ON dbo.project_events(project_id);
GO

/* ─── Configuración de correo por usuario ─── */
IF OBJECT_ID('dbo.user_email_config','U') IS NULL
CREATE TABLE dbo.user_email_config (
  id INT IDENTITY(1,1) PRIMARY KEY,
  user_id INT NOT NULL UNIQUE REFERENCES dbo.users(id),
  email_address NVARCHAR(200) NOT NULL DEFAULT '',
  imap_host NVARCHAR(200) NOT NULL DEFAULT '',
  imap_port INT NOT NULL DEFAULT 993,
  imap_secure BIT NOT NULL DEFAULT 1,
  smtp_host NVARCHAR(200) NOT NULL DEFAULT '',
  smtp_port INT NOT NULL DEFAULT 587,
  smtp_secure BIT NOT NULL DEFAULT 1,
  email_password NVARCHAR(300) NOT NULL DEFAULT '',
  provider NVARCHAR(50) NOT NULL DEFAULT 'other',
  is_active BIT NOT NULL DEFAULT 0,
  last_sync DATETIME2(0) NULL,
  created_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME(),
  updated_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME()
);
GO
