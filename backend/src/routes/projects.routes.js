import { Router } from 'express';
import { all, get, run } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { chatWithProject } from '../services/gemini.js';
import { LCP_PHASES } from '../lcp.js';

const router = Router();
router.use(requireAuth);

/* ── Chat IA del proyecto: responde preguntas con el expediente completo como contexto ── */
router.post('/:id/chat', async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ success: false, message: 'Debe incluir al menos un mensaje del usuario' });
  }

  const p = await get(`SELECT p.*, c.name as category_name, u.name as unit_name, u.responsible_name,
    usr.name as created_by_name, asgn.name as assigned_name
    FROM projects p LEFT JOIN categories c ON p.category_id=c.id LEFT JOIN units u ON p.unit_id=u.id
    LEFT JOIN users usr ON p.created_by=usr.id LEFT JOIN users asgn ON p.assigned_to=asgn.id WHERE p.id=?`, [req.params.id]);
  if (!p) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

  const fmt = d => d ? String(new Date(d).toISOString()).slice(0, 10) : null;
  const timeline = await all(`SELECT TOP 30 pe.event_type, pe.title, pe.description, pe.created_at, u.name as user_name
    FROM project_events pe LEFT JOIN users u ON pe.user_id=u.id WHERE pe.project_id=? ORDER BY pe.created_at DESC`, [req.params.id]);
  const corrs = await all(`SELECT TOP 15 c.subject, c.ai_summary, c.created_at, COALESCE(u.name, c.external_from) as de
    FROM correspondences c LEFT JOIN users u ON c.from_user_id=u.id WHERE c.project_id=? ORDER BY c.created_at DESC`, [req.params.id]);
  const procurement = await all('SELECT code, status, estimated_amount, legal_basis FROM procurement_requests WHERE project_id=?', [req.params.id]);
  const alerts = await all('SELECT TOP 10 type, title, is_read, created_at FROM alerts WHERE project_id=? ORDER BY created_at DESC', [req.params.id]);
  const attachments = await all(`SELECT TOP 15 ca.filename, ca.content_type, c.subject as correo
    FROM correspondence_attachments ca INNER JOIN correspondences c ON ca.correspondence_id=c.id
    WHERE c.project_id=? ORDER BY ca.created_at DESC`, [req.params.id]);

  const context = {
    proyecto: {
      titulo: p.title, descripcion: p.description, estado: p.status,
      fase_lcp: LCP_PHASES[p.status] || null, prioridad: p.priority,
      presupuesto_estimado_usd: Number(p.budget_estimated), base_legal: p.legal_reference,
      fecha_inicio: fmt(p.start_date), fecha_fin: fmt(p.end_date), fecha_limite: fmt(p.deadline),
      dias_para_vencimiento: p.deadline ? Math.ceil((new Date(p.deadline) - new Date()) / 86400000) : null,
      unidad_solicitante: p.unit_name, responsable_unidad: p.responsible_name,
      creado_por: p.created_by_name, responsable_asignado_actual: p.assigned_name || 'Sin asignar',
      categoria: p.category_name, creado_el: fmt(p.created_at), actualizado_el: fmt(p.updated_at),
    },
    seguimiento_timeline: timeline,
    correspondencia: corrs,
    solicitudes_de_compra: procurement,
    alertas: alerts,
    documentos_adjuntos: attachments,
  };

  try {
    const reply = await chatWithProject(context, messages);
    if (!reply) return res.status(400).json({ success: false, message: 'Gemini no está activado. Pida al administrador configurar la API Key en Configuración → Gemini Pro API.' });
    res.json({ success: true, reply });
  } catch (err) {
    res.status(502).json({ success: false, message: err.message });
  }
});

router.get('/', async (_req, res) => {
  const projects = await all(`SELECT p.*, c.name as category_name, c.color as category_color, u.name as unit_name, usr.name as assigned_name
    FROM projects p LEFT JOIN categories c ON p.category_id=c.id LEFT JOIN units u ON p.unit_id=u.id LEFT JOIN users usr ON p.assigned_to=usr.id
    ORDER BY p.updated_at DESC`);
  res.json({ success: true, data: projects });
});

