/* ════════════════════════════════════════════════════════════════
   Pruebas de integración (auditoría de operatividad)
   Levantan la API real contra SQL Server (PGR_Compras) y verifican
   cada módulo: salud, autenticación, autorización por rol, proyectos,
   correspondencia, PAC, procesos LCP, alertas y presupuesto.
   Los datos de prueba usan el prefijo TEST-AUDIT y se eliminan al final.
   Ejecutar: npm test
   ════════════════════════════════════════════════════════════════ */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { run, get, closePool } from '../src/db.js';
import { buildUserContext } from '../src/routes/assistant.routes.js';

const MARK = 'TEST-AUDIT';
const TEST_DOC = '99000000-1';
const TEST_DOC2 = '99000000-2'; // usuario creado por el admin (clave temporal)
let server, base;
let adminToken, jefeToken, solicitanteToken;
let projectId, corrId, pacIds = [], procurementId, registeredUserId;

const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

const login = async (doc, pass) => {
  const r = await api('POST', '/auth/login', { body: { document_number: doc, password: pass } });
  assert.equal(r.status, 200, `login de ${doc} falló: ${JSON.stringify(r.json)}`);
  return r.json;
};

async function cleanup() {
  await run(`DELETE FROM correspondences WHERE subject LIKE '${MARK}%'`);
  await run(`DELETE FROM project_events WHERE project_id IN (SELECT id FROM projects WHERE title LIKE '${MARK}%')`);
  await run(`DELETE FROM alerts WHERE project_id IN (SELECT id FROM projects WHERE title LIKE '${MARK}%')`);
  await run(`DELETE FROM pac_items WHERE pac_year=2030`);
  await run(`DELETE FROM procurement_requests WHERE title LIKE '${MARK}%'`);
  await run(`DELETE FROM projects WHERE title LIKE '${MARK}%'`);
  await run(`DELETE FROM user_email_config WHERE user_id IN (SELECT id FROM users WHERE document_number IN (?, ?))`, [TEST_DOC, TEST_DOC2]);
  await run(`DELETE FROM users WHERE document_number IN (?, ?)`, [TEST_DOC, TEST_DOC2]);
}

before(async () => {
  await cleanup();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  adminToken = (await login('00000000-0', 'AdminPGR2024!')).token;
  jefeToken = (await login('01234567-8', 'PGR2024!')).token;
  solicitanteToken = (await login('03456789-0', 'PGR2024!')).token;
});

after(async () => {
  await cleanup();
  server?.close();
  await closePool();
});

