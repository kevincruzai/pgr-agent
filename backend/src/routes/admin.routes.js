import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { all, get, run } from '../db.js';
import { requireAuth, requireAdmin, requireSuperAdmin, signToken } from '../middleware/auth.js';
import { testConnection } from '../services/gemini.js';
import { syncAllInboxes } from '../services/email.js';
import { verifyChain } from '../services/audit.js';

const router = Router();
router.use(requireAuth, requireAdmin);

/* ── Bitácora de auditoría (solo administrador general) ── */
router.get('/audit', requireSuperAdmin, async (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const where = [];
  const params = [];
  if (req.query.q) { where.push('(action LIKE ? OR user_name LIKE ? OR entity LIKE ?)'); const v = `%${req.query.q}%`; params.push(v, v, v); }
  if (req.query.user_id) { where.push('user_id=?'); params.push(Number(req.query.user_id)); }
  if (req.query.only_failures === '1') { where.push('success=0'); }
  if (req.query.from) { where.push('event_time >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('event_time < DATEADD(day, 1, CAST(? AS DATE))'); params.push(req.query.to); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = await get(`SELECT COUNT(*) as c FROM audit_log ${whereSql}`, params);
  const rows = await all(`SELECT id, event_time, user_id, user_name, impersonated_by, action, entity, entity_id,
      details, success, ip, row_hash
    FROM audit_log ${whereSql} ORDER BY id DESC OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`, params);
  res.json({ success: true, data: { rows, total: total.c, limit, offset } });
});

/* Verificación de integridad de la cadena de hashes (anti-manipulación) */
router.get('/audit/verify', requireSuperAdmin, async (_req, res) => {
  const result = await verifyChain();
  res.json({ success: true, data: result });
});

/* ── Login como otro usuario (solo administrador general) ── */
router.post('/impersonate/:id', requireSuperAdmin, async (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ success: false, message: 'Ya está en su propia sesión' });
  }
  const target = await get('SELECT id,name,document_type,document_number,email,role,unit_id,is_active FROM users WHERE id=?', [req.params.id]);
  if (!target) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
  if (!target.is_active) return res.status(400).json({ success: false, message: 'El usuario está inactivo' });
  const token = signToken(target, { impersonated_by: req.user.id, impersonated_by_name: req.user.name });
  res.json({ success: true, token, user: target });
});

/* ── Prueba REAL de conexión con Gemini (acepta key/modelo sin guardar; solo admin general) ── */
router.post('/gemini/test', requireSuperAdmin, async (req, res) => {
  const { gemini_api_key, gemini_model } = req.body || {};
  try {
    const result = await testConnection({ apiKey: gemini_api_key, model: gemini_model });
    res.json({ success: true, message: `Conexión exitosa con Gemini. Modelo: ${result.model}. Latencia: ${result.latencyMs}ms. Respuesta: "${result.reply}"` });
  } catch (err) {
    res.status(502).json({ success: false, message: err.message });
  }
});

/* ── Usuarios ── */
router.get('/users', async (_req, res) => {
  const users = await all(`SELECT u.id,u.name,u.document_type,u.document_number,u.email,u.phone,u.position,u.role,u.unit_id,u.is_active,u.must_change_password,u.created_at, un.name as unit_name
    FROM users u LEFT JOIN units un ON u.unit_id=un.id ORDER BY u.created_at DESC`);
  res.json({ success: true, data: users });
});

/* El admin crea la cuenta con una CLAVE TEMPORAL: el usuario está obligado
   a cambiarla en su primer ingreso (must_change_password=1). */
router.post('/users', async (req, res) => {
  const { name, document_type, document_number, email, phone, position, password, role, unit_id } = req.body || {};
  if (!name || !document_number || !password) {
    return res.status(400).json({ success: false, message: 'Nombre, documento y contraseña temporal son requeridos' });
  }
  if (password.length < 8) {
    return res.status(400).json({ success: false, message: 'La contraseña temporal debe tener al menos 8 caracteres' });
  }
  const ex = await get('SELECT id FROM users WHERE document_number=?', [document_number]);
  if (ex) return res.status(409).json({ success: false, message: 'Este documento ya está registrado' });
  const hash = await bcrypt.hash(password, 10);
  const r = await run(`INSERT INTO users(name,document_type,document_number,email,phone,position,password_hash,role,unit_id,is_active,must_change_password)
    VALUES(?,?,?,?,?,?,?,?,?,1,1)`,
    [name, document_type || 'DUI', String(document_number), email || '', phone || '', position || '', hash, role || 'solicitante', unit_id || null]);
  res.json({ success: true, id: r.lastID, must_change_password: true });
});

router.put('/users/:id', async (req, res) => {
  const { name, email, phone, position, role, unit_id, is_active, password } = req.body || {};
  if (!name) return res.status(400).json({ success: false, message: 'Nombre requerido' });
  const active = is_active !== undefined ? (is_active ? 1 : 0) : 1;
  if (password && password.length >= 8) {
    /* Reseteo de clave por el admin → vuelve a ser temporal */
    const hash = await bcrypt.hash(password, 10);
    await run('UPDATE users SET name=?,email=?,phone=?,position=?,role=?,unit_id=?,is_active=?,password_hash=?,must_change_password=1 WHERE id=?',
      [name, email || '', phone || '', position || '', role || 'solicitante', unit_id || null, active, hash, req.params.id]);
  } else {
    await run('UPDATE users SET name=?,email=?,phone=?,position=?,role=?,unit_id=?,is_active=? WHERE id=?',
      [name, email || '', phone || '', position || '', role || 'solicitante', unit_id || null, active, req.params.id]);
  }
  res.json({ success: true });
});

