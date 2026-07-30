/* ════════════════════════════════════════════════════════════════
   Migración 005 — Planificación Anual de Compras (PAC) y
   modernización LACAP → LCP (Ley de Compras Públicas, DL 652/2023)

   Formato PAC según LCP Art. 17 y lineamientos DINAC: listado
   referencial con descripción, código ONU (UNSPSC), unidad
   solicitante, fuente de financiamiento, monto estimado, fecha
   estimada y método de contratación. Publicación en COMPRASAL
   dentro de 30 días de iniciado el ejercicio fiscal. La Baja
   Cuantía se excluye de la PAC (Política Anual de Compras).

   Ejecutar: sqlcmd -S localhost\SQLEXPRESS -E -i 005_pac_lcp.sql
   ════════════════════════════════════════════════════════════════ */

USE PGR_Compras;
GO

/* ─── Ítems de la Planificación Anual de Compras ─── */
IF OBJECT_ID('dbo.pac_items','U') IS NULL
CREATE TABLE dbo.pac_items (
  id INT IDENTITY(1,1) PRIMARY KEY,
  pac_year INT NOT NULL,
  correlativo INT NOT NULL,
  description NVARCHAR(500) NOT NULL,
  unspsc_code NVARCHAR(50) NOT NULL DEFAULT '',          -- código ONU del bien/servicio
  unit_id INT NULL REFERENCES dbo.units(id),             -- unidad solicitante
  funding_source NVARCHAR(120) NOT NULL DEFAULT 'Fondo General',
  procurement_method NVARCHAR(40) NOT NULL DEFAULT 'licitacion_competitiva',
  estimated_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  planned_month TINYINT NULL,                            -- mes estimado de contratación (1-12)
  status NVARCHAR(30) NOT NULL DEFAULT 'programado',     -- programado|en_proceso|contratado|desierto|cancelado
  project_id INT NULL REFERENCES dbo.projects(id),       -- vínculo al proyecto cuando inicia el proceso
  notes NVARCHAR(500) NOT NULL DEFAULT '',
  created_by INT NULL REFERENCES dbo.users(id),
  created_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME(),
  updated_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_pac_items_year')
  CREATE INDEX IX_pac_items_year ON dbo.pac_items(pac_year, correlativo);
GO

/* ─── Modernización de datos demo LACAP → LCP (idempotente: solo toca textos LACAP) ───
   Métodos LCP: Licitación Competitiva (Art. 39, > 240 salarios mínimos comercio),
   Comparación de Precios (Art. 40, ≤ 240 SM), Contratación Directa (Art. 41),
   Baja Cuantía (Art. 44, fondo circulante; excluida de la PAC). */

/* Categorías */
UPDATE dbo.categories SET name=N'Comparación de Precios', description=N'Hasta 240 salarios mínimos comercio (Art. 40 LCP)' WHERE name=N'Libre Gestión';
UPDATE dbo.categories SET name=N'Licitación Competitiva', description=N'Más de 240 salarios mínimos comercio (Art. 39 LCP)' WHERE name=N'Licitación Pública';
UPDATE dbo.categories SET name=N'Baja Cuantía', description=N'Compras inmediatas por fondo circulante (Art. 44 LCP)', icon=N'shopping_cart' WHERE name=N'Licitación por Invitación';
UPDATE dbo.categories SET description=N'Casos de excepción (Art. 41 LCP)' WHERE name=N'Contratación Directa';

/* Proyectos: referencia legal según monto (umbral $87,600 = 240 × $365) */
UPDATE dbo.projects SET legal_reference=N'LCP Art. 41 - Contratación Directa' WHERE legal_reference LIKE N'%LACAP%72%';
UPDATE dbo.projects SET legal_reference=CASE WHEN budget_estimated > 87600 THEN N'LCP Art. 39 - Licitación Competitiva' ELSE N'LCP Art. 40 - Comparación de Precios' END
  WHERE legal_reference LIKE N'%LACAP%';

/* Solicitudes de compra: método y base legal según monto */
UPDATE dbo.procurement_requests SET procurement_type=N'contratacion_directa', legal_basis=N'LCP Art. 41 - Contratación Directa'
  WHERE procurement_type=N'contratacion_directa' AND legal_basis LIKE N'%LACAP%';
UPDATE dbo.procurement_requests SET
  procurement_type=CASE WHEN estimated_amount > 87600 THEN N'licitacion_competitiva' ELSE N'comparacion_precios' END,
  legal_basis=CASE WHEN estimated_amount > 87600 THEN N'LCP Art. 39 - Licitación Competitiva' ELSE N'LCP Art. 40 - Comparación de Precios' END
  WHERE legal_basis LIKE N'%LACAP%';
GO