/* ─── 1. Salud del sistema ─── */
test('health: la API responde y reporta SQL Server', async () => {
  const r = await api('GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.db, 'sqlserver');
});

/* ─── 2. Autenticación ─── */
test('auth: contraseña incorrecta → 401 sin token', async () => {
  const r = await api('POST', '/auth/login', { body: { document_number: '00000000-0', password: 'incorrecta' } });
  assert.equal(r.status, 401);
  assert.equal(r.json.token, undefined);
});

test('auth: registro de usuario nuevo inicia con onboarding pendiente', async () => {
  const reg = await api('POST', '/auth/register', { body: { name: `${MARK} Usuario`, document_number: TEST_DOC, password: 'Prueba2026!', email: 'test@audit.local' } });
  assert.equal(reg.status, 200);
  registeredUserId = reg.json.id;
  const l = await login(TEST_DOC, 'Prueba2026!');
  assert.equal(l.user.onboarding_done, false, 'usuario nuevo debe ver el asistente');
});

test('auth: documento duplicado → 409', async () => {
  const r = await api('POST', '/auth/register', { body: { name: 'Dup', document_number: TEST_DOC, password: 'x12345678' } });
  assert.equal(r.status, 409);
});

test('auth: omitir onboarding lo marca completado de forma persistente', async () => {
  const t = (await login(TEST_DOC, 'Prueba2026!')).token;
  const done = await api('POST', '/auth/onboarding-done', { token: t });
  assert.equal(done.status, 200);
  assert.equal((await login(TEST_DOC, 'Prueba2026!')).user.onboarding_done, true);
});

/* ─── 2b. Gestión de usuarios: clave temporal obligatoria y perfil ─── */
test('usuarios: el admin crea la cuenta con clave temporal, cargo y teléfono', async () => {
  const r = await api('POST', '/admin/users', { token: adminToken, body: {
    name: `${MARK} Personal UCP`, document_number: TEST_DOC2, password: 'Temporal99!',
    email: 'personal@audit.local', phone: '2231-9499', position: 'Analista de Compras', role: 'analista', unit_id: 6,
  } });
  assert.equal(r.status, 200);
  assert.equal(r.json.must_change_password, true);
  const row = await get('SELECT phone, position, must_change_password FROM users WHERE document_number=?', [TEST_DOC2]);
  assert.equal(row.position, 'Analista de Compras');
  assert.equal(row.phone, '2231-9499');
  assert.equal(row.must_change_password, true);
});

test('usuarios: la clave temporal corta se rechaza (mínimo 8)', async () => {
  const r = await api('POST', '/admin/users', { token: adminToken, body: { name: 'X', document_number: '99000000-3', password: 'corta1' } });
  assert.equal(r.status, 400);
});

test('usuarios: al ingresar con clave temporal el sistema exige el cambio', async () => {
  const l = await login(TEST_DOC2, 'Temporal99!');
  assert.equal(l.user.must_change_password, true, 'el login debe indicar el cambio obligatorio');
});

test('usuarios: el cambio de clave valida fortaleza y la clave actual', async () => {
  const t = (await login(TEST_DOC2, 'Temporal99!')).token;
  // débil → 400
  let r = await api('POST', '/auth/change-password', { token: t, body: { current_password: 'Temporal99!', new_password: 'soloLetras' } });
  assert.equal(r.status, 400);
  // clave actual incorrecta → 401
  r = await api('POST', '/auth/change-password', { token: t, body: { current_password: 'incorrecta', new_password: 'MiClaveNueva26' } });
  assert.equal(r.status, 401);
  // correcta → limpia la bandera y la nueva clave funciona
  r = await api('POST', '/auth/change-password', { token: t, body: { current_password: 'Temporal99!', new_password: 'MiClaveNueva26' } });
  assert.equal(r.status, 200);
  const l = await login(TEST_DOC2, 'MiClaveNueva26');
  assert.equal(l.user.must_change_password, false);
  // la clave temporal vieja ya no sirve
  assert.equal((await api('POST', '/auth/login', { body: { document_number: TEST_DOC2, password: 'Temporal99!' } })).status, 401);
});

test('usuarios: el reseteo de clave por el admin reactiva el cambio obligatorio', async () => {
  const u = await get('SELECT id FROM users WHERE document_number=?', [TEST_DOC2]);
  const r = await api('PUT', `/admin/users/${u.id}`, { token: adminToken, body: { name: `${MARK} Personal UCP`, role: 'analista', password: 'OtraTemporal7!' } });
  assert.equal(r.status, 200);
  assert.equal((await login(TEST_DOC2, 'OtraTemporal7!')).user.must_change_password, true);
});

test('usuarios: cada quien actualiza sus datos de contacto (perfil propio)', async () => {
  const t = (await login(TEST_DOC2, 'OtraTemporal7!')).token;
  const r = await api('PUT', '/auth/profile', { token: t, body: { email: 'nuevo@audit.local', phone: '7777-8888' } });
  assert.equal(r.status, 200);
  const me = await api('GET', '/auth/me', { token: t });
  assert.equal(me.json.user.email, 'nuevo@audit.local');
  assert.equal(me.json.user.phone, '7777-8888');
});

/* ─── 3. Autorización por rol ─── */
test('authz: sin token → 401 en rutas protegidas', async () => {
  assert.equal((await api('GET', '/projects')).status, 401);
  assert.equal((await api('GET', '/alerts')).status, 401);
});

test('authz: solicitante no accede a administración → 403', async () => {
  assert.equal((await api('GET', '/admin/users', { token: solicitanteToken })).status, 403);
});

test('authz: jefe UACP administra usuarios pero NO la configuración Gemini/settings (solo admin general)', async () => {
  assert.equal((await api('GET', '/admin/users', { token: jefeToken })).status, 200);
  assert.equal((await api('GET', '/admin/settings', { token: jefeToken })).status, 403);
  assert.equal((await api('POST', '/admin/gemini/test', { token: jefeToken, body: {} })).status, 403);
  assert.equal((await api('POST', '/admin/impersonate/3', { token: jefeToken })).status, 403);
});

test('authz: impersonación del admin general emite token funcional del usuario destino', async () => {
  const imp = await api('POST', '/admin/impersonate/4', { token: adminToken });
  assert.equal(imp.status, 200);
  const me = await api('GET', '/auth/me', { token: imp.json.token });
  assert.equal(me.json.user.id, 4);
});

test('authz: el admin no puede impersonarse a sí mismo → 400', async () => {
  assert.equal((await api('POST', '/admin/impersonate/1', { token: adminToken })).status, 400);
});

/* ─── 4. Proyectos: ciclo de vida y seguimiento ─── */
test('proyectos: crear, listar y ver detalle', async () => {
  const c = await api('POST', '/projects', { token: adminToken, body: { title: `${MARK} Proyecto`, description: 'Proyecto de auditoría', unit_id: 3, category_id: 8, priority: 'alta', budget_estimated: 12345.67, deadline: '2030-06-30' } });
  assert.equal(c.status, 200);
  projectId = c.json.id;
  const list = await api('GET', '/projects', { token: solicitanteToken });
  assert.ok(list.json.data.some(p => p.id === projectId), 'el proyecto debe ser visible para toda la unidad');
  const d = await api('GET', `/projects/${projectId}/detail`, { token: adminToken });
  assert.equal(d.status, 200);
  assert.ok(Array.isArray(d.json.data.timeline));
});

test('proyectos: edición manual de fechas con validación (fin < inicio → 400)', async () => {
  const bad = await api('PUT', `/projects/${projectId}`, { token: adminToken, body: { title: `${MARK} Proyecto`, start_date: '2030-05-01', end_date: '2030-01-01' } });
  assert.equal(bad.status, 400);
  const ok = await api('PUT', `/projects/${projectId}`, { token: adminToken, body: { title: `${MARK} Proyecto`, start_date: '2030-01-01', end_date: '2030-05-01', assigned_to: 3 } });
  assert.equal(ok.status, 200);
  const d = await api('GET', `/projects/${projectId}`, { token: adminToken });
  assert.equal(String(d.json.data.start_date).slice(0, 10), '2030-01-01');
});

test('proyectos: la edición queda registrada en el timeline de seguimiento', async () => {
  const d = await api('GET', `/projects/${projectId}/detail`, { token: adminToken });
  const evt = d.json.data.timeline.find(e => e.title === 'Proyecto editado');
  assert.ok(evt, 'debe existir el evento de auditoría de la edición');
  assert.match(evt.description, /inicio.*2030-01-01/);
});

test('proyectos: cambio de estado válido genera evento; estado inválido → 400', async () => {
  assert.equal((await api('PUT', `/projects/${projectId}/status`, { token: adminToken, body: { status: 'estado_falso' } })).status, 400);
  assert.equal((await api('PUT', `/projects/${projectId}/status`, { token: adminToken, body: { status: 'en_revision' } })).status, 200);
  const d = await api('GET', `/projects/${projectId}/detail`, { token: adminToken });
  assert.ok(d.json.data.timeline.some(e => e.event_type === 'status_change' && e.new_value === 'en_revision'));
});

test('proyectos: chat IA valida entrada y reporta cuando Gemini no está activo', async () => {
  assert.equal((await api('POST', `/projects/${projectId}/chat`, { token: adminToken, body: { messages: [] } })).status, 400);
  const r = await api('POST', `/projects/${projectId}/chat`, { token: adminToken, body: { messages: [{ role: 'user', text: '¿Estado?' }] } });
  assert.ok([400, 502].includes(r.status));
  assert.ok(r.json.message.length > 10, 'debe explicar el motivo');
});

/* ─── 5. Correspondencia ─── */
test('correspondencia: requiere destinatario válido', async () => {
  assert.equal((await api('POST', '/correspondences', { token: adminToken, body: { subject: `${MARK} sin destino` } })).status, 400);
});

test('correspondencia: envío interno llega a la bandeja del destinatario', async () => {
  const c = await api('POST', '/correspondences', { token: adminToken, body: { subject: `${MARK} Notificación`, body: 'Contenido de auditoría', to_user_id: 2, project_id: projectId } });
  assert.equal(c.status, 200);
  corrId = c.json.id;
  const inbox = await api('GET', '/correspondences', { token: jefeToken });
  assert.ok(inbox.json.data.some(m => m.id === corrId), 'el correo debe aparecer en la bandeja del destinatario');
});

test('correspondencia: control de acceso — un tercero no puede leer el correo ajeno', async () => {
  assert.equal((await api('GET', `/correspondences/${corrId}`, { token: solicitanteToken })).status, 404);
});

test('correspondencia: destacar, leer y archivar operan para el dueño', async () => {
  assert.equal((await api('PUT', `/correspondences/${corrId}/star`, { token: jefeToken })).status, 200);
  assert.equal((await api('PUT', `/correspondences/${corrId}/read`, { token: jefeToken })).status, 200);
  assert.equal((await api('PUT', `/correspondences/${corrId}/archive`, { token: jefeToken })).status, 200);
  const row = await get('SELECT is_starred, is_read, is_archived FROM correspondences WHERE id=?', [corrId]);
  assert.equal(row.is_starred, true);
  assert.equal(row.is_read, true);
  assert.equal(row.is_archived, true);
});

test('correspondencia: lista de adjuntos disponible (vacía para correo interno)', async () => {
  const r = await api('GET', `/correspondences/${corrId}/attachments`, { token: jefeToken });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.data, []);
});

