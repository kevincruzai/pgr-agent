import { Router } from 'express';
import fs from 'node:fs';
import { all, get, run } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { classifyCorrespondence, analyzeThread } from '../services/gemini.js';
import { auditFromReq } from '../services/audit.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { label, is_starred, search } = req.query;
  // Paginación tipo Gmail: page (1..N) y pageSize (1..100, default 25).
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 25));
  const offset = (page - 1) * pageSize;

  let where = ' WHERE c.to_user_id=?';
  const params = [req.user.id];
  if (label && label !== 'all') { where += ' AND c.label=?'; params.push(label); }
  if (is_starred === '1') { where += ' AND c.is_starred=1'; }
  if (search) { where += ' AND (c.subject LIKE ? OR c.body LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (label !== 'archived') { where += ' AND c.is_archived=0'; }

  const totalRow = await get(`SELECT COUNT(*) as total FROM correspondences c${where}`, params);
  const total = totalRow.total;

  const sql = `SELECT c.*, COALESCE(u.name, c.external_from) as from_name, p.title as project_title
    FROM correspondences c
    LEFT JOIN users u ON c.from_user_id=u.id
    LEFT JOIN projects p ON c.project_id=p.id${where}
    ORDER BY c.created_at DESC
    OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`;
  const data = await all(sql, [...params, offset, pageSize]);
  res.json({ success: true, data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
});

/* ── Correspondencia agrupada por proyecto (vista de hilos IA) ── */
router.get('/by-project', async (req, res) => {
  const corrs = await all(`SELECT c.*, COALESCE(u.name, c.external_from) as from_name, p.title as project_title, p.status as project_status,
    p.priority as project_priority, cat.name as category_name, cat.color as category_color
    FROM correspondences c
    LEFT JOIN users u ON c.from_user_id=u.id
    LEFT JOIN projects p ON c.project_id=p.id
    LEFT JOIN categories cat ON p.category_id=cat.id
    WHERE (c.to_user_id=? OR c.from_user_id=?) AND c.is_archived=0
    ORDER BY c.created_at DESC`, [req.user.id, req.user.id]);

  const grouped = {};
  const ungrouped = [];
  for (const c of corrs) {
    if (c.project_id) {
      if (!grouped[c.project_id]) grouped[c.project_id] = {
        project_id: c.project_id, project_title: c.project_title, project_status: c.project_status,
        project_priority: c.project_priority, category_name: c.category_name, category_color: c.category_color,
        messages: [], unread_count: 0, latest_at: c.created_at,
      };
      grouped[c.project_id].messages.push(c);
      if (!c.is_read && c.to_user_id === req.user.id) grouped[c.project_id].unread_count++;
    } else {
      ungrouped.push(c);
    }
  }

  const threads = Object.values(grouped).sort((a, b) => new Date(b.latest_at) - new Date(a.latest_at));
  res.json({ success: true, data: { threads, ungrouped } });
});

/* ── Análisis IA real de una cadena de proyecto (incluye documentos adjuntos y estado sugerido) ── */
router.post('/by-project/:projectId/analyze', async (req, res) => {
  const project = await get('SELECT id, title, status FROM projects WHERE id=?', [req.params.projectId]);
  if (!project) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
  const messages = await all(`SELECT c.id, c.subject, c.body, c.created_at, c.external_from, u.name as from_name
    FROM correspondences c LEFT JOIN users u ON c.from_user_id=u.id
    WHERE c.project_id=? ORDER BY c.created_at ASC`, [req.params.projectId]);
  if (!messages.length) return res.status(400).json({ success: false, message: 'La cadena no tiene mensajes para analizar' });

  /* Adjuntos más recientes de la cadena (los archivos se leen del almacenamiento local) */
  const ids = messages.map(m => m.id);
  const attRows = await all(`SELECT TOP 6 * FROM correspondence_attachments
    WHERE correspondence_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at DESC`, ids);
  const attachments = [];
  for (const a of attRows) {
    try {
      attachments.push({ buffer: fs.readFileSync(a.stored_path), contentType: a.content_type, filename: a.filename });
    } catch { /* archivo no disponible en disco */ }
  }

  try {
    const analysis = await analyzeThread(project.title, messages, attachments, project.status);
    if (!analysis) return res.status(400).json({ success: false, message: 'Gemini no está activado. Configure la API Key en Configuración → Gemini Pro API.' });
    res.json({ success: true, data: { ...analysis, current_recorded_status: project.status, attachments_analyzed: attachments.length } });
  } catch (err) {
    res.status(502).json({ success: false, message: err.message });
  }
});

/* ── Adjuntos de una correspondencia ── */
async function canAccessCorrespondence(req, corrId) {
  const c = await get('SELECT id, to_user_id, from_user_id FROM correspondences WHERE id=?', [corrId]);
  if (!c) return null;
  const isOwner = c.to_user_id === req.user.id || c.from_user_id === req.user.id;
  const isAdmin = ['admin', 'jefe_uacp'].includes(req.user.role);
  return (isOwner || isAdmin) ? c : false;
}

router.get('/:id/attachments', async (req, res) => {
  const c = await canAccessCorrespondence(req, req.params.id);
  if (c === null) return res.status(404).json({ success: false, message: 'Correspondencia no encontrada' });
  if (c === false) return res.status(403).json({ success: false, message: 'Acceso denegado' });
  const data = await all('SELECT id, filename, content_type, size_bytes, created_at FROM correspondence_attachments WHERE correspondence_id=? ORDER BY id', [req.params.id]);
  res.json({ success: true, data });
});

router.get('/:id/attachments/:attId/download', async (req, res) => {
  const c = await canAccessCorrespondence(req, req.params.id);
  if (c === null) return res.status(404).json({ success: false, message: 'Correspondencia no encontrada' });
  if (c === false) return res.status(403).json({ success: false, message: 'Acceso denegado' });
  const a = await get('SELECT * FROM correspondence_attachments WHERE id=? AND correspondence_id=?', [req.params.attId, req.params.id]);
  if (!a) return res.status(404).json({ success: false, message: 'Adjunto no encontrado' });
  if (!fs.existsSync(a.stored_path)) return res.status(410).json({ success: false, message: 'El archivo ya no está disponible en el servidor' });
  /* Acceso a documentos: queda en la bitácora de auditoría */
  auditFromReq(req, 'DESCARGA_ADJUNTO', { entity: 'correspondences', entityId: req.params.id,
    details: { adjunto_id: a.id, archivo: a.filename, bytes: Number(a.size_bytes) } });
  res.setHeader('Content-Type', a.content_type);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(a.filename)}"`);
  fs.createReadStream(a.stored_path).pipe(res);
});

