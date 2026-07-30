import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { all, get, run } from '../db.js';
import { requireAuth, requireAdmin, requireSuperAdmin, signToken } from '../middleware/auth.js';
import { testConnection } from '../services/gemini.js';
import { syncAllInboxes, getNoreplyConfig, sendNoreplyTest, sendSystemMail } from '../services/email.js';
import { verifyChain, auditFromReq } from '../services/audit.js';
import { encryptField, decryptEmbedded } from '../services/fieldCrypto.js';

const router = Router();
router.use(requireAuth, requireAdmin);

/* Clave temporal legible: 3 sílabas + 3 dígitos + símbolo (≥8, letras y números). */
function genTempPassword() {
  const con = 'bcdfgmprstv', vow = 'aeiou';
  let p = '';
  for (let i = 0; i < 3; i++) p += con[Math.floor(Math.random() * con.length)] + vow[Math.floor(Math.random() * vow.length)];
  return p[0].toUpperCase() + p.slice(1) + Math.floor(100 + Math.random() * 900) + '!';
}

const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function passwordEmailText(name, pw) {
  return `Estimado/a ${name}:\n\nSe ha restablecido su contraseña de acceso al Sistema de Compras Públicas de la PGR (UACP).\n\nContraseña temporal: ${pw}\n\nPor seguridad, deberá cambiarla la primera vez que inicie sesión.\n\nEste es un mensaje automático, por favor no responda a este correo.\nProcuraduría General de la República — UACP`;
}
function passwordEmailHtml(name, pw) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;color:#0f172a">
    <h2 style="color:#1e40af;margin:0 0 12px">Restablecimiento de contraseña</h2>
    <p>Estimado/a <strong>${escapeHtml(name)}</strong>:</p>
    <p>Se ha restablecido su contraseña de acceso al <strong>Sistema de Compras Públicas de la PGR (UACP)</strong>.</p>
    <p style="margin:16px 0 6px">Contraseña temporal:</p>
    <p style="font-size:20px;font-weight:bold;background:#f1f5f9;padding:12px 18px;border-radius:8px;letter-spacing:1px;display:inline-block;margin:0">${escapeHtml(pw)}</p>
    <p style="margin-top:16px">Por seguridad, deberá cambiarla la primera vez que inicie sesión.</p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0"/>
    <p style="font-size:12px;color:#64748b">Este es un mensaje automático, por favor no responda. Procuraduría General de la República — UACP.</p>
  </div>`;
}

function welcomeEmailText(name, doc, pw) {
  return `Estimado/a ${name}:\n\nSe ha creado su cuenta en el Sistema de Compras Públicas de la PGR (UACP).\n\nIngrese con:\n  Documento: ${doc}\n  Contraseña temporal: ${pw}\n\nPor seguridad, deberá cambiar la contraseña la primera vez que inicie sesión.\n\nEste es un mensaje automático, por favor no responda a este correo.\nProcuraduría General de la República — UACP`;
}
function welcomeEmailHtml(name, doc, pw) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;color:#0f172a">
    <h2 style="color:#1e40af;margin:0 0 12px">Bienvenido/a al Sistema de Compras Públicas</h2>
    <p>Estimado/a <strong>${escapeHtml(name)}</strong>:</p>
    <p>Se ha creado su cuenta en el <strong>Sistema de Compras Públicas de la PGR (UACP)</strong>. Ingrese con las siguientes credenciales:</p>
    <table style="margin:12px 0;font-size:15px">
      <tr><td style="padding:4px 8px;color:#64748b">Documento:</td><td style="padding:4px 8px;font-weight:bold">${escapeHtml(doc)}</td></tr>
      <tr><td style="padding:4px 8px;color:#64748b">Contraseña temporal:</td><td style="padding:4px 8px"><span style="font-weight:bold;background:#f1f5f9;padding:6px 12px;border-radius:6px;letter-spacing:1px">${escapeHtml(pw)}</span></td></tr>
    </table>
    <p>Por seguridad, deberá cambiar la contraseña la primera vez que inicie sesión.</p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0"/>
    <p style="font-size:12px;color:#64748b">Este es un mensaje automático, por favor no responda. Procuraduría General de la República — UACP.</p>
  </div>`;
}

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
  // La bitácora guarda los correos cifrados; se descifran solo para el auditor
  // autorizado al mostrarlos. El row_hash se calculó sobre el dato cifrado, por
  // lo que la verificación de integridad (/audit/verify) no se ve afectada.
  for (const r of rows) r.details = decryptEmbedded(r.details);
  res.json({ success: true, data: { rows, total: total.c, limit, offset } });
});

/* Verificación de integridad de la cadena de hashes (anti-manipulación) */
router.get('/audit/verify', requireSuperAdmin, async (_req, res) => {
  const result = await verifyChain();
  res.json({ success: true, data: result });
});