/* ─── 5b. Asistente IA global: aislamiento de datos por usuario ─── */
test('asistente: el contexto de un usuario no incluye proyectos ni correos de otro', async () => {
  const solicitante = await get('SELECT id, name, role, unit_id FROM users WHERE document_number=?', ['03456789-0']);
  const jefe = await get('SELECT id, name, role, unit_id FROM users WHERE document_number=?', ['01234567-8']);

  /* Proyecto creado por el solicitante, sin asignar al jefe */
  const c = await api('POST', '/projects', { token: solicitanteToken, body: {
    title: `${MARK} Proyecto privado`, description: 'Aislamiento del asistente', budget_estimated: 5000 } });
  assert.equal(c.status, 200);
  const pid = c.json.id;

  const ctxSolicitante = await buildUserContext(solicitante);
  const ctxJefe = await buildUserContext(jefe);

  assert.ok(ctxSolicitante.mis_proyectos.some(p => p.id === pid), 'el creador debe ver su propio proyecto');
  assert.ok(!ctxJefe.mis_proyectos.some(p => p.id === pid), 'un tercero NO debe ver el proyecto ajeno en su contexto');

  /* Todo proyecto del contexto pertenece al usuario (creador o responsable) */
  for (const p of ctxJefe.mis_proyectos) {
    const r = await get('SELECT created_by, assigned_to FROM projects WHERE id=?', [p.id]);
    assert.ok(r.created_by === jefe.id || r.assigned_to === jefe.id, `proyecto ajeno ${p.id} en el contexto del jefe`);
  }
  /* Todo correo del contexto pertenece al usuario (remitente o destinatario) */
  for (const m of ctxJefe.mis_correos.mensajes) {
    const r = await get('SELECT TOP 1 id FROM correspondences WHERE subject=? AND (to_user_id=? OR from_user_id=?)',
      [m.asunto, jefe.id, jefe.id]);
    assert.ok(r, `correo ajeno "${m.asunto}" en el contexto del jefe`);
  }
  /* Toda alerta del contexto va dirigida al usuario */
  for (const a of ctxJefe.mis_alertas) {
    const r = await get('SELECT TOP 1 id FROM alerts WHERE title=? AND user_id=?', [a.titulo, jefe.id]);
    assert.ok(r, `alerta ajena "${a.titulo}" en el contexto del jefe`);
  }
  /* El presupuesto se expone como agregado institucional, no como dato personal */
  assert.ok('presupuesto_institucional' in ctxJefe);
  assert.ok('pac_institucional' in ctxJefe);
});