router.get('/:id', async (req, res) => {
  const p = await get(`SELECT p.*, c.name as category_name, c.color as category_color, u.name as unit_name
    FROM projects p LEFT JOIN categories c ON p.category_id=c.id LEFT JOIN units u ON p.unit_id=u.id WHERE p.id=?`, [req.params.id]);
  if (!p) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
  res.json({ success: true, data: p });
});

router.post('/', async (req, res) => {
  const { title, description, unit_id, category_id, priority, budget_estimated, legal_reference, deadline } = req.body || {};
  if (!title) return res.status(400).json({ success: false, message: 'Título requerido' });
  const r = await run(`INSERT INTO projects(title,description,unit_id,category_id,priority,budget_estimated,legal_reference,deadline,created_by)
    VALUES(?,?,?,?,?,?,?,?,?)`,
    [title, description || '', unit_id || null, category_id || null, priority || 'media', budget_estimated || 0, legal_reference || '', deadline || null, req.user.id]);
  res.json({ success: true, id: r.lastID });
});

/* ── Edición manual del proyecto (incluye fechas de inicio/fin) ── */
router.put('/:id', async (req, res) => {
  const p = await get('SELECT * FROM projects WHERE id=?', [req.params.id]);
  if (!p) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

  const b = req.body || {};
  if (!b.title) return res.status(400).json({ success: false, message: 'Título requerido' });

  const next = {
    title: b.title,
    description: b.description ?? p.description,
    unit_id: b.unit_id !== undefined ? (b.unit_id || null) : p.unit_id,
    category_id: b.category_id !== undefined ? (b.category_id || null) : p.category_id,
    priority: b.priority || p.priority,
    budget_estimated: b.budget_estimated !== undefined ? (Number(b.budget_estimated) || 0) : p.budget_estimated,
    legal_reference: b.legal_reference ?? p.legal_reference,
    deadline: b.deadline !== undefined ? (b.deadline || null) : p.deadline,
    start_date: b.start_date !== undefined ? (b.start_date || null) : p.start_date,
    end_date: b.end_date !== undefined ? (b.end_date || null) : p.end_date,
    assigned_to: b.assigned_to !== undefined ? (b.assigned_to || null) : p.assigned_to,
  };

  if (next.start_date && next.end_date && new Date(next.end_date) < new Date(next.start_date)) {
    return res.status(400).json({ success: false, message: 'La fecha de fin no puede ser anterior a la fecha de inicio' });
  }

  await run(`UPDATE projects SET title=?,description=?,unit_id=?,category_id=?,priority=?,budget_estimated=?,
    legal_reference=?,deadline=?,start_date=?,end_date=?,assigned_to=?,updated_at=SYSDATETIME() WHERE id=?`,
    [next.title, next.description, next.unit_id, next.category_id, next.priority, next.budget_estimated,
     next.legal_reference, next.deadline, next.start_date, next.end_date, next.assigned_to, req.params.id]);

  /* Registrar en el seguimiento qué cambió (las fechas con valor anterior → nuevo) */
  const fmt = d => d ? String(d).slice(0, 10) : '—';
  const dateChanges = [];
  if (fmt(p.start_date) !== fmt(next.start_date)) dateChanges.push(`inicio: ${fmt(p.start_date)} → ${fmt(next.start_date)}`);
  if (fmt(p.end_date) !== fmt(next.end_date)) dateChanges.push(`fin: ${fmt(p.end_date)} → ${fmt(next.end_date)}`);
  if (fmt(p.deadline) !== fmt(next.deadline)) dateChanges.push(`límite: ${fmt(p.deadline)} → ${fmt(next.deadline)}`);
  const otherChanges = [];
  if (p.title !== next.title) otherChanges.push('título');
  if ((p.description || '') !== (next.description || '')) otherChanges.push('descripción');
  if (Number(p.budget_estimated) !== Number(next.budget_estimated)) otherChanges.push(`presupuesto ($${Number(p.budget_estimated)} → $${Number(next.budget_estimated)})`);
  if (p.priority !== next.priority) otherChanges.push(`prioridad (${p.priority} → ${next.priority})`);
  if ((p.assigned_to || null) !== (next.assigned_to || null)) otherChanges.push('responsable asignado');
  if ((p.unit_id || null) !== (next.unit_id || null)) otherChanges.push('unidad');
  if ((p.category_id || null) !== (next.category_id || null)) otherChanges.push('categoría');

  const parts = [...dateChanges, ...otherChanges];
  if (parts.length) {
    await run('INSERT INTO project_events(project_id,user_id,event_type,title,description,old_value,new_value) VALUES(?,?,?,?,?,?,?)',
      [req.params.id, req.user.id, 'note', 'Proyecto editado', `Cambios: ${parts.join('; ')}`, '', '']);
  }

  res.json({ success: true });
});

