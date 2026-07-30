import { Router } from 'express';
import { get, run } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { testEmailConnection, syncInbox, getInboxStatus } from '../services/email.js';
import { encryptField } from '../services/fieldCrypto.js';

const router = Router();
router.use(requireAuth);

/* ── Prueba REAL de conexión IMAP/SMTP (usa los valores del formulario;
     si la contraseña viene vacía se usa la guardada) ── */
router.post('/test', async (req, res) => {
  const saved = await get('SELECT * FROM user_email_config WHERE user_id=?', [req.user.id]);
  const cfg = { ...(saved || {}), ...(req.body || {}) };
  if (!cfg.email_password && saved?.email_password) cfg.email_password = saved.email_password;
  try {
    const result = await testEmailConnection(cfg);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/* ── Estado del buzón: total, importados y pendientes (en cola) sin importar ── */
router.get('/status', async (req, res) => {
  try {
    const data = await getInboxStatus(req.user.id);
    res.json({ success: true, data });
  } catch (err) {
    res.status(502).json({ success: false, message: err.responseText || err.message });
  }
});

/* ── Sincronización REAL del buzón IMAP ── */
router.post('/sync', async (req, res) => {
  try {
    // Sin límite por defecto: la sincronización manual trae todo el histórico pendiente.
    const result = await syncInbox(req.user.id, { limit: Number(req.body?.limit) || 0 });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(502).json({ success: false, message: err.responseText || err.message });
  }
});

router.get('/', async (req, res) => {
  const config = await get('SELECT * FROM user_email_config WHERE user_id=?', [req.user.id]);
  res.json({ success: true, data: config || null });
});

router.put('/', async (req, res) => {
  const { email_address, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, email_password, provider, is_active } = req.body || {};
  const ex = await get('SELECT id FROM user_email_config WHERE user_id=?', [req.user.id]);
  const values = [
    encryptField(email_address || ''), imap_host || '', imap_port || 993, imap_secure ? 1 : 0,
    smtp_host || '', smtp_port || 587, smtp_secure ? 1 : 0,
    encryptField(email_password || ''), provider || 'other', is_active ? 1 : 0,
  ];
  if (ex) {
    await run(`UPDATE user_email_config SET email_address=?,imap_host=?,imap_port=?,imap_secure=?,smtp_host=?,smtp_port=?,smtp_secure=?,
      email_password=?,provider=?,is_active=?,updated_at=SYSDATETIME() WHERE user_id=?`, [...values, req.user.id]);
  } else {
    await run(`INSERT INTO user_email_config(user_id,email_address,imap_host,imap_port,imap_secure,smtp_host,smtp_port,smtp_secure,email_password,provider,is_active)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`, [req.user.id, ...values]);
  }
  res.json({ success: true });
});

export default router;