test('asistente: exige autenticación y valida la entrada', async () => {
  assert.equal((await api('POST', '/assistant/chat', { body: { messages: [{ role: 'user', text: 'hola' }] } })).status, 401);
  assert.equal((await api('GET', '/assistant/summary')).status, 401);

  const vacio = await api('POST', '/assistant/chat', { token: jefeToken, body: { messages: [] } });
  assert.equal(vacio.status, 400);

  const s = await api('GET', '/assistant/summary', { token: jefeToken });
  assert.equal(s.status, 200);
  assert.equal(typeof s.json.data.correos_sin_leer, 'number');
  assert.equal(typeof s.json.data.mis_proyectos, 'number');
});

/* ─── 6. PAC (Planificación Anual de Compras) ─── */
test('PAC: correlativo automático por año fiscal', async () => {
  const a = await api('POST', '/pac', { token: adminToken, body: { pac_year: 2030, description: `${MARK} Suministros`, procurement_method: 'comparacion_precios', estimated_amount: 10000, planned_month: 2 } });
  const b = await api('POST', '/pac', { token: adminToken, body: { pac_year: 2030, description: `${MARK} Obra`, procurement_method: 'licitacion_competitiva', estimated_amount: 90000, planned_month: 8 } });
  assert.equal(a.json.correlativo, 1);
  assert.equal(b.json.correlativo, 2);
  pacIds = [a.json.id, b.json.id];
});

