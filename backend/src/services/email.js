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
  const client = new ImapFlow({
    host: cfg.imap_host,
    port: Number(cfg.imap_port) || 993,
    secure: !!cfg.imap_secure,
    auth: { user: cfg.email_address, pass: cfg.email_password },
    logger: false,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    tls: tlsOptions,
  });
  /* Imprescindible: ImapFlow es un EventEmitter y un corte de la conexión TLS
     (ECONNRESET típico tras un rato inactivo) emite 'error' FUERA del await. Sin
     este listener Node lo trata como excepción no capturada y tumba el proceso
     entero — incluido el servidor web. El try/catch de syncInbox no alcanza a
     verlo porque no ocurre dentro de la promesa que se está esperando.
     Aquí solo se registra: la operación en curso falla por su propia vía. */
  client.on('error', err =>
    console.error(`[email-sync] Conexión IMAP de ${cfg.email_address} interrumpida: ${err.message}`));
  return client;
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

/* Topes de un ciclo de sincronización. La descarga IMAP y el análisis con IA se
   hacen en FASES SEPARADAS (ver syncInbox), así que estos límites acotan cuánto
   se sostiene en memoria por ciclo; lo que sobra queda "pendiente" y entra en el
   siguiente ciclo del programador automático. */
const MAX_MESSAGES_PER_RUN = 150;
const MAX_DOWNLOAD_BYTES = 150 * 1024 * 1024;
/* Clasificaciones IA simultáneas. Secuencial, 150 correos × ~3 s tardaba más de
   lo que cualquier servidor IMAP mantiene viva una sesión. */
const AI_CONCURRENCY = 4;

/* Un buzón, UNA sincronización a la vez. El botón "Sincronizar" de la bandeja y
   el programador automático llaman a syncInbox por su cuenta; sin este candado
   ambos leían la MISMA lista de UID pendientes al arrancar y terminaban
   insertando los mismos correos dos veces. */
const inFlight = new Set();
export const SYNC_IN_PROGRESS = 'SYNC_IN_PROGRESS';

