import { Router } from 'express';
import { all, get, run } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { adviseLcp } from '../services/gemini.js';
import { getLcpThresholds, suggestLcpMethod } from '../lcp.js';

const router = Router();
router.use(requireAuth);

/* ── Asistente LCP: método de contratación según monto (Arts. 39-44) + asesoría Gemini ── */
router.post('/suggest', async (req, res) => {
  const amount = Number(req.body?.amount);
  const description = req.body?.description || '';
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ success: false, message: 'Monto inválido' });
  }

  const thresholds = await getLcpThresholds();
  const suggestion = suggestLcpMethod(amount, thresholds);

  let ai = null;
  try {
    ai = await adviseLcp(amount, description, thresholds);
  } catch (err) {
    console.error('[procurement/suggest] Gemini falló:', err.message);
  }

  res.json({ success: true, data: { ...suggestion, thresholds, ai } });
});

router.get('/', async (_req, res) => {
  const data = await all(`SELECT pr.*, u.name as unit_name, p.title as project_title, usr.name as created_by_name
    FROM procurement_requests pr
    LEFT JOIN units u ON pr.unit_id=u.id
    LEFT JOIN projects p ON pr.project_id=p.id
    LEFT JOIN users usr ON pr.created_by=usr.id
    ORDER BY pr.created_at DESC`);
  res.json({ success: true, data });
});

router.post('/', async (req, res) => {
  const { title, description, project_id, unit_id, legal_basis, procurement_type, estimated_amount, justification } = req.body || {};
  if (!title) return res.status(400).json({ success: false, message: 'Título requerido' });
  const count = await get('SELECT COUNT(*) as c FROM procurement_requests');
  const code = `PGR-${String(count.c + 1).padStart(4, '0')}-${new Date().getFullYear()}`;
  const r = await run(`INSERT INTO procurement_requests(code,title,description,project_id,unit_id,legal_basis,procurement_type,estimated_amount,justification,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [code, title, description || '', project_id || null, unit_id || null, legal_basis || 'LACAP Art. 39',
     procurement_type || 'licitacion_publica', estimated_amount || 0, justification || '', req.user.id]);
  res.json({ success: true, id: r.lastID, code });
});

export default router;
