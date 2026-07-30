import { all, get, run } from '../db.js';
import { syncAllInboxes } from './email.js';

/*
 * Sincronización automática de los buzones de toda la unidad.
 * Configurable desde el panel admin (tabla settings):
 *   email_sync_enabled           'true' | 'false'   (default: false)
 *   email_sync_interval_minutes  >= 1               (default: 5)
 *   email_sync_limit             correos NUEVOS por buzón y ciclo; 0 = sin límite / todo el histórico (default: 0)
 * El intervalo se relee en cada ciclo: los cambios aplican sin reiniciar.
 */

const MIN_INTERVAL_MINUTES = 1;
let timer = null;
let running = false;

async function readSyncSettings() {
  const rows = await all("SELECT [key], value FROM settings WHERE [key] LIKE 'email_sync_%'");
  const s = {};
  rows.forEach(r => { s[r.key] = r.value; });
  return {
    enabled: s.email_sync_enabled === 'true',
    intervalMinutes: Math.max(MIN_INTERVAL_MINUTES, parseInt(s.email_sync_interval_minutes) || 5),
    // 0 (o vacío) = sin límite: importa todos los correos pendientes por ciclo (backfill del histórico).
    limit: Math.max(0, parseInt(s.email_sync_limit) || 0),
  };
}

async function saveSetting(key, value) {
  const ex = await get('SELECT id FROM settings WHERE [key]=?', [key]);
  if (ex) await run('UPDATE settings SET value=?, updated_at=SYSDATETIME() WHERE [key]=?', [String(value), key]);
  else await run('INSERT INTO settings([key],value) VALUES(?,?)', [key, String(value)]);
}

async function tick() {
  if (running) return; // nunca solapar ciclos
  running = true;
  let nextMs = 60_000;
  try {
    const cfg = await readSyncSettings();
    nextMs = cfg.intervalMinutes * 60_000;
    if (cfg.enabled) {
      const startedAt = Date.now();
      const { results, totals, mailboxes } = await syncAllInboxes({ limit: cfg.limit });
      const report = {
        at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        mailboxes,
        ...totals,
        errors: results.filter(r => !r.ok).map(r => `${r.user_name}: ${r.message}`).slice(0, 10),
      };
      await saveSetting('email_sync_last_run', report.at);
      await saveSetting('email_sync_last_report', JSON.stringify(report));
      if (totals.imported || totals.failed) {
        console.log(`[auto-sync] ${mailboxes} buzón(es): ${totals.imported} importado(s), ${totals.classified} clasificado(s) IA, ${totals.failed} con error`);
      }
    }
  } catch (err) {
    console.error('[auto-sync] Error en el ciclo:', err.message);
  } finally {
    running = false;
    timer = setTimeout(tick, nextMs);
    timer.unref?.();
  }
}

export function startSyncScheduler() {
  if (timer) return;
  // primer ciclo a los 15s del arranque; luego según configuración
  timer = setTimeout(tick, 15_000);
  timer.unref?.();
  console.log('⏱️  Programador de sincronización de correo iniciado (configurable en Configuración → Seguimiento)');
}

export function stopSyncScheduler() {
  if (timer) clearTimeout(timer);
  timer = null;
}
