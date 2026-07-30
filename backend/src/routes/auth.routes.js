import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { all, get, run } from '../db.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { auditFromReq } from '../services/audit.js';
import { encryptField } from '../services/fieldCrypto.js';

const router = Router();

router.post('/login', async (req, res) => {
  const { document_type, document_number, password } = req.body || {};
  if (!document_number || !password) {
    return res.status(400).json({ success: false, message: 'Documento y contraseña son requeridos' });
  }

  const failLogin = (status, message, reason) => {
    auditFromReq(req, 'LOGIN_FALLIDO', { entity: 'auth', success: false,
      details: { documento_intentado: String(document_number).slice(0, 20), motivo: reason } });
    return res.status(status).json({ success: false, message });
  };

  const user = await get('SELECT * FROM users WHERE document_number=? AND document_type=?',
    [String(document_number || ''), String(document_type || 'DUI')]);
  if (!user) return failLogin(401, 'Credenciales inválidas', 'documento no registrado');
  if (!user.is_active) return failLogin(403, 'Usuario inactivo', 'usuario inactivo');

  const ok = await bcrypt.compare(String(password || ''), user.password_hash);
  if (!ok) return failLogin(401, 'Credenciales inválidas', 'contraseña incorrecta');

  // identidad explícita: en el login req.user aún no existe
  auditFromReq(req, 'LOGIN_EXITOSO', { entity: 'auth', entityId: user.id,
    userId: user.id, userName: user.name, details: { rol: user.role } });

  const safe = {
    id: user.id, name: user.name, document_type: user.document_type,
    document_number: user.document_number, email: user.email, role: user.role, unit_id: user.unit_id,
    phone: user.phone || '', position: user.position || '',
    onboarding_done: !!user.onboarding_done,
    must_change_password: !!user.must_change_password,
  };
  res.json({ success: true, token: signToken(safe), user: safe });
});

router.post('/register', async (req, res) => {
  const { name, document_type, document_number, email, password, unit_id } = req.body || {};
  if (!name || !document_number || !password) {
    return res.status(400).json({ success: false, message: 'Nombre, documento y contraseña son requeridos' });
  }

  const ex = await get('SELECT id FROM users WHERE document_number=?', [document_number]);
  if (ex) return res.status(409).json({ success: false, message: 'Este documento ya está registrado' });

  const hash = await bcrypt.hash(password, 10);
  const r = await run(
    'INSERT INTO users(name,document_type,document_number,email,password_hash,role,unit_id,is_active) VALUES(?,?,?,?,?,?,?,1)',
    [name, document_type || 'DUI', String(document_number), encryptField(String(email || '')), hash, 'solicitante', unit_id || null]
  );
  res.json({ success: true, id: r.lastID });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await get(
    'SELECT id,name,document_type,document_number,email,phone,position,role,unit_id,is_active,onboarding_done,must_change_password,created_at FROM users WHERE id=?',
    [req.user.id]
  );
  if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
  res.json({ success: true, user });
});

/* ── Cambio de contraseña del propio usuario (obligatorio si es clave temporal) ── */
router.post('/change-password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ success: false, message: 'Contraseña actual y nueva son requeridas' });
  }
  if (new_password.length < 8 || !/[A-Za-z]/.test(new_password) || !/[0-9]/.test(new_password)) {
    return res.status(400).json({ success: false, message: 'La nueva contraseña debe tener al menos 8 caracteres e incluir letras y números' });
  }
  if (new_password === current_password) {
    return res.status(400).json({ success: false, message: 'La nueva contraseña debe ser diferente a la actual' });
  }
  const user = await get('SELECT id, password_hash FROM users WHERE id=?', [req.user.id]);
  const ok = await bcrypt.compare(String(current_password), user.password_hash);
  if (!ok) return res.status(401).json({ success: false, message: 'La contraseña actual no es correcta' });
  const hash = await bcrypt.hash(new_password, 10);
  await run('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?', [hash, req.user.id]);
  res.json({ success: true });
});

/* ── Actualizar el propio perfil (datos de contacto) ── */
router.put('/profile', requireAuth, async (req, res) => {
  const { email, phone } = req.body || {};
  await run('UPDATE users SET email=?, phone=? WHERE id=?',
    [encryptField(String(email || '').slice(0, 190)), String(phone || '').slice(0, 45), req.user.id]);
  res.json({ success: true });
});

/* ── Marca el asistente de bienvenida como completado u omitido ── */
router.post('/onboarding-done', requireAuth, async (req, res) => {
  await run('UPDATE users SET onboarding_done=1 WHERE id=?', [req.user.id]);
  res.json({ success: true });
});

export default router;