/* ── Login como otro usuario (funcionalidad desactivada) ── */
router.post('/impersonate/:id', requireSuperAdmin, async (req, res) => {
  return res.status(403).json({ success: false, message: 'La función de iniciar sesión como otro usuario está desactivada' });
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

/* El admin crea la cuenta pero NO elige la clave: la genera el servidor y el
   usuario está obligado a cambiarla en su primer ingreso (must_change_password=1).
   Ver la nota de seguridad sobre credenciales en /users/:id/regenerate-password. */
router.post('/users', async (req, res) => {
  const { name, document_type, document_number, email, phone, position, role, unit_id } = req.body || {};
  if (!name || !document_number) {
    return res.status(400).json({ success: false, message: 'Nombre y documento son requeridos' });
  }
  if (req.body?.password) {
    return res.status(400).json({ success: false, message: 'La clave temporal la genera el sistema; no puede fijarse desde el panel' });
  }
  const ex = await get('SELECT id FROM users WHERE document_number=?', [document_number]);
  if (ex) return res.status(409).json({ success: false, message: 'Este documento ya está registrado' });
  const password = genTempPassword();
  const hash = await bcrypt.hash(password, 10);
  const r = await run(`INSERT INTO users(name,document_type,document_number,email,phone,position,password_hash,role,unit_id,is_active,must_change_password)
    VALUES(?,?,?,?,?,?,?,?,?,1,1)`,
    [name, document_type || 'DUI', String(document_number), encryptField(email || ''), phone || '', position || '', hash, role || 'solicitante', unit_id || null]);

  // Envía las credenciales iniciales al correo del usuario desde la cuenta no-reply.
  let emailed = false, message = '';
  if (email) {
    try {
      await sendSystemMail({
        to: email,
        subject: 'Bienvenido/a al Sistema de Compras Públicas — PGR',
        text: welcomeEmailText(name, String(document_number), password),
        html: welcomeEmailHtml(name, String(document_number), password),
      });
      emailed = true;
      message = `Credenciales enviadas a ${email}.`;
    } catch (err) {
      message = `Usuario creado, pero no se pudo enviar el correo: ${err.message}`;
    }
  } else {
    message = 'El usuario no tiene correo; entregue la clave manualmente.';
  }
  /* La clave solo vuelve al panel cuando NO pudo llegar al titular por correo.
     Es aceptable únicamente aquí: la cuenta acaba de nacer y todavía no tiene
     buzón configurado, así que no hay correspondencia que proteger — y sin este
     canal la cuenta quedaría inaccesible. En el reseteo (cuenta ya en uso) la
     clave NUNCA se devuelve. */
  res.json({
    success: true, id: r.lastID, must_change_password: true, emailed, email: email || '',
    temp_password: emailed ? undefined : password, message,
  });
});

/* Edición de datos del usuario. NO toca credenciales: fijar aquí una contraseña
   le daría al admin una credencial válida del titular y, con ella, acceso a su
   correo interno ya descifrado por la aplicación. El único camino de reseteo es
   /users/:id/regenerate-password. */
router.put('/users/:id', async (req, res) => {
  const { name, email, phone, position, role, unit_id, is_active } = req.body || {};
  if (!name) return res.status(400).json({ success: false, message: 'Nombre requerido' });
  if (req.body?.password) {
    return res.status(400).json({ success: false, message: 'Este formulario no cambia contraseñas. Use "Restablecer contraseña": la clave se envía solo al correo del titular.' });
  }
  const active = is_active !== undefined ? (is_active ? 1 : 0) : 1;
  await run('UPDATE users SET name=?,email=?,phone=?,position=?,role=?,unit_id=?,is_active=? WHERE id=?',
    [name, encryptField(email || ''), phone || '', position || '', role || 'solicitante', unit_id || null, active, req.params.id]);
  res.json({ success: true });
});

router.delete('/users/:id', async (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ success: false, message: 'No puedes desactivarte a ti mismo' });
  }
  await run('UPDATE users SET is_active=0 WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

/* ── Restablecer la contraseña de un usuario ─────────────────────────────────
   Solo el administrador general (requireSuperAdmin).

   La clave nueva viaja ÚNICAMENTE al buzón del titular: no se devuelve al panel
   ni se escribe en la bitácora. El motivo es el control de confidencialidad del
   correo interno — quien conozca una credencial válida puede iniciar sesión como
   el usuario y leer su correspondencia ya descifrada, que es justo lo que el
   cifrado en reposo protege. Por eso tampoco existe impersonación (ver arriba).

   Excepción acotada: si el usuario no tiene correo de contacto NI buzón
   configurado no hay correspondencia que proteger y la entrega en mano es el
   único canal posible; ahí sí se devuelve, y el evento queda marcado como tal
   en la bitácora. */
router.post('/users/:id/regenerate-password', requireSuperAdmin, async (req, res) => {
  const user = await get('SELECT id, name, email FROM users WHERE id=?', [req.params.id]);
  if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

  const mailbox = await get('SELECT id FROM user_email_config WHERE user_id=?', [req.params.id]);

  if (!user.email && mailbox) {
    return res.status(409).json({
      success: false,
      message: 'Este usuario tiene un buzón configurado pero no tiene correo de contacto registrado. Regístrele un correo antes de restablecer la clave: entregarla en mano daría acceso a su bandeja.',
    });
  }

  const tempPassword = genTempPassword();

  /* Sin correo y sin buzón: nada que proteger, entrega manual. */
  if (!user.email) {
    const hash = await bcrypt.hash(tempPassword, 10);
    await run('UPDATE users SET password_hash=?, must_change_password=1 WHERE id=?', [hash, req.params.id]);
    auditFromReq(req, 'Restablecer contraseña (entrega manual)', {
      entity: 'admin/users', entityId: String(req.params.id),
      details: { usuario_afectado: user.name, entrega: 'manual', motivo: 'sin correo de contacto ni buzón configurado' },
    });
    return res.json({
      success: true, emailed: false, email: '', temp_password: tempPassword,
      message: 'El usuario no tiene correo ni buzón; entregue la clave manualmente.',
    });
  }

  /* Se envía ANTES de persistir el hash: si el correo falla, el usuario conserva
     su clave actual en lugar de quedar bloqueado con una que nadie conoce. */
  try {
    await sendSystemMail({
      to: user.email,
      subject: 'Restablecimiento de contraseña — PGR Compras Públicas',
      text: passwordEmailText(user.name, tempPassword),
      html: passwordEmailHtml(user.name, tempPassword),
    });
  } catch (err) {
    return res.status(502).json({
      success: false,
      message: `No se pudo enviar la clave a ${user.email}: ${err.message}. La contraseña NO fue modificada; revise la configuración del correo no-reply y reintente.`,
    });
  }

  const hash = await bcrypt.hash(tempPassword, 10);
  await run('UPDATE users SET password_hash=?, must_change_password=1 WHERE id=?', [hash, req.params.id]);
  auditFromReq(req, 'Restablecer contraseña (enviada al titular)', {
    entity: 'admin/users', entityId: String(req.params.id),
    details: { usuario_afectado: user.name, entrega: 'correo del titular' },
  });

  res.json({
    success: true, emailed: true, email: user.email,
    message: `Clave temporal enviada a ${user.email}. Por seguridad no se muestra aquí.`,
  });
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
  // Las claves noreply_ (incluyen un secreto SMTP cifrado) se gestionan en su
  // propio endpoint; se excluyen de aquí para no filtrarlas ni sobrescribirlas.
  data.forEach(s => { if (!s.key.startsWith('noreply_')) obj[s.key] = s.value; });
  res.json({ success: true, data: obj });
});

router.put('/settings', requireSuperAdmin, async (req, res) => {
  const entries = Object.entries(req.body || {}).filter(([key]) => !key.startsWith('noreply_'));
  for (const [key, value] of entries) {
    const ex = await get('SELECT id FROM settings WHERE [key]=?', [key]);
    if (ex) await run('UPDATE settings SET value=?, updated_at=SYSDATETIME() WHERE [key]=?', [String(value), key]);
    else await run('INSERT INTO settings([key],value) VALUES(?,?)', [key, String(value)]);
  }
  res.json({ success: true });
});

/* ── Correo institucional No-Reply (envío de credenciales; solo admin general) ── */
router.get('/noreply-config', requireSuperAdmin, async (_req, res) => {
  const c = await getNoreplyConfig();
  res.json({ success: true, data: {
    smtp_host: c.host, smtp_port: c.port, smtp_secure: c.secure, smtp_user: c.user,
    from_name: c.fromName, from_email: c.fromEmail, enabled: c.enabled,
    has_password: !!c.pass, // nunca se devuelve la contraseña en claro
  }});
});

router.put('/noreply-config', requireSuperAdmin, async (req, res) => {
  const b = req.body || {};
  const kv = {
    noreply_smtp_host: String(b.smtp_host || ''),
    noreply_smtp_port: String(Number(b.smtp_port) || 587),
    noreply_smtp_secure: b.smtp_secure ? 'true' : 'false',
    noreply_smtp_user: String(b.smtp_user || ''),
    noreply_from_name: String(b.from_name || ''),
    noreply_from_email: String(b.from_email || ''),
    noreply_enabled: b.enabled ? 'true' : 'false',
  };
  // La contraseña solo se reescribe si se envía una nueva; se guarda CIFRADA.
  if (b.smtp_pass) kv.noreply_smtp_pass = encryptField(String(b.smtp_pass));
  for (const [key, value] of Object.entries(kv)) {
    const ex = await get('SELECT id FROM settings WHERE [key]=?', [key]);
    if (ex) await run('UPDATE settings SET value=?, updated_at=SYSDATETIME() WHERE [key]=?', [value, key]);
    else await run('INSERT INTO settings([key],value) VALUES(?,?)', [key, value]);
  }
  res.json({ success: true });
});

router.post('/noreply-config/test', requireSuperAdmin, async (req, res) => {
  const b = req.body || {};
  try {
    const r = await sendNoreplyTest({
      host: b.smtp_host, port: b.smtp_port, secure: b.smtp_secure,
      user: b.smtp_user, pass: b.smtp_pass, fromName: b.from_name, fromEmail: b.from_email,
    }, b.to);
    res.json({ success: true, message: `Correo de prueba enviado a ${r.to}.` });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
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
