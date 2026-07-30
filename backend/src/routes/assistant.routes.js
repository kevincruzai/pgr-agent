import { Router } from 'express';
import { all, get } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { chatWithWorkspace } from '../services/gemini.js';

/* Asistente IA personal (botón flotante global).
   Conversa sobre los datos DEL USUARIO AUTENTICADO: sus correos, los proyectos
   que creó o tiene asignados, sus alertas y sus solicitudes de compra.
   El presupuesto anual y el PAC se exponen SOLO como cifras institucionales
   agregadas (son datos compartidos de la unidad, no de otro usuario).

   Aislamiento: todas las consultas filtran por req.user.id — tomado del JWT
   verificado, nunca del body. Ningún parámetro del cliente altera el alcance. */

const router = Router();
router.use(requireAuth);

const fmt = d => (d ? String(new Date(d).toISOString()).slice(0, 10) : null);

/** Arma el contexto del usuario. Exportado para poder probarlo sin llamar a Gemini. */
export async function buildUserContext(user) {
  const uid = user.id;

  /* ── Correos propios (remitente o destinatario) ── */
  const emails = await all(
    `SELECT TOP 40 c.subject, c.ai_summary, c.ai_category, c.ai_priority, c.is_read, c.is_starred,
       c.created_at, p.title as project_title,
       CASE WHEN c.from_user_id=? THEN 'enviado' ELSE 'recibido' END as direccion,
       COALESCE(uf.name, c.external_from) as de, ut.name as para
     FROM correspondences c
     LEFT JOIN users uf ON c.from_user_id=uf.id
     LEFT JOIN users ut ON c.to_user_id=ut.id
     LEFT JOIN projects p ON c.project_id=p.id
     WHERE (c.to_user_id=? OR c.from_user_id=?) AND c.is_archived=0
     ORDER BY c.created_at DESC`,
    [uid, uid, uid]
  );

  const unread = await get(
    'SELECT COUNT(*) as count FROM correspondences WHERE to_user_id=? AND is_read=0 AND is_archived=0',
    [uid]
  );

  /* ── Proyectos propios: creados por el usuario o asignados a él ── */
  const projects = await all(
    `SELECT p.id, p.title, p.description, p.status, p.priority, p.budget_estimated, p.legal_reference,
       p.start_date, p.end_date, p.deadline, p.created_at, p.updated_at,
       c.name as categoria, u.name as unidad, asgn.name as responsable_asignado,
       CASE WHEN p.created_by=? THEN 1 ELSE 0 END as lo_cree_yo,
       CASE WHEN p.assigned_to=? THEN 1 ELSE 0 END as soy_responsable
     FROM projects p
     LEFT JOIN categories c ON p.category_id=c.id
     LEFT JOIN units u ON p.unit_id=u.id
     LEFT JOIN users asgn ON p.assigned_to=asgn.id
     WHERE p.created_by=? OR p.assigned_to=?
     ORDER BY p.updated_at DESC`,
    [uid, uid, uid, uid]
  );

  const projectIds = projects.map(p => p.id);

  /* ── Últimos eventos de seguimiento de esos proyectos ── */
  let events = [];
  if (projectIds.length) {
    const ph = projectIds.map(() => '?').join(',');
    events = await all(
      `SELECT TOP 40 pe.project_id, pe.event_type, pe.title, pe.description, pe.created_at,
         p.title as proyecto, usr.name as usuario
       FROM project_events pe
       LEFT JOIN projects p ON pe.project_id=p.id
       LEFT JOIN users usr ON pe.user_id=usr.id
       WHERE pe.project_id IN (${ph})
       ORDER BY pe.created_at DESC`,
      projectIds
    );
  }

  /* ── Alertas dirigidas al usuario ── */
  const alerts = await all(
    `SELECT TOP 25 a.type, a.title, a.message, a.is_read, a.trigger_date, a.created_at, p.title as proyecto
     FROM alerts a LEFT JOIN projects p ON a.project_id=p.id
     WHERE a.user_id=? ORDER BY a.created_at DESC`,
    [uid]
  );

  /* ── Solicitudes de compra creadas por el usuario ── */
  const requests = await all(
    `SELECT TOP 25 pr.code, pr.title, pr.description, pr.legal_basis, pr.procurement_type,
       pr.estimated_amount, pr.status, pr.created_at, p.title as proyecto, u.name as unidad
     FROM procurement_requests pr
     LEFT JOIN projects p ON pr.project_id=p.id
     LEFT JOIN units u ON pr.unit_id=u.id
     WHERE pr.created_by=? ORDER BY pr.created_at DESC`,
    [uid]
  );

  /* ── Presupuesto anual: cifras institucionales agregadas (sin desglose ajeno) ── */
  const cfgRows = await all(
    "SELECT [key], value FROM settings WHERE [key] IN ('annual_budget_year','annual_budget_amount')"
  );
  const cfg = {};
  cfgRows.forEach(r => { cfg[r.key] = r.value; });
  const year = parseInt(cfg.annual_budget_year) || new Date().getFullYear();
  const budgetAmount = parseFloat(cfg.annual_budget_amount) || 0;

  let budget = { configurado: false, anio: year };
  if (budgetAmount) {
    const yearExpr = 'YEAR(COALESCE(p.start_date, p.deadline, p.created_at))';
    const committed = await get(
      `SELECT COALESCE(SUM(budget_estimated),0) as total, COUNT(*) as count
       FROM projects p WHERE ${yearExpr}=? AND p.status NOT IN ('cancelado')`, [year]);
    const executed = await get(
      `SELECT COALESCE(SUM(budget_estimated),0) as total, COUNT(*) as count
       FROM projects p WHERE ${yearExpr}=? AND p.status IN ('completado')`, [year]);
    const committedTotal = Number(committed.total);
    budget = {
      configurado: true,
      anio: year,
      nota: 'Cifras institucionales de toda la unidad (dato compartido, no personal).',
      presupuesto_anual_usd: budgetAmount,
      comprometido_usd: committedTotal,
      proyectos_comprometidos: committed.count,
      ejecutado_usd: Number(executed.total),
      proyectos_ejecutados: executed.count,
      disponible_usd: budgetAmount - committedTotal,
      porcentaje_comprometido: budgetAmount > 0 ? Math.round((committedTotal / budgetAmount) * 1000) / 10 : 0,
      excede_presupuesto: committedTotal > budgetAmount,
    };
  }

  /* ── PAC: resumen institucional + los ítems creados por el usuario ── */
  const pacActive = await all(
    `SELECT estimated_amount, procurement_method, planned_month, status
     FROM pac_items WHERE pac_year=? AND status<>'cancelado'`, [year]);
  const pacByQuarter = { T1: 0, T2: 0, T3: 0, T4: 0 };
  const pacByMethod = {};
  for (const i of pacActive) {
    pacByMethod[i.procurement_method] = (pacByMethod[i.procurement_method] || 0) + Number(i.estimated_amount);
    if (i.planned_month) pacByQuarter[`T${Math.ceil(i.planned_month / 3)}`] += Number(i.estimated_amount);
  }
  const misPac = await all(
    `SELECT TOP 25 pi.correlativo, pi.description, pi.estimated_amount, pi.procurement_method,
       pi.planned_month, pi.status, pi.funding_source, u.name as unidad
     FROM pac_items pi LEFT JOIN units u ON pi.unit_id=u.id
     WHERE pi.pac_year=? AND pi.created_by=? ORDER BY pi.correlativo`, [year, uid]);

  return {
    usuario: {
      nombre: user.name,
      rol: user.role,
      unidad_id: user.unit_id ?? null,
      nota_alcance: 'Este contexto contiene solo los datos de este usuario más agregados institucionales.',
    },
    fecha_actual: fmt(new Date()),
    mis_correos: {
      total_en_contexto: emails.length,
      sin_leer: unread.count,
      mensajes: emails.map(e => ({
        asunto: e.subject,
        direccion: e.direccion,
        de: e.de,
        para: e.para,
        proyecto: e.project_title,
        categoria_ia: e.ai_category || null,
        prioridad_ia: e.ai_priority || null,
        resumen_ia: e.ai_summary || null,
        leido: !!e.is_read,
        destacado: !!e.is_starred,
        fecha: fmt(e.created_at),
      })),
    },
    mis_proyectos: projects.map(p => ({
      id: p.id,
      titulo: p.title,
      descripcion: (p.description || '').slice(0, 400),
      estado: p.status,
      prioridad: p.priority,
      presupuesto_estimado_usd: Number(p.budget_estimated),
      base_legal: p.legal_reference,
      categoria: p.categoria,
      unidad_solicitante: p.unidad,
      responsable_asignado: p.responsable_asignado || 'Sin asignar',
      mi_relacion: p.lo_cree_yo && p.soy_responsable ? 'creador y responsable'
        : p.lo_cree_yo ? 'creador' : 'responsable asignado',
      fecha_inicio: fmt(p.start_date),
      fecha_fin: fmt(p.end_date),
      fecha_limite: fmt(p.deadline),
      dias_para_vencimiento: p.deadline
        ? Math.ceil((new Date(p.deadline) - new Date()) / 86400000) : null,
      actualizado_el: fmt(p.updated_at),
    })),
    seguimiento_reciente: events.map(e => ({
      proyecto: e.proyecto,
      tipo: e.event_type,
      titulo: e.title,
      descripcion: (e.description || '').slice(0, 300),
      usuario: e.usuario,
      fecha: fmt(e.created_at),
    })),
    mis_alertas: alerts.map(a => ({
      tipo: a.type,
      titulo: a.title,
      mensaje: (a.message || '').slice(0, 400),
      proyecto: a.proyecto,
      leida: !!a.is_read,
      fecha_disparo: fmt(a.trigger_date),
      fecha: fmt(a.created_at),
    })),
    mis_solicitudes_de_compra: requests.map(r => ({
      codigo: r.code,
      titulo: r.title,
      proyecto: r.proyecto,
      unidad: r.unidad,
      metodo: r.procurement_type,
      base_legal: r.legal_basis,
      monto_estimado_usd: Number(r.estimated_amount),
      estado: r.status,
      fecha: fmt(r.created_at),
    })),
    presupuesto_institucional: budget,
    pac_institucional: {
      anio: year,
      nota: 'Totales del Plan Anual de Compras de la institución (dato compartido).',
      total_programado_usd: pacActive.reduce((a, i) => a + Number(i.estimated_amount), 0),
      items_activos: pacActive.length,
      por_metodo_usd: pacByMethod,
      por_trimestre_usd: pacByQuarter,
    },
    mis_items_pac: misPac.map(i => ({
      correlativo: i.correlativo,
      descripcion: i.description,
      unidad: i.unidad,
      fuente_financiamiento: i.funding_source,
      metodo: i.procurement_method,
      monto_estimado_usd: Number(i.estimated_amount),
      mes_estimado: i.planned_month,
      estado: i.status,
    })),
  };
}