router.put('/:id/status', async (req, res) => {
  const { status } = req.body || {};
  const valid = ['borrador', 'en_revision', 'aprobado', 'en_proceso', 'adjudicado', 'completado', 'cancelado'];
  if (!valid.includes(status)) return res.status(400).json({ success: false, message: 'Estado inválido' });
  const old = await get('SELECT status FROM projects WHERE id=?', [req.params.id]);
  await run('UPDATE projects SET status=?, updated_at=SYSDATETIME() WHERE id=?', [status, req.params.id]);
  await run('INSERT INTO project_events(project_id,user_id,event_type,title,description,old_value,new_value) VALUES(?,?,?,?,?,?,?)',
    [req.params.id, req.user.id, 'status_change', 'Cambio de estado', `Estado actualizado de "${old?.status || ''}" a "${status}"`, old?.status || '', status]);
  res.json({ success: true });
});

/* ── Detalle del proyecto: timeline + correspondencia + solicitudes + alertas ── */
router.get('/:id/detail', async (req, res) => {
  const p = await get(`SELECT p.*, c.name as category_name, c.color as category_color, c.icon as category_icon,
    u.name as unit_name, u.code as unit_code, u.responsible_name, u.email as unit_email,
    usr.name as created_by_name, asgn.name as assigned_name
    FROM projects p LEFT JOIN categories c ON p.category_id=c.id LEFT JOIN units u ON p.unit_id=u.id
    LEFT JOIN users usr ON p.created_by=usr.id LEFT JOIN users asgn ON p.assigned_to=asgn.id WHERE p.id=?`, [req.params.id]);
  if (!p) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

  const timeline = await all(`SELECT pe.*, u.name as user_name FROM project_events pe
    LEFT JOIN users u ON pe.user_id=u.id WHERE pe.project_id=? ORDER BY pe.created_at ASC`, [req.params.id]);

  const correspondences = await all(`SELECT c.*, COALESCE(u.name, c.external_from) as from_name FROM correspondences c
    LEFT JOIN users u ON c.from_user_id=u.id WHERE c.project_id=? ORDER BY c.created_at ASC`, [req.params.id]);

  const procurement = await all(`SELECT pr.*, usr.name as created_by_name FROM procurement_requests pr
    LEFT JOIN users usr ON pr.created_by=usr.id WHERE pr.project_id=?`, [req.params.id]);

  const alerts = await all('SELECT * FROM alerts WHERE project_id=? ORDER BY created_at DESC', [req.params.id]);

  res.json({ success: true, data: { project: p, timeline, correspondences, procurement, alerts } });
});

router.post('/:id/events', async (req, res) => {
  const { event_type, title, description } = req.body || {};
  if (!title) return res.status(400).json({ success: false, message: 'Título requerido' });
  const r = await run('INSERT INTO project_events(project_id,user_id,event_type,title,description) VALUES(?,?,?,?,?)',
    [req.params.id, req.user.id, event_type || 'note', title, description || '']);
  res.json({ success: true, id: r.lastID });
});

export default router;
