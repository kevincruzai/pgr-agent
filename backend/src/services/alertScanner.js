import { all, get, run } from '../db.js';
import { summarizeDeadlineRisks } from './gemini.js';

/*
 * Escáner de seguimiento de vencimientos de proyectos.
 * Reglas (siempre activas, sin depender de IA):
 *   - VENCIDO: deadline pasada y proyecto no completado/cancelado → alerta urgente
 *   - POR VENCER: deadline dentro de 7 días → alerta de advertencia
 *   - SIN ACTIVIDAD: proyecto activo sin eventos en 14 días → alerta informativa
 * Con Gemini activo se agrega un análisis ejecutivo de riesgos para admin/jefe UCP.
 * Anti-duplicados: no se repite la misma alerta (tipo+proyecto+usuario) en 3 días.
 * Configurable (settings): alert_scan_enabled (default true),
 * alert_scan_interval_hours (default 12, mínimo 1).
 */

const DEDUP_DAYS = 3;
let timer = null;
let running = false;

async function alertExistsRecently(projectId, userId, type) {
  const ex = await get(`SELECT id FROM alerts WHERE project_id=? AND user_id=? AND type=?
    AND created_at > DATEADD(day, -${DEDUP_DAYS}, SYSDATETIME())`, [projectId, userId, type]);
  return !!ex;
}

async function createAlert(projectId, userId, type, title, message) {
  if (!userId) return false;
  if (await alertExistsRecently(projectId, userId, type)) return false;
  await run('INSERT INTO alerts(project_id,user_id,type,title,message,trigger_date) VALUES(?,?,?,?,?,CAST(GETDATE() AS DATE))',
    [projectId, userId, type, title, message]);
  return true;
}

export async function scanDeadlines() {
  const fmt = d => d ? String(d).slice(0, 10) : '';
  let created = 0;
  const risks = [];

  const admins = await all("SELECT id FROM users WHERE role IN ('admin','jefe_uacp') AND is_active=1");

  /* 1. Proyectos VENCIDOS */
  const overdue = await all(`SELECT p.id, p.title, p.status, p.assigned_to, p.created_by,
      CONVERT(varchar(10), p.deadline, 23) as deadline, DATEDIFF(day, p.deadline, GETDATE()) as days_overdue
    FROM projects p WHERE p.deadline < CAST(GETDATE() AS DATE) AND p.status NOT IN ('completado','cancelado')`);
  for (const p of overdue) {
    risks.push({ tipo: 'vencido', proyecto: p.title, dias_vencido: p.days_overdue, estado: p.status, fecha_limite: p.deadline });
    const msg = `El proyecto "${p.title}" venció el ${fmt(p.deadline)} (${p.days_overdue} día(s) de atraso) y sigue en estado "${p.status}". Se requiere regularizar el proceso conforme a los plazos de la LCP.`;
    if (await createAlert(p.id, p.assigned_to || p.created_by, 'deadline_expired', `VENCIDO: ${p.title}`.slice(0, 290), msg)) created++;
  }

  /* 2. Proyectos POR VENCER (7 días) */
  const upcoming = await all(`SELECT p.id, p.title, p.status, p.assigned_to, p.created_by,
      CONVERT(varchar(10), p.deadline, 23) as deadline, DATEDIFF(day, GETDATE(), p.deadline) as days_left
    FROM projects p WHERE p.deadline BETWEEN CAST(GETDATE() AS DATE) AND DATEADD(day, 7, CAST(GETDATE() AS DATE))
      AND p.status NOT IN ('completado','cancelado')`);
  for (const p of upcoming) {
    risks.push({ tipo: 'por_vencer', proyecto: p.title, dias_restantes: p.days_left, estado: p.status, fecha_limite: p.deadline });
    const msg = `El proyecto "${p.title}" vence el ${fmt(p.deadline)} (quedan ${p.days_left} día(s)). Estado actual: "${p.status}". Verifique las acciones pendientes para cumplir el plazo.`;
    if (await createAlert(p.id, p.assigned_to || p.created_by, 'deadline_warning', `Vencimiento próximo: ${p.title}`.slice(0, 290), msg)) created++;
  }

  /* 3. Proyectos activos SIN ACTIVIDAD (14 días sin eventos) */
  const stale = await all(`SELECT p.id, p.title, p.status, p.assigned_to, p.created_by,
      DATEDIFF(day, COALESCE((SELECT MAX(pe.created_at) FROM project_events pe WHERE pe.project_id=p.id), p.created_at), GETDATE()) as idle_days
    FROM projects p WHERE p.status IN ('en_revision','aprobado','en_proceso','adjudicado')
      AND COALESCE((SELECT MAX(pe.created_at) FROM project_events pe WHERE pe.project_id=p.id), p.created_at) < DATEADD(day, -14, GETDATE())`);
  for (const p of stale) {
    risks.push({ tipo: 'sin_actividad', proyecto: p.title, dias_sin_actividad: p.idle_days, estado: p.status });
    const msg = `El proyecto "${p.title}" lleva ${p.idle_days} día(s) sin eventos de seguimiento registrados (estado: "${p.status}"). Registre el avance o impulse el trámite.`;
    if (await createAlert(p.id, p.assigned_to || p.created_by, 'status_change', `Sin actividad: ${p.title}`.slice(0, 290), msg)) created++;
  }

  /* 4. Análisis ejecutivo IA para admin/jefe UCP (solo si hay riesgos y alertas nuevas) */
  let aiDigest = false;
  if (risks.length && created > 0) {
    try {
      const digest = await summarizeDeadlineRisks({ fecha: new Date().toISOString().slice(0, 10), total_riesgos: risks.length, riesgos: risks });
      if (digest) {
        for (const a of admins) {
          if (await createAlert(null, a.id, 'deadline_warning', `🤖 ${digest.title}`.slice(0, 290), digest.message)) { created++; aiDigest = true; }
        }
      }
    } catch (err) {
      console.error('[alert-scan] Análisis IA de riesgos falló:', err.message);
    }
  }

  return { overdue: overdue.length, upcoming: upcoming.length, stale: stale.length, alertsCreated: created, aiDigest };
}

