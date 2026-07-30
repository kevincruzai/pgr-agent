import { Router } from 'express';
import { all, get, run } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

export const categoriesRouter = Router();

categoriesRouter.get('/', async (_req, res) => {
  const data = await all('SELECT * FROM categories ORDER BY name');
  res.json({ success: true, data });
});

/* ── Directorio de usuarios activos (para seleccionar destinatarios) ── */
export const usersRouter = Router();

usersRouter.get('/directory', requireAuth, async (_req, res) => {
  const data = await all(`SELECT u.id, u.name, u.email, u.phone, u.position, u.role, un.name as unit_name
    FROM users u LEFT JOIN units un ON u.unit_id=un.id
    WHERE u.is_active=1 ORDER BY u.name`);
  res.json({ success: true, data });
});

export const unitsRouter = Router();

unitsRouter.get('/', async (_req, res) => {
  const data = await all('SELECT * FROM units WHERE is_active=1 ORDER BY name');
  res.json({ success: true, data });
});

unitsRouter.get('/all', requireAuth, async (_req, res) => {
  const data = await all('SELECT * FROM units ORDER BY name');
  res.json({ success: true, data });
});

unitsRouter.get('/:id', requireAuth, async (req, res) => {
  const u = await get('SELECT * FROM units WHERE id=?', [req.params.id]);
  if (!u) return res.status(404).json({ success: false, message: 'Unidad no encontrada' });
  res.json({ success: true, data: u });
});

unitsRouter.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { name, code, description, responsible_name, email, phone } = req.body || {};
  if (!name || !code) return res.status(400).json({ success: false, message: 'Nombre y código son requeridos' });
  const ex = await get('SELECT id FROM units WHERE code=?', [code]);
  if (ex) return res.status(409).json({ success: false, message: 'El código ya existe' });
  const r = await run('INSERT INTO units(name,code,description,responsible_name,email,phone) VALUES(?,?,?,?,?,?)',
    [name, code, description || '', responsible_name || '', email || '', phone || '']);
  res.json({ success: true, id: r.lastID });
});

unitsRouter.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { name, code, description, responsible_name, email, phone, is_active } = req.body || {};
  if (!name || !code) return res.status(400).json({ success: false, message: 'Nombre y código son requeridos' });
  const ex = await get('SELECT id FROM units WHERE code=? AND id!=?', [code, req.params.id]);
  if (ex) return res.status(409).json({ success: false, message: 'El código ya existe en otra unidad' });
  await run('UPDATE units SET name=?,code=?,description=?,responsible_name=?,email=?,phone=?,is_active=? WHERE id=?',
    [name, code, description || '', responsible_name || '', email || '', phone || '', is_active !== undefined ? (is_active ? 1 : 0) : 1, req.params.id]);
  res.json({ success: true });
});

unitsRouter.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  await run('UPDATE units SET is_active=0 WHERE id=?', [req.params.id]);
  res.json({ success: true });
});
