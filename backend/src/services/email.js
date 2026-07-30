import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, get, run } from '../db.js';
import { config } from '../config.js';
import { classifyCorrespondence } from './gemini.js';
import { encryptField, decryptField } from './fieldCrypto.js';

const ATTACHMENTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'storage', 'attachments');
fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });

const sanitizeFilename = name => String(name || 'adjunto').replace(/[^\w.\-áéíóúñÁÉÍÓÚÑ ]/g, '_').slice(0, 180);

const tlsOptions = config.emailAllowInvalidCerts ? { rejectUnauthorized: false } : {};

/** Agrega una pista útil cuando el antivirus intercepta el TLS de correo. */
function explainTlsError(message) {
  if (/unable to verify|self.signed|certificate/i.test(message)) {
    return `${message} — Un antivirus (ej. AVG/Avast Mail Shield) está interceptando la conexión de correo. Agregue una excepción en el antivirus o defina EMAIL_ALLOW_INVALID_CERTS=true en backend/.env (solo desarrollo).`;
  }
  return message;
}

function imapClient(cfg) {
  return new ImapFlow({
    host: cfg.imap_host,
    port: Number(cfg.imap_port) || 993,
    secure: !!cfg.imap_secure,
    auth: { user: cfg.email_address, pass: cfg.email_password },
    logger: false,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    tls: tlsOptions,
  });
}

function smtpTransport(cfg) {
  const port = Number(cfg.smtp_port) || 587;
  return nodemailer.createTransport({
    host: cfg.smtp_host,
    port,
    secure: port === 465, // 465 = TLS implícito; 587 = STARTTLS
    auth: { user: cfg.email_address, pass: cfg.email_password },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    tls: tlsOptions,
  });
}

/** Prueba real de IMAP y SMTP con la configuración dada (sin guardar). */
export async function testEmailConnection(cfg) {
  const result = { imap: { ok: false, message: '' }, smtp: { ok: false, message: '' } };

  if (!cfg.email_address || !cfg.email_password) {
    throw new Error('Correo y contraseña son requeridos para probar la conexión');
  }

  if (cfg.imap_host) {
    const client = imapClient(cfg);
    try {
      await client.connect();
      // readOnly (EXAMINE): nunca modifica el estado del buzón.
      const lock = await client.getMailboxLock('INBOX', { readOnly: true });
      const total = client.mailbox?.exists ?? 0;
      lock.release();
      await client.logout();
      result.imap = { ok: true, message: `Conexión IMAP exitosa a ${cfg.imap_host}:${cfg.imap_port}. Buzón INBOX con ${total} mensaje(s).` };
    } catch (err) {
      result.imap = { ok: false, message: `IMAP: ${explainTlsError(err.responseText || err.message)}` };
      try { await client.logout(); } catch { /* conexión ya cerrada */ }
    }
  } else {
    result.imap = { ok: false, message: 'IMAP: servidor no configurado' };
  }

  if (cfg.smtp_host) {
    try {
      await smtpTransport(cfg).verify();
      result.smtp = { ok: true, message: `Conexión SMTP exitosa a ${cfg.smtp_host}:${cfg.smtp_port}. Listo para enviar.` };
    } catch (err) {
      result.smtp = { ok: false, message: `SMTP: ${explainTlsError(err.response || err.message)}` };
    }
  } else {
    result.smtp = { ok: false, message: 'SMTP: servidor no configurado' };
  }

  return result;
}

/**
 * Sincroniza el buzón IMAP del usuario: importa los últimos mensajes de INBOX
 * como correspondencias (con clasificación Gemini si está activa).
 */
