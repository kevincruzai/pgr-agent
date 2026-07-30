import { Router } from 'express';
import { all, get } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { generateInsights, isGeminiActive } from '../services/gemini.js';

const router = Router();

// Cache global de insights Gemini (el análisis es del portafolio completo)
let insightsCache = { at: 0, data: null };
const INSIGHTS_TTL_MS = 5 * 60 * 1000;

router.get('/stats', requireAuth, async (req, res) => {
  const totalProjects = await get('SELECT COUNT(*) as count FROM projects');
  const totalUnits = await get('SELECT COUNT(*) as count FROM units');
  const totalRequests = await get('SELECT COUNT(*) as count FROM procurement_requests');
  const unreadCorr = await get('SELECT COUNT(*) as count FROM correspondences WHERE to_user_id=? AND is_read=0', [req.user.id]);
  const pendingProjects = await get("SELECT COUNT(*) as count FROM projects WHERE status IN ('borrador','en_revision')");
  const urgentAlerts = await get("SELECT COUNT(*) as count FROM alerts WHERE user_id=? AND is_read=0 AND type IN ('deadline_warning','deadline_expired')", [req.user.id]);

  const recentProjects = await all(`SELECT TOP 5 p.*, c.name as category_name, c.color as category_color, u.name as unit_name
    FROM projects p LEFT JOIN categories c ON p.category_id=c.id LEFT JOIN units u ON p.unit_id=u.id
    ORDER BY p.updated_at DESC`);

  const projectsByStatus = await all('SELECT status, COUNT(*) as count FROM projects GROUP BY status');
  const projectsByCategory = await all(`SELECT c.name, c.color, COUNT(p.id) as count
    FROM categories c LEFT JOIN projects p ON p.category_id=c.id GROUP BY c.id, c.name, c.color`);

  const upcomingDeadlines = await all(`SELECT TOP 8 p.id, p.title, p.deadline, p.priority, p.status, c.name as category_name, c.color as category_color
    FROM projects p LEFT JOIN categories c ON p.category_id=c.id
    WHERE p.deadline IS NOT NULL AND p.deadline >= CAST(GETDATE() AS DATE) AND p.status NOT IN ('completado','cancelado')
    ORDER BY p.deadline ASC`);

  res.json({ success: true, data: {
    totalProjects: totalProjects.count, totalUnits: totalUnits.count,
    totalRequests: totalRequests.count, unreadCorrespondences: unreadCorr.count,
    pendingProjects: pendingProjects.count, urgentAlerts: urgentAlerts.count,
    recentProjects, projectsByStatus, projectsByCategory, upcomingDeadlines,
  }});
});

/* ── Cumplimiento del presupuesto anual de compras ──
   El admin define annual_budget_year y annual_budget_amount en Configuración → Seguimiento. */
router.get('/budget-compliance', requireAuth, async (_req, res) => {
  const cfgRows = await all("SELECT [key], value FROM settings WHERE [key] IN ('annual_budget_year','annual_budget_amount')");
  const cfg = {};
  cfgRows.forEach(r => { cfg[r.key] = r.value; });
  const year = parseInt(cfg.annual_budget_year) || new Date().getFullYear();
  const budget = parseFloat(cfg.annual_budget_amount) || 0;
  if (!budget) return res.json({ success: true, data: { configured: false, year } });

  /* El año del proyecto se determina por inicio → límite → creación */
  const yearExpr = "YEAR(COALESCE(p.start_date, p.deadline, p.created_at))";
  const committed = await get(`SELECT COALESCE(SUM(budget_estimated),0) as total, COUNT(*) as count
    FROM projects p WHERE ${yearExpr}=? AND p.status NOT IN ('cancelado')`, [year]);
  const executed = await get(`SELECT COALESCE(SUM(budget_estimated),0) as total, COUNT(*) as count
    FROM projects p WHERE ${yearExpr}=? AND p.status IN ('completado')`, [year]);
  const awarded = await get(`SELECT COALESCE(SUM(budget_estimated),0) as total, COUNT(*) as count
    FROM projects p WHERE ${yearExpr}=? AND p.status IN ('adjudicado','completado')`, [year]);
  const byCategory = await all(`SELECT c.name, c.color, COALESCE(SUM(p.budget_estimated),0) as total, COUNT(p.id) as count
    FROM categories c INNER JOIN projects p ON p.category_id=c.id
    WHERE ${yearExpr}=? AND p.status NOT IN ('cancelado')
    GROUP BY c.id, c.name, c.color ORDER BY total DESC`, [year]);

  const committedTotal = Number(committed.total);
  res.json({ success: true, data: {
    configured: true,
    year,
    budget,
    committed: committedTotal,
    committed_count: committed.count,
    executed: Number(executed.total),
    executed_count: executed.count,
    awarded: Number(awarded.total),
    available: budget - committedTotal,
    percent_committed: budget > 0 ? Math.round(committedTotal / budget * 1000) / 10 : 0,
    over_budget: committedTotal > budget,
    byCategory,
  }});
});

