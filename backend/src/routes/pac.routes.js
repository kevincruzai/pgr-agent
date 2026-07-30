import { Router } from 'express';
import { all, get, run } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { LCP_METHODS } from '../lcp.js';

/* Planificación Anual de Compras (PAC) — LCP Art. 17.
   Listado referencial de obras, bienes, servicios y consultorías del ejercicio
   fiscal: descripción, código ONU (UNSPSC), unidad solicitante, fuente de
   financiamiento, monto estimado, mes estimado y método de contratación.
   Debe publicarse en COMPRASAL dentro de los 30 días de iniciado el ejercicio. */

const router = Router();
router.use(requireAuth);

const VALID_METHODS = [...Object.keys(LCP_METHODS), 'consultoria', 'convenio_marco', 'subasta_inversa'];
const VALID_STATUS = ['programado', 'en_proceso', 'contratado', 'desierto', 'cancelado'];

router.get('/', async (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const items = await all(`SELECT pi.*, u.name as unit_name, p.title as project_title, p.status as project_status, usr.name as created_by_name
    FROM pac_items pi
    LEFT JOIN units u ON pi.unit_id=u.id
    LEFT JOIN projects p ON pi.project_id=p.id
    LEFT JOIN users usr ON pi.created_by=usr.id
    WHERE pi.pac_year=? ORDER BY pi.correlativo`, [year]);

  const budgetRow = await get("SELECT value FROM settings WHERE [key]='annual_budget_amount'");
  const budgetYearRow = await get("SELECT value FROM settings WHERE [key]='annual_budget_year'");
  const annualBudget = (parseInt(budgetYearRow?.value) === year) ? (parseFloat(budgetRow?.value) || 0) : 0;

  const active = items.filter(i => i.status !== 'cancelado');
  const total = active.reduce((a, i) => a + Number(i.estimated_amount), 0);
  const byMethod = {};
  const byQuarter = { T1: 0, T2: 0, T3: 0, T4: 0 };
  for (const i of active) {
    byMethod[i.procurement_method] = (byMethod[i.procurement_method] || 0) + Number(i.estimated_amount);
    if (i.planned_month) byQuarter[`T${Math.ceil(i.planned_month / 3)}`] += Number(i.estimated_amount);
  }

  res.json({ success: true, data: { year, items, summary: {
    total, count: active.length, byMethod, byQuarter,
    annualBudget, withinBudget: !annualBudget || total <= annualBudget,
    budgetDifference: annualBudget ? annualBudget - total : null,
    linked: active.filter(i => i.project_id).length,
    contracted: active.filter(i => i.status === 'contratado').length,
  }}});
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  if (!b.description) return res.status(400).json({ success: false, message: 'Descripción del objeto de compra requerida' });
  const year = parseInt(b.pac_year) || new Date().getFullYear();
  const method = VALID_METHODS.includes(b.procurement_method) ? b.procurement_method : 'comparacion_precios';
  if (method === 'baja_cuantia') {
    return res.status(400).json({ success: false, message: 'La Baja Cuantía se EXCLUYE de la PAC (Política Anual de Compras DINAC): se reporta mensualmente en COMPRASAL.' });
  }
  const month = b.planned_month ? Math.min(12, Math.max(1, parseInt(b.planned_month))) : null;
  const next = await get('SELECT COALESCE(MAX(correlativo),0)+1 as n FROM pac_items WHERE pac_year=?', [year]);
  const r = await run(`INSERT INTO pac_items(pac_year,correlativo,description,unspsc_code,unit_id,funding_source,procurement_method,estimated_amount,planned_month,notes,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    [year, next.n, b.description, b.unspsc_code || '', b.unit_id || null, b.funding_source || 'Fondo General',
     method, Number(b.estimated_amount) || 0, month, b.notes || '', req.user.id]);
  res.json({ success: true, id: r.lastID, correlativo: next.n });
});

router.put('/:id', async (req, res) => {
  const item = await get('SELECT * FROM pac_items WHERE id=?', [req.params.id]);
  if (!item) return res.status(404).json({ success: false, message: 'Ítem de la PAC no encontrado' });
  const b = req.body || {};
  const method = b.procurement_method && VALID_METHODS.includes(b.procurement_method) ? b.procurement_method : item.procurement_method;
  if (method === 'baja_cuantia') {
    return res.status(400).json({ success: false, message: 'La Baja Cuantía se EXCLUYE de la PAC: se reporta mensualmente en COMPRASAL.' });
  }
  const status = b.status && VALID_STATUS.includes(b.status) ? b.status : item.status;
  const month = b.planned_month !== undefined ? (b.planned_month ? Math.min(12, Math.max(1, parseInt(b.planned_month))) : null) : item.planned_month;
  await run(`UPDATE pac_items SET description=?,unspsc_code=?,unit_id=?,funding_source=?,procurement_method=?,estimated_amount=?,
    planned_month=?,status=?,project_id=?,notes=?,updated_at=SYSDATETIME() WHERE id=?`,
    [b.description ?? item.description, b.unspsc_code ?? item.unspsc_code,
     b.unit_id !== undefined ? (b.unit_id || null) : item.unit_id,
     b.funding_source ?? item.funding_source, method,
     b.estimated_amount !== undefined ? (Number(b.estimated_amount) || 0) : item.estimated_amount,
     month, status,
     b.project_id !== undefined ? (b.project_id || null) : item.project_id,
     b.notes ?? item.notes, req.params.id]);
  res.json({ success: true });
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const r = await run('DELETE FROM pac_items WHERE id=?', [req.params.id]);
  if (!r.changes) return res.status(404).json({ success: false, message: 'Ítem no encontrado' });
  res.json({ success: true });
});

export default router;