test('PAC: la Baja Cuantía se rechaza (regla DINAC: excluida de la PAC)', async () => {
  const r = await api('POST', '/pac', { token: adminToken, body: { pac_year: 2030, description: `${MARK} caja chica`, procurement_method: 'baja_cuantia', estimated_amount: 200 } });
  assert.equal(r.status, 400);
  assert.match(r.json.message, /EXCLUYE de la PAC/);
});

test('PAC: resumen consistente (totales y trimestres)', async () => {
  const r = await api('GET', '/pac?year=2030', { token: jefeToken });
  assert.equal(r.json.data.summary.count, 2);
  assert.equal(r.json.data.summary.total, 100000);
  assert.equal(r.json.data.summary.byQuarter.T1, 10000);
  assert.equal(r.json.data.summary.byQuarter.T3, 90000);
});

test('PAC: actualización de estado y vínculo a proyecto', async () => {
  const r = await api('PUT', `/pac/${pacIds[0]}`, { token: adminToken, body: { status: 'contratado', project_id: projectId } });
  assert.equal(r.status, 200);
  const row = await get('SELECT status, project_id FROM pac_items WHERE id=?', [pacIds[0]]);
  assert.equal(row.status, 'contratado');
  assert.equal(row.project_id, projectId);
});

/* ─── 7. Procesos LCP ─── */
test('LCP: el asistente aplica los umbrales configurados', async () => {
  await api('PUT', '/admin/settings', { token: adminToken, body: { min_wage_comercio: '365', baja_cuantia_limit: '1000' } });
  const casos = [
    [500, 'baja_cuantia'],
    [50000, 'comparacion_precios'],
    [87600, 'comparacion_precios'],
    [120000, 'licitacion_competitiva'],
  ];
  for (const [monto, esperado] of casos) {
    const r = await api('POST', '/procurement/suggest', { token: solicitanteToken, body: { amount: monto } });
    assert.equal(r.json.data.procurement_type, esperado, `monto $${monto}`);
  }
});

test('LCP: la solicitud de compra genera código institucional correlativo', async () => {
  const r = await api('POST', '/procurement', { token: adminToken, body: { title: `${MARK} Solicitud`, estimated_amount: 5000, procurement_type: 'comparacion_precios' } });
  assert.equal(r.status, 200);
  assert.match(r.json.code, /^PGR-\d{4}-\d{4}$/);
  procurementId = r.json.id;
});

/* ─── 8. Alertas y seguimiento de vencimientos ─── */
test('alertas: el escáner de vencimientos opera y reporta métricas', async () => {
  const r = await api('POST', '/admin/alerts/scan', { token: adminToken });
  assert.equal(r.status, 200);
  for (const k of ['overdue', 'upcoming', 'stale', 'alertsCreated']) {
    assert.equal(typeof r.json.data[k], 'number', `métrica faltante: ${k}`);
  }
});

test('alertas: cada usuario consulta las suyas', async () => {
  const r = await api('GET', '/alerts', { token: jefeToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.data));
});

/* ─── 9. Dashboard y presupuesto ─── */
test('dashboard: estadísticas completas para la unidad', async () => {
  const r = await api('GET', '/dashboard/stats', { token: solicitanteToken });
  assert.equal(r.status, 200);
  for (const k of ['totalProjects', 'totalUnits', 'totalRequests', 'recentProjects', 'projectsByStatus', 'upcomingDeadlines']) {
    assert.ok(k in r.json.data, `campo faltante: ${k}`);
  }
});

test('presupuesto anual: el cálculo de cumplimiento es aritméticamente consistente', async () => {
  const r = await api('GET', '/dashboard/budget-compliance', { token: solicitanteToken });
  assert.equal(r.status, 200);
  const d = r.json.data;
  if (d.configured) {
    assert.equal(d.available, d.budget - d.committed, 'disponible = presupuesto - comprometido');
    assert.equal(d.over_budget, d.committed > d.budget);
    assert.ok(d.executed <= d.awarded, 'ejecutado ⊆ adjudicado+completado');
  }
});