router.get('/:id', async (req, res) => {
  const c = await get(`SELECT c.*, COALESCE(u.name, c.external_from) as from_name, p.title as project_title
    FROM correspondences c LEFT JOIN users u ON c.from_user_id=u.id LEFT JOIN projects p ON c.project_id=p.id
    WHERE c.id=? AND (c.to_user_id=? OR c.from_user_id=?)`, [req.params.id, req.user.id, req.user.id]);
  if (!c) return res.status(404).json({ success: false, message: 'Correspondencia no encontrada' });
  if (c.to_user_id === req.user.id && !c.is_read) {
    await run('UPDATE correspondences SET is_read=1 WHERE id=?', [c.id]);
    c.is_read = true;
  }
  res.json({ success: true, data: c });
});

router.post('/', async (req, res) => {
  const { subject, body, to_user_id, project_id, send_external } = req.body || {};
  if (!subject) return res.status(400).json({ success: false, message: 'Asunto requerido' });
  if (!to_user_id) return res.status(400).json({ success: false, message: 'Destinatario requerido' });

  const recipient = await get('SELECT id, name, email FROM users WHERE id=? AND is_active=1', [to_user_id]);
  if (!recipient) return res.status(404).json({ success: false, message: 'Destinatario no encontrado o inactivo' });

  /* Clasificación IA real (si Gemini está activo); el envío no falla si la IA falla */
  let ai = null;
  try {
    ai = await classifyCorrespondence(subject, body || '');
  } catch (err) {
    console.error('[correspondences] Clasificación Gemini falló:', err.message);
  }

  const r = await run(`INSERT INTO correspondences(subject,body,from_user_id,to_user_id,project_id,label,ai_category,ai_priority,ai_summary)
    VALUES(?,?,?,?,?,?,?,?,?)`,
    [subject, body || '', req.user.id, recipient.id, project_id || null, 'inbox',
     ai?.category || '', ai?.priority || '', ai?.summary || '']);

  /* Envío SMTP externo DESHABILITADO: el sistema es de solo consulta del correo
     y no debe enviar ni alterar correos. La correspondencia interna sí se
     registra arriba; solo se omite la salida por SMTP. */
  const external = send_external
    ? { ok: false, message: 'El envío de correo externo está deshabilitado: el sistema es de solo consulta.' }
    : null;

  res.json({ success: true, id: r.lastID, ai, external });
});

router.put('/:id/star', async (req, res) => {
  await run('UPDATE correspondences SET is_starred = ~is_starred WHERE id=? AND to_user_id=?', [req.params.id, req.user.id]);
  res.json({ success: true });
});

router.put('/:id/read', async (req, res) => {
  await run('UPDATE correspondences SET is_read=1 WHERE id=? AND to_user_id=?', [req.params.id, req.user.id]);
  res.json({ success: true });
});

router.put('/:id/archive', async (req, res) => {
  await run('UPDATE correspondences SET is_archived=1 WHERE id=? AND to_user_id=?', [req.params.id, req.user.id]);
  res.json({ success: true });
});

export default router;