export async function syncInbox(userId, { limit = 0 } = {}) {
  const cfg = await get('SELECT * FROM user_email_config WHERE user_id=? AND is_active=1', [userId]);
  if (!cfg) throw new Error('No hay configuración de correo activa. Configure y active su cuenta primero.');
  if (!cfg.imap_host) throw new Error('Servidor IMAP no configurado.');

  const client = imapClient(cfg);
  let imported = 0, skipped = 0, classified = 0;
  // limit <= 0  → SIN LÍMITE: importa TODOS los correos históricos pendientes del buzón.
  const unlimited = !Number.isFinite(limit) || limit <= 0;

  await client.connect();
  try {
    // SOLO LECTURA: el buzón se abre con EXAMINE (readOnly), de modo que la
    // descarga del mensaje y sus adjuntos para análisis NUNCA marca \Seen ni
    // altera ningún estado del correo en el servidor.
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      const total = client.mailbox.exists;
      if (total === 0) return { imported, skipped, classified, total, pending: 0 };

      // 1) UID ya importados de este buzón (dedupe en memoria, una sola consulta).
      const existingRows = await all('SELECT imap_uid FROM correspondences WHERE to_user_id=? AND imap_uid IS NOT NULL', [userId]);
      const existing = new Set(existingRows.map(r => r.imap_uid));

      // 2) Listar TODOS los UID del buzón (barato: solo UID, sin descargar cuerpos).
      const allUids = [];
      for await (const m of client.fetch('1:*', { uid: true })) allUids.push(m.uid);
      allUids.sort((a, b) => a - b); // cronológico: primero los más antiguos (backfill del histórico).

      // 3) Pendientes = los que aún no están en la base.
      const pendingUids = allUids.filter(uid => !existing.has(`${cfg.email_address}:${uid}`));
      skipped = allUids.length - pendingUids.length;
      const toImport = unlimited ? pendingUids : pendingUids.slice(0, limit);

      // 4) Descargar e importar SOLO los pendientes, en lotes para no saturar memoria.
      const CHUNK = 200;
      for (let i = 0; i < toImport.length; i += CHUNK) {
        const range = toImport.slice(i, i + CHUNK).join(',');
        for await (const msg of client.fetch(range, { uid: true, source: true }, { uid: true })) {
          if (!msg.source) continue;
          const uidKey = `${cfg.email_address}:${msg.uid}`;
          const parsed = await simpleParser(msg.source);
          const subject = (parsed.subject || '(sin asunto)').slice(0, 290);
          const body = (parsed.text || parsed.html?.replace(/<[^>]+>/g, ' ') || '').slice(0, 100000);
          const fromText = (parsed.from?.text || 'Remitente desconocido').slice(0, 290);
          const attachments = (parsed.attachments || []).filter(a => a.content?.length);

          /* Clasificación con Gemini incluyendo el contenido de los adjuntos (PDF/imágenes) */
          let ai = null;
          try {
            ai = await classifyCorrespondence(subject, body,
              attachments.map(a => ({ buffer: a.content, contentType: a.contentType, filename: a.filename || 'adjunto' })));
            if (ai) classified++;
          } catch (err) {
            console.error('[email-sync] Clasificación Gemini falló:', err.message);
          }

          const r = await run(`INSERT INTO correspondences(subject,body,from_user_id,to_user_id,label,external_from,imap_uid,ai_category,ai_priority,ai_summary,created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
            [subject, body, null, userId, 'inbox', encryptField(fromText), uidKey,
             ai?.category || '', ai?.priority || '', ai?.summary || '',
             parsed.date ? parsed.date.toISOString().slice(0, 19).replace('T', ' ') : null]);

          /* Guardar adjuntos en disco y registrarlos */
          for (const a of attachments) {
            const safeName = sanitizeFilename(a.filename);
            const storedPath = path.join(ATTACHMENTS_DIR, `${r.lastID}_${Date.now()}_${safeName}`);
            fs.writeFileSync(storedPath, a.content);
            await run('INSERT INTO correspondence_attachments(correspondence_id,filename,content_type,size_bytes,stored_path) VALUES(?,?,?,?,?)',
              [r.lastID, safeName, (a.contentType || 'application/octet-stream').slice(0, 140), a.content.length, storedPath]);
          }
          imported++;
        }
      }
      await run('UPDATE user_email_config SET last_sync=SYSDATETIME() WHERE user_id=?', [userId]);
      return { imported, skipped, classified, total, pending: pendingUids.length - toImport.length };
    } finally {
      lock.release();
    }
  } finally {
    try { await client.logout(); } catch { /* conexión ya cerrada */ }
  }
}

/** Estado del buzón de un usuario: total en el servidor, ya importados y
    PENDIENTES (en cola). Solo lectura — no importa nada; se usa para el
    indicador de la bandeja de entrada. */
export async function getInboxStatus(userId) {
  const cfg = await get('SELECT * FROM user_email_config WHERE user_id=?', [userId]);
  if (!cfg) return { configured: false, active: false, total: 0, imported: 0, pending: 0, last_sync: null };
  const base = { configured: true, active: !!cfg.is_active, last_sync: cfg.last_sync || null };
  if (!cfg.is_active || !cfg.imap_host) return { ...base, total: 0, imported: 0, pending: 0 };

  const client = imapClient(cfg);
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      const total = client.mailbox.exists || 0;
      if (total === 0) return { ...base, total: 0, imported: 0, pending: 0 };
      const existingRows = await all('SELECT imap_uid FROM correspondences WHERE to_user_id=? AND imap_uid IS NOT NULL', [userId]);
      const existing = new Set(existingRows.map(r => r.imap_uid));
      let imported = 0;
      for await (const m of client.fetch('1:*', { uid: true })) {
        if (existing.has(`${cfg.email_address}:${m.uid}`)) imported++;
      }
      return { ...base, total, imported, pending: Math.max(0, total - imported) };
    } finally {
      lock.release();
    }
  } finally {
    try { await client.logout(); } catch { /* conexión ya cerrada */ }
  }
}

/** Sincroniza los buzones de todos los usuarios con configuración activa.
    Usado por el endpoint admin y por el programador automático. */
export async function syncAllInboxes({ limit = 0 } = {}) {
  const configs = await all(`SELECT ec.user_id, ec.email_address, u.name as user_name
    FROM user_email_config ec INNER JOIN users u ON ec.user_id=u.id
    WHERE ec.is_active=1 AND u.is_active=1 ORDER BY u.name`);
  const results = [];
  for (const cfg of configs) {
    try {
      const r = await syncInbox(cfg.user_id, { limit });
      results.push({ user_id: cfg.user_id, user_name: cfg.user_name, email: cfg.email_address, ok: true, ...r });
    } catch (err) {
      results.push({ user_id: cfg.user_id, user_name: cfg.user_name, email: cfg.email_address, ok: false, message: err.responseText || err.message });
    }
  }
  const totals = results.reduce((a, r) => ({
    imported: a.imported + (r.imported || 0),
    classified: a.classified + (r.classified || 0),
    failed: a.failed + (r.ok ? 0 : 1),
  }), { imported: 0, classified: 0, failed: 0 });
  return { results, totals, mailboxes: configs.length };
}

/** Envío de correo DESHABILITADO por diseño. El sistema es de solo lectura /
    consulta del correo: analiza los mensajes y adjuntos entrantes pero NUNCA
    envía correos ni altera el estado del buzón. Se conserva la firma exportada
    para no romper a quienes la importan. */
export async function sendExternalEmail() {
  throw new Error('Envío de correo deshabilitado: el sistema es de solo consulta (no envía ni modifica correos).');
}

/* ══════════════════════════════════════════════════════════════════
   Correo institucional "No-Reply" (transaccional del sistema)
   Se usa SOLO para correos que genera el propio sistema —p. ej. enviar
   una contraseña temporal al usuario— desde una cuenta configurada por
   el administrador. Es independiente del buzón IMAP de cada usuario.
   ══════════════════════════════════════════════════════════════════ */

/** Lee la configuración del correo no-reply (tabla settings). La contraseña
    se guarda cifrada; la capa de lectura la descifra (decryptField es idempotente). */
export async function getNoreplyConfig() {
  const rows = await all("SELECT [key], value FROM settings WHERE [key] LIKE 'noreply_%'");
  const s = {};
  rows.forEach(r => { s[r.key] = r.value; });
  return {
    host: s.noreply_smtp_host || '',
    port: Number(s.noreply_smtp_port) || 587,
    secure: s.noreply_smtp_secure === 'true',
    user: s.noreply_smtp_user || '',
    pass: decryptField(s.noreply_smtp_pass || ''),
    fromName: s.noreply_from_name || 'PGR Compras Públicas',
    fromEmail: s.noreply_from_email || s.noreply_smtp_user || '',
    enabled: s.noreply_enabled === 'true',
  };
}

function noreplyTransport(cfg) {
  const port = Number(cfg.port) || 587;
  return nodemailer.createTransport({
    host: cfg.host,
    port,
    secure: cfg.secure || port === 465, // 465 = TLS implícito; 587 = STARTTLS
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    tls: tlsOptions,
  });
}

/** Envía un correo transaccional del sistema desde la cuenta no-reply configurada. */
export async function sendSystemMail({ to, subject, text, html }) {
  const cfg = await getNoreplyConfig();
  if (!cfg.enabled) throw new Error('El correo no-reply no está activado. Configúrelo en Configuración → Correo No-Reply.');
  if (!cfg.host || !cfg.fromEmail) throw new Error('Falta configurar el servidor SMTP o el remitente del correo no-reply.');
  if (!to) throw new Error('El usuario no tiene correo registrado.');
  const from = cfg.fromName ? `"${cfg.fromName}" <${cfg.fromEmail}>` : cfg.fromEmail;
  const info = await noreplyTransport(cfg).sendMail({ from, to, subject, text, html, replyTo: cfg.fromEmail });
  return { messageId: info.messageId, accepted: info.accepted };
}

/** Envía un correo de prueba con la configuración dada (mezcla overrides del
    formulario con lo guardado). No exige que el no-reply esté activado. */
export async function sendNoreplyTest(override = {}, to) {
  const saved = await getNoreplyConfig();
  const cfg = {
    host: override.host ?? saved.host,
    port: Number(override.port) || saved.port,
    secure: override.secure !== undefined ? !!override.secure : saved.secure,
    user: override.user ?? saved.user,
    pass: override.pass ? override.pass : saved.pass, // si el form no trae clave, usa la guardada
    fromName: override.fromName ?? saved.fromName,
    fromEmail: override.fromEmail ?? saved.fromEmail,
  };
  if (!cfg.host || !cfg.fromEmail) throw new Error('Configure el servidor SMTP y el remitente antes de probar.');
  const dest = to || cfg.fromEmail;
  const from = cfg.fromName ? `"${cfg.fromName}" <${cfg.fromEmail}>` : cfg.fromEmail;
  await noreplyTransport(cfg).sendMail({
    from, to: dest,
    subject: 'Prueba de correo No-Reply — PGR Compras Públicas',
    text: 'Este es un correo de prueba del sistema PGR Compras Públicas. Si lo recibió, la configuración no-reply funciona correctamente.',
  });
  return { to: dest };
}

export async function getUsersDirectory() {
  return all(`SELECT u.id, u.name, u.email, u.role, un.name as unit_name
    FROM users u LEFT JOIN units un ON u.unit_id=un.id
    WHERE u.is_active=1 ORDER BY u.name`);
}