/* POST /api/assistant/chat — conversa sobre los datos del usuario autenticado. */
router.post('/chat', async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ success: false, message: 'Debe incluir al menos un mensaje del usuario' });
  }

  const context = await buildUserContext(req.user);

  try {
    const reply = await chatWithWorkspace(context, messages);
    if (!reply) {
      return res.status(400).json({
        success: false,
        message: 'Gemini no está activado. Pida al administrador configurar la API Key en Configuración → Gemini Pro API.',
      });
    }
    res.json({ success: true, reply });
  } catch (err) {
    res.status(502).json({ success: false, message: err.message });
  }
});

/* GET /api/assistant/summary — cifras propias para el saludo inicial del panel. */
router.get('/summary', async (req, res) => {
  const uid = req.user.id;
  const unread = await get(
    'SELECT COUNT(*) as count FROM correspondences WHERE to_user_id=? AND is_read=0 AND is_archived=0', [uid]);
  const myProjects = await get(
    'SELECT COUNT(*) as count FROM projects WHERE created_by=? OR assigned_to=?', [uid, uid]);
  const openAlerts = await get(
    'SELECT COUNT(*) as count FROM alerts WHERE user_id=? AND is_read=0', [uid]);
  const dueSoon = await get(
    `SELECT COUNT(*) as count FROM projects
     WHERE (created_by=? OR assigned_to=?) AND deadline IS NOT NULL
       AND deadline BETWEEN CAST(GETDATE() AS DATE) AND DATEADD(day,7,CAST(GETDATE() AS DATE))
       AND status NOT IN ('completado','cancelado')`, [uid, uid]);

  res.json({ success: true, data: {
    correos_sin_leer: unread.count,
    mis_proyectos: myProjects.count,
    alertas_pendientes: openAlerts.count,
    vencen_en_7_dias: dueSoon.count,
  }});
});

export default router;