async function readScanSettings() {
  const rows = await all("SELECT [key], value FROM settings WHERE [key] LIKE 'alert_scan_%'");
  const s = {};
  rows.forEach(r => { s[r.key] = r.value; });
  return {
    enabled: s.alert_scan_enabled !== 'false', // activo por defecto
    intervalHours: Math.max(1, parseInt(s.alert_scan_interval_hours) || 12),
  };
}

async function saveSetting(key, value) {
  const ex = await get('SELECT id FROM settings WHERE [key]=?', [key]);
  if (ex) await run('UPDATE settings SET value=?, updated_at=SYSDATETIME() WHERE [key]=?', [String(value), key]);
  else await run('INSERT INTO settings([key],value) VALUES(?,?)', [key, String(value)]);
}

async function tick() {
  if (running) return;
  running = true;
  let nextMs = 60 * 60 * 1000;
  try {
    const cfg = await readScanSettings();
    nextMs = cfg.intervalHours * 60 * 60 * 1000;
    if (cfg.enabled) {
      const result = await scanDeadlines();
      await saveSetting('alert_scan_last_run', new Date().toISOString());
      await saveSetting('alert_scan_last_report', JSON.stringify(result));
      if (result.alertsCreated) {
        console.log(`[alert-scan] ${result.alertsCreated} alerta(s): ${result.overdue} vencido(s), ${result.upcoming} por vencer, ${result.stale} sin actividad${result.aiDigest ? ' + análisis IA' : ''}`);
      }
    }
  } catch (err) {
    console.error('[alert-scan] Error en el ciclo:', err.message);
  } finally {
    running = false;
    timer = setTimeout(tick, nextMs);
    timer.unref?.();
  }
}

export function startAlertScanner() {
  if (timer) return;
  timer = setTimeout(tick, 30_000); // primer escaneo a los 30s del arranque
  timer.unref?.();
  console.log('🔔 Escáner de vencimientos de proyectos iniciado');
}