/** Ejecuta `fn` sobre `items` con como máximo `n` en vuelo, conservando el orden del resultado. */
async function mapWithConcurrency(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Sincroniza el buzón IMAP del usuario: importa los mensajes de INBOX como
 * correspondencias (con clasificación Gemini si está activa).
 *
 * Va en DOS FASES a propósito:
 *   Fase 1 — descarga IMAP pura (sin ninguna llamada externa de por medio) y
 *            cierre inmediato de la sesión.
 *   Fase 2 — parseo, clasificación con IA e inserción, ya con la conexión IMAP
 *            cerrada.
 * Antes la llamada a Gemini se hacía DENTRO del `for await` sobre el stream
 * IMAP abierto: el servidor de correo veía una sesión que tardaba minutos en
 * consumir el fetch y la cortaba ("Connection not available"), tumbando el ciclo
 * completo sin importar nada.
 */
export async function syncInbox(userId, { limit = 0 } = {}) {
  if (inFlight.has(userId)) {
    const err = new Error('Ya hay una sincronización en curso para este buzón; espere a que termine.');
    err.code = SYNC_IN_PROGRESS;
    throw err;
  }
  inFlight.add(userId);
  try {
    return await syncInboxLocked(userId, limit);
  } finally {
    inFlight.delete(userId);
  }
}

async function syncInboxLocked(userId, limit) {
  const cfg = await get('SELECT * FROM user_email_config WHERE user_id=? AND is_active=1', [userId]);
  if (!cfg) throw new Error('No hay configuración de correo activa. Configure y active su cuenta primero.');
  if (!cfg.imap_host) throw new Error('Servidor IMAP no configurado.');

  const client = imapClient(cfg);
  let imported = 0, skipped = 0, classified = 0, total = 0, pending = 0;
  // limit <= 0 → sin límite pedido por quien llama; aun así se respeta el tope
  // por ciclo (MAX_MESSAGES_PER_RUN) y el resto queda en cola.
  const unlimited = !Number.isFinite(limit) || limit <= 0;
  const perRun = unlimited ? MAX_MESSAGES_PER_RUN : Math.min(limit, MAX_MESSAGES_PER_RUN);

  /* ── Fase 1: descarga (solo IMAP, sin llamadas a la IA) ── */
  const downloaded = [];
  await client.connect();
  try {
    // SOLO LECTURA: el buzón se abre con EXAMINE (readOnly), de modo que la
    // descarga del mensaje y sus adjuntos para análisis NUNCA marca \Seen ni
    // altera ningún estado del correo en el servidor.
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      total = client.mailbox.exists;
      if (total === 0) return { imported, skipped, classified, total, pending: 0 };

      // 1) UID ya importados de este buzón (dedupe en memoria, una sola consulta).
      const existingRows = await all('SELECT imap_uid FROM correspondences WHERE to_user_id=? AND imap_uid IS NOT NULL', [userId]);
      const existing = new Set(existingRows.map(r => r.imap_uid));

      // 2) Listar TODOS los UID del buzón (barato: solo UID, sin descargar cuerpos).
      const allUids = [];
      for await (const m of client.fetch('1:*', { uid: true })) allUids.push(m.uid);
      /* MÁS RECIENTES PRIMERO. El UID de IMAP crece con cada mensaje que llega,
         así que orden descendente = correo nuevo primero, histórico después.
         Con el orden ascendente (backfill puro) un buzón de miles de mensajes
         tardaba días en llegar a lo reciente: la bandeja se llenaba de correos
         de hace tres años y el usuario no veía NUNCA lo que acababa de recibir,
         que es justo lo que se muestra en la página 1 (ORDER BY created_at DESC). */
      allUids.sort((a, b) => b - a);

      // 3) Pendientes = los que aún no están en la base.
      const pendingUids = allUids.filter(uid => !existing.has(`${cfg.email_address}:${uid}`));
      skipped = allUids.length - pendingUids.length;
      /* El lote se toma —y se descarga— por el extremo más reciente: si se
         alcanza el tope de bytes, lo que se queda fuera es lo más antiguo. */
      const toDownload = pendingUids.slice(0, perRun);

      // 4) Bajar el lote a memoria lo más rápido posible; el tope de bytes evita
      //    que un buzón con adjuntos pesados agote la RAM del servidor.
      let bytes = 0;
      const CHUNK = 50;
      outer:
      for (let i = 0; i < toDownload.length; i += CHUNK) {
        const range = toDownload.slice(i, i + CHUNK).join(',');
        for await (const msg of client.fetch(range, { uid: true, source: true }, { uid: true })) {
          if (!msg.source) continue;
          downloaded.push({ uid: msg.uid, source: msg.source });
          bytes += msg.source.length;
          if (bytes >= MAX_DOWNLOAD_BYTES) break outer;
        }
      }
      pending = pendingUids.length - downloaded.length;
    } finally {
      lock.release();
    }
  } finally {
    // Se cierra ANTES de analizar: la IA nunca retiene la sesión IMAP.
    try { await client.logout(); } catch { /* conexión ya cerrada */ }
  }

  /* ── Fase 2: parseo + clasificación IA + inserción (sin conexión IMAP) ── */
  // Ya descargado, se vuelve al orden cronológico para insertar en serie.
  downloaded.sort((a, b) => a.uid - b.uid);
  const SUB_BATCH = 8; // acota cuántos mensajes parseados coexisten en memoria
  for (let i = 0; i < downloaded.length; i += SUB_BATCH) {
    const slice = downloaded.slice(i, i + SUB_BATCH);

    const prepared = await mapWithConcurrency(slice, AI_CONCURRENCY, async item => {
      const parsed = await simpleParser(item.source);
      const subject = (parsed.subject || '(sin asunto)').slice(0, 290);
      // mailparser: parsed.html es `false` (no null) cuando no hay HTML, por eso
      // ?. no lo corta; hay que comprobar que sea string antes de usar .replace().
      const htmlText = typeof parsed.html === 'string' ? parsed.html.replace(/<[^>]+>/g, ' ') : '';
      const body = (parsed.text || htmlText || '').slice(0, 100000);
      const fromText = (parsed.from?.text || 'Remitente desconocido').slice(0, 290);
      const attachments = (parsed.attachments || []).filter(a => a.content?.length);

      /* Clasificación con Gemini incluyendo el contenido de los adjuntos (PDF/imágenes).
         Si la IA falla, el correo se importa igual sin clasificar. */
      let ai = null;
      try {
        ai = await classifyCorrespondence(subject, body,
          attachments.map(a => ({ buffer: a.content, contentType: a.contentType, filename: a.filename || 'adjunto' })));
      } catch (err) {
        console.error('[email-sync] Clasificación Gemini falló:', err.message);
      }
      return { uid: item.uid, subject, body, fromText, attachments, ai, date: parsed.date };
    });

    // Las inserciones van en serie y en orden cronológico (UID ascendente).
    for (const p of prepared) {
      let r;
      try {
        r = await run(`INSERT INTO correspondences(subject,body,from_user_id,to_user_id,label,external_from,imap_uid,ai_category,ai_priority,ai_summary,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
          [p.subject, p.body, null, userId, 'inbox', encryptField(p.fromText), `${cfg.email_address}:${p.uid}`,
           p.ai?.category || '', p.ai?.priority || '', p.ai?.summary || '',
           p.date ? p.date.toISOString().slice(0, 19).replace('T', ' ') : null]);
      } catch (err) {
        /* Clave duplicada (2601/2627 en el índice único de imap_uid): el correo
           ya está importado. Red de seguridad por si el candado no alcanza —
           p. ej. dos procesos del servicio tras un reinicio. No es un fallo. */
        if (err.number === 2601 || err.number === 2627 || /duplicate key/i.test(err.message || '')) {
          skipped++;
          continue;
        }
        throw err;
      }
      if (p.ai) classified++;

      /* Guardar adjuntos en disco y registrarlos */
      for (const a of p.attachments) {
        const safeName = sanitizeFilename(a.filename);
        const storedPath = path.join(ATTACHMENTS_DIR, `${r.lastID}_${Date.now()}_${safeName}`);
        fs.writeFileSync(storedPath, a.content);
        await run('INSERT INTO correspondence_attachments(correspondence_id,filename,content_type,size_bytes,stored_path) VALUES(?,?,?,?,?)',
          [r.lastID, safeName, (a.contentType || 'application/octet-stream').slice(0, 140), a.content.length, storedPath]);
      }
      imported++;
    }

    // Liberar los buffers ya procesados de este sub-lote.
    for (let k = i; k < i + slice.length; k++) downloaded[k] = null;
  }

  await run('UPDATE user_email_config SET last_sync=SYSDATETIME() WHERE user_id=?', [userId]);
  return { imported, skipped, classified, total, pending };
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
      /* El usuario está sincronizando a mano en este momento: se omite el buzón
         en este ciclo y se retoma en el siguiente. No es un error. */
      if (err.code === SYNC_IN_PROGRESS) {
        results.push({ user_id: cfg.user_id, user_name: cfg.user_name, email: cfg.email_address, ok: true, skipped_run: true, imported: 0, classified: 0 });
        continue;
      }
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