test('insights: el dashboard reporta la fuente del análisis (gemini o reglas)', async () => {
  const r = await api('GET', '/dashboard/ai-insights', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(['gemini', 'rules'].includes(r.json.source));
  assert.ok(r.json.data.length >= 3, 'debe haber observaciones');
});

/* ─── 9b. Bitácora de auditoría (DL 113/2024) ─── */
test('bitácora: los intentos de login fallidos quedan registrados', async () => {
  await api('POST', '/auth/login', { body: { document_number: '00000000-0', password: 'clave-mala-auditoria' } });
  await new Promise(r => setTimeout(r, 300)); // la cola de auditoría es asíncrona
  const r = await api('GET', '/admin/audit?q=LOGIN_FALLIDO&limit=5', { token: adminToken });
  assert.equal(r.status, 200);
  const evt = r.json.data.rows.find(x => x.action === 'LOGIN_FALLIDO');
  assert.ok(evt, 'debe existir el evento LOGIN_FALLIDO');
  assert.equal(evt.success, false);
  assert.match(evt.details, /contraseña incorrecta/);
  assert.ok(!evt.details.includes('clave-mala-auditoria'), 'la contraseña NUNCA debe quedar en la bitácora');
});

test('bitácora: las mutaciones se registran automáticamente con identidad y sin secretos', async () => {
  await api('PUT', `/projects/${projectId}`, { token: adminToken, body: { title: `${MARK} Proyecto`, priority: 'urgente' } });
  await new Promise(r => setTimeout(r, 300));
  const r = await api('GET', `/admin/audit?q=projects&limit=20`, { token: adminToken });
  const evt = r.json.data.rows.find(x => x.action === `PUT /api/projects/${projectId}`);
  assert.ok(evt, 'la edición del proyecto debe estar en la bitácora');
  assert.equal(evt.user_name, 'Administrador PGR');
  assert.equal(evt.entity_id, String(projectId));
});

test('bitácora: solo el administrador general puede consultarla', async () => {
  assert.equal((await api('GET', '/admin/audit', { token: jefeToken })).status, 403);
  assert.equal((await api('GET', '/admin/audit/verify', { token: jefeToken })).status, 403);
});

test('bitácora: la cadena de integridad hash se verifica sin alteraciones', async () => {
  await new Promise(r => setTimeout(r, 300));
  const r = await api('GET', '/admin/audit/verify', { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.json.data.ok, true, `cadena rota: ${JSON.stringify(r.json.data)}`);
  assert.ok(r.json.data.total > 0);
});

test('bitácora: una alteración de la bitácora ES detectada por la verificación', async () => {
  // Simula manipulación: cambiar el contenido de un registro y luego restaurarlo
  const victim = await get('SELECT TOP 1 id, details FROM audit_log ORDER BY id ASC');
  await run("UPDATE audit_log SET details='{\"manipulado\":true}' WHERE id=?", [victim.id]);
  const broken = await api('GET', '/admin/audit/verify', { token: adminToken });
  assert.equal(broken.json.data.ok, false, 'la manipulación debe romper la cadena');
  assert.equal(broken.json.data.broken_at_id, victim.id);
  // Restaurar el contenido original → la cadena vuelve a ser íntegra
  await run('UPDATE audit_log SET details=? WHERE id=?', [victim.details, victim.id]);
  const restored = await api('GET', '/admin/audit/verify', { token: adminToken });
  assert.equal(restored.json.data.ok, true, 'restaurado el contenido, la cadena debe verificar');
});

/* ─── 10. Catálogos ─── */
test('catálogos: unidades y categorías públicas; directorio autenticado; categorías en términos LCP', async () => {
  const cats = await api('GET', '/categories');
  assert.equal(cats.status, 200);
  const names = cats.json.data.map(c => c.name);
  assert.ok(names.includes('Licitación Competitiva'), 'las categorías deben estar modernizadas a LCP');
  assert.ok(!names.includes('Libre Gestión'), 'no deben quedar términos LACAP derogados');
  assert.equal((await api('GET', '/units')).status, 200);
  const dir = await api('GET', '/users/directory', { token: solicitanteToken });
  assert.ok(dir.json.data.length >= 6);
});