router.get('/ai-insights', requireAuth, async (req, res) => {
  const totalProjects = await get('SELECT COUNT(*) as count FROM projects');
  const totalBudget = await get('SELECT COALESCE(SUM(budget_estimated),0) as total FROM projects');
  const urgentProjects = await all("SELECT title, CONVERT(varchar(10),deadline,23) as deadline, priority FROM projects WHERE priority IN ('alta','urgente') AND status NOT IN ('completado','cancelado')");
  const overdue = await all("SELECT title, CONVERT(varchar(10),deadline,23) as deadline FROM projects WHERE deadline < CAST(GETDATE() AS DATE) AND status NOT IN ('completado','cancelado')");
  const byStatus = await all('SELECT status, COUNT(*) as count FROM projects GROUP BY status');
  const byCategory = await all(`SELECT c.name, COUNT(p.id) as count, COALESCE(SUM(p.budget_estimated),0) as budget
    FROM categories c LEFT JOIN projects p ON p.category_id=c.id GROUP BY c.id, c.name ORDER BY budget DESC`);
  const unreadCorr = await get('SELECT COUNT(*) as count FROM correspondences WHERE to_user_id=? AND is_read=0', [req.user.id]);
  const pendingAlerts = await get('SELECT COUNT(*) as count FROM alerts WHERE user_id=? AND is_read=0', [req.user.id]);
  const upcomingSoon = await all(`SELECT title, CONVERT(varchar(10),deadline,23) as deadline, budget_estimated
    FROM projects
    WHERE deadline BETWEEN CAST(GETDATE() AS DATE) AND DATEADD(day,7,CAST(GETDATE() AS DATE))
      AND status NOT IN ('completado','cancelado')
    ORDER BY deadline ASC`);

  /* ── Análisis real con Gemini (cache 5 min), con fallback a reglas ── */
  if (await isGeminiActive()) {
    if (insightsCache.data && Date.now() - insightsCache.at < INSIGHTS_TTL_MS) {
      return res.json({ success: true, data: insightsCache.data, source: 'gemini' });
    }
    try {
      const portfolio = {
        total_proyectos: totalProjects.count,
        presupuesto_total_usd: Number(totalBudget.total),
        proyectos_vencidos: overdue,
        vencen_en_7_dias: upcomingSoon,
        proyectos_prioritarios: urgentProjects,
        por_estado: byStatus,
        por_categoria: byCategory,
        fecha_actual: new Date().toISOString().slice(0, 10),
      };
      const aiInsights = await generateInsights(portfolio);
      if (aiInsights?.length) {
        insightsCache = { at: Date.now(), data: aiInsights };
        return res.json({ success: true, data: aiInsights, source: 'gemini' });
      }
    } catch (err) {
      console.error('[ai-insights] Gemini falló, usando análisis por reglas:', err.message);
    }
  }

  const insights = [];

  if (overdue.length > 0) insights.push(`⚠️ ATENCIÓN INMEDIATA: Hay ${overdue.length} proyecto(s) vencido(s): ${overdue.map(p => '"' + p.title + '"').join(', ')}. Se requiere acción urgente para regularizar estos procesos según los plazos establecidos en la LACAP.`);
  if (upcomingSoon.length > 0) insights.push(`📅 VENCIMIENTOS PRÓXIMOS (7 días): ${upcomingSoon.length} proyecto(s) por vencer: ${upcomingSoon.map(p => p.title + ' (' + (p.deadline || 'sin fecha') + ')').join(', ')}. Presupuesto comprometido: ${formatBudget(upcomingSoon.reduce((a, p) => a + Number(p.budget_estimated), 0))}.`);
  if (urgentProjects.length > 0) insights.push(`🔴 PROYECTOS PRIORITARIOS: ${urgentProjects.length} proyecto(s) catalogados como alta prioridad o urgentes. Recomendación: asignar recursos adicionales y establecer seguimiento diario.`);

  const statusMap = {};
  byStatus.forEach(s => statusMap[s.status] = s.count);
  const enRevision = statusMap['en_revision'] || 0;
  const borrador = statusMap['borrador'] || 0;
  if (enRevision + borrador > 0) insights.push(`📋 PIPELINE DE TRABAJO: ${borrador} proyecto(s) en borrador y ${enRevision} en revisión. El ${totalProjects.count > 0 ? Math.round((enRevision + borrador) / totalProjects.count * 100) : 0}% de los proyectos está en etapas iniciales. Sugerencia: acelerar las aprobaciones para mantener el flujo de adquisiciones.`);

  insights.push(`💰 PRESUPUESTO TOTAL COMPROMETIDO: ${formatBudget(totalBudget.total)} distribuido en ${totalProjects.count} proyectos activos. ${byCategory.length > 0 ? 'Mayor concentración en: ' + byCategory[0].name + ' (' + formatBudget(byCategory[0].budget) + ').' : ''}`);

  if (unreadCorr.count > 0) insights.push(`📧 CORRESPONDENCIA: ${unreadCorr.count} correo(s) sin leer pendientes de revisión. La clasificación IA ha categorizado automáticamente los mensajes por prioridad y tipo.`);
  if (pendingAlerts.count > 0) insights.push(`🔔 ALERTAS ACTIVAS: ${pendingAlerts.count} alerta(s) sin atender. Revisar el panel de alertas para no perder fechas límite ni notificaciones importantes.`);

  insights.push(`📊 ANÁLISIS GENERAL: El sistema gestiona ${totalProjects.count} proyectos distribuidos en ${byCategory.length} categorías de compra. La salud general del portafolio es ${overdue.length === 0 ? '✅ BUENA' : '⚠️ REQUIERE ATENCIÓN'} basado en el cumplimiento de plazos LACAP.`);

  res.json({ success: true, data: insights, source: 'rules' });
});

function formatBudget(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default router;