router.delete('/users/:id', async (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ success: false, message: 'No puedes desactivarte a ti mismo' });
  }
  await run('UPDATE users SET is_active=0 WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

/* ── Escaneo manual de vencimientos (genera alertas + análisis IA) ── */
router.post('/alerts/scan', async (_req, res) => {
  const { scanDeadlines } = await import('../services/alertScanner.js');
  const result = await scanDeadlines();
  res.json({ success: true, data: result });
});

/* ── Gestión de alertas ── */
router.get('/alerts', async (_req, res) => {
  const data = await all(`SELECT a.*, p.title as project_title, u.name as user_name
    FROM alerts a LEFT JOIN projects p ON a.project_id=p.id LEFT JOIN users u ON a.user_id=u.id
    ORDER BY a.created_at DESC`);
  res.json({ success: true, data });
});

router.post('/alerts', async (req, res) => {
  const { project_id, user_id, type, title, message, trigger_date } = req.body || {};
  if (!title) return res.status(400).json({ success: false, message: 'Título requerido' });
  const r = await run('INSERT INTO alerts(project_id,user_id,type,title,message,trigger_date) VALUES(?,?,?,?,?,?)',
    [project_id || null, user_id || null, type || 'info', title, message || '', trigger_date || null]);
  res.json({ success: true, id: r.lastID });
});

router.put('/alerts/:id', async (req, res) => {
  const { type, title, message, trigger_date } = req.body || {};
  await run('UPDATE alerts SET type=?,title=?,message=?,trigger_date=? WHERE id=?',
    [type || 'info', title || '', message || '', trigger_date || null, req.params.id]);
  res.json({ success: true });
});

router.delete('/alerts/:id', async (req, res) => {
  await run('DELETE FROM alerts WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

/* ── Configuración del sistema (solo admin general: incluye API keys y auto-sync) ── */
router.get('/settings', requireSuperAdmin, async (_req, res) => {
  const data = await all('SELECT * FROM settings ORDER BY [key]');
  const obj = {};
  data.forEach(s => { obj[s.key] = s.value; });
  res.json({ success: true, data: obj });
});

router.put('/settings', requireSuperAdmin, async (req, res) => {
  const entries = Object.entries(req.body || {});
  for (const [key, value] of entries) {
    const ex = await get('SELECT id FROM settings WHERE [key]=?', [key]);
    if (ex) await run('UPDATE settings SET value=?, updated_at=SYSDATETIME() WHERE [key]=?', [String(value), key]);
    else await run('INSERT INTO settings([key],value) VALUES(?,?)', [key, String(value)]);
  }
  res.json({ success: true });
});

/* ── Configuraciones de correo de todos los usuarios ── */
router.get('/email-configs', async (_req, res) => {
  const data = await all(`SELECT ec.*, u.name as user_name, u.email as user_email, u.role
    FROM user_email_config ec LEFT JOIN users u ON ec.user_id=u.id ORDER BY u.name`);
  res.json({ success: true, data });
});

/* ── Sincronizar los buzones de TODA la unidad (cada correo cae en el perfil de su dueño) ── */
router.post('/email-sync-all', async (req, res) => {
  const { results, totals, mailboxes } = await syncAllInboxes({ limit: Number(req.body?.limit) || 0 });
  if (!mailboxes) {
    return res.status(400).json({ success: false, message: 'Ningún usuario tiene configuración de correo activa.' });
  }
  res.json({ success: true, data: { results, totals } });
});

/* ── Seguimiento general: estado de cada proyecto de la unidad ── */
router.get('/projects/overview', async (_req, res) => {
  const projects = await all(`SELECT p.id, p.title, p.status, p.priority, p.budget_estimated,
      p.start_date, p.end_date, p.deadline, p.created_at, p.updated_at,
      c.name as category_name, c.color as category_color,
      u.name as unit_name, asgn.name as assigned_name, creator.name as created_by_name,
      (SELECT COUNT(*) FROM project_events pe WHERE pe.project_id=p.id) as events_count,
      (SELECT COUNT(*) FROM correspondences co WHERE co.project_id=p.id) as correspondences_count,
      (SELECT COUNT(*) FROM alerts a WHERE a.project_id=p.id AND a.is_read=0) as open_alerts,
      (SELECT TOP 1 pe.title FROM project_events pe WHERE pe.project_id=p.id ORDER BY pe.created_at DESC) as last_event_title,
      (SELECT TOP 1 pe.created_at FROM project_events pe WHERE pe.project_id=p.id ORDER BY pe.created_at DESC) as last_event_at,
      (SELECT TOP 1 usr.name FROM project_events pe LEFT JOIN users usr ON pe.user_id=usr.id WHERE pe.project_id=p.id ORDER BY pe.created_at DESC) as last_event_by
    FROM projects p
    LEFT JOIN categories c ON p.category_id=c.id
    LEFT JOIN units u ON p.unit_id=u.id
    LEFT JOIN users asgn ON p.assigned_to=asgn.id
    LEFT JOIN users creator ON p.created_by=creator.id
    ORDER BY p.updated_at DESC`);
  const byStatus = await all('SELECT status, COUNT(*) as count FROM projects GROUP BY status');
  res.json({ success: true, data: { projects, byStatus } });
});

export default router;
