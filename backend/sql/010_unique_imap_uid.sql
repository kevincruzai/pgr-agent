/* ════════════════════════════════════════════════════════════════
   Migración 010 — Un correo IMAP, una sola fila

   El índice de 002 sobre (to_user_id, imap_uid) NO era único, así que dos
   sincronizaciones simultáneas del mismo buzón (el botón "Sincronizar" de la
   bandeja y el programador automático) insertaban el mismo mensaje dos veces.
   Aquí se limpian las copias existentes y se impide que vuelva a ocurrir.

   Ejecutar: sqlcmd -S localhost\SQLEXPRESS -E -C -b -i 010_unique_imap_uid.sql
   ════════════════════════════════════════════════════════════════ */

USE PGR_Compras;
GO

/* ── 1. Adjuntos de las copias (la FK de 004 impide borrar el padre antes) ── */
WITH dup AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY to_user_id, imap_uid ORDER BY id) AS rn
  FROM dbo.correspondences
  WHERE imap_uid IS NOT NULL
)
DELETE a
FROM dbo.correspondence_attachments a
INNER JOIN dup ON dup.id = a.correspondence_id
WHERE dup.rn > 1;
GO

/* ── 2. Copias duplicadas: se conserva la de menor id (la primera importada) ── */
WITH dup AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY to_user_id, imap_uid ORDER BY id) AS rn
  FROM dbo.correspondences
  WHERE imap_uid IS NOT NULL
)
DELETE FROM dup WHERE rn > 1;
GO

/* ── 3. Índice ÚNICO filtrado. Filtrado porque la correspondencia interna del
      sistema tiene imap_uid NULL y SQL Server considera iguales dos NULL en un
      índice único: sin el filtro solo se admitiría un correo interno. Sustituye
      al índice no único de 002, que resolvía la misma consulta de deduplicación. ── */
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_correspondences_imap_uid'
           AND object_id = OBJECT_ID('dbo.correspondences'))
  DROP INDEX IX_correspondences_imap_uid ON dbo.correspondences;
GO

/* Un índice FILTRADO exige QUOTED_IDENTIFIER ON al crearse, y sqlcmd lo trae en
   OFF salvo que se invoque con -I. Se fija aquí para no depender de la llamada. */
SET QUOTED_IDENTIFIER ON;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_correspondences_imap_uid'
               AND object_id = OBJECT_ID('dbo.correspondences'))
  CREATE UNIQUE INDEX UQ_correspondences_imap_uid
    ON dbo.correspondences(to_user_id, imap_uid)
    WHERE imap_uid IS NOT NULL;
GO
