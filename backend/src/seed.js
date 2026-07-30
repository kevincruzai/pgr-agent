import bcrypt from 'bcryptjs';
import { get, run } from './db.js';
import { config } from './config.js';

/* Las unidades van primero: users.unit_id las referencia y SQL Server sí valida FKs. */

async function seedUnits() {
  const u = await get('SELECT TOP 1 id FROM units');
  if (u) return;
  const units = [
    ['Dirección General', 'DG-001', 'Dirección General de la PGR', 'Director General', 'dg@pgr.gob.sv', '2231-9400'],
    ['Unidad Financiera', 'UF-001', 'Administración financiera institucional', 'Jefe Financiero', 'uf@pgr.gob.sv', '2231-9401'],
    ['Unidad de Informática', 'UI-001', 'Tecnología y sistemas de información', 'Jefe de Informática', 'ui@pgr.gob.sv', '2231-9402'],
    ['Unidad de Recursos Humanos', 'RH-001', 'Gestión del talento humano', 'Jefe de RRHH', 'rh@pgr.gob.sv', '2231-9403'],
    ['Procuraduría Adjunta', 'PA-001', 'Procuraduría adjunta para la defensa', 'Procurador Adjunto', 'pa@pgr.gob.sv', '2231-9404'],
    ['Unidad de Adquisiciones (UACP)', 'UACP-001', 'Unidad de Adquisiciones y Contrataciones Públicas', 'Jefe UACP', 'uacp@pgr.gob.sv', '2231-9405'],
  ];
  for (const [name, code, desc, resp, email, phone] of units) {
    await run('INSERT INTO units(name,code,description,responsible_name,email,phone) VALUES(?,?,?,?,?,?)', [name, code, desc, resp, email, phone]);
  }
}

async function seedRoles() {
  const r = await get('SELECT TOP 1 id FROM roles');
  if (r) return;
  const roles = [
    ['admin', 'Administrador', 'Acceso completo al sistema'],
    ['jefe_uacp', 'Jefe UACP', 'Jefe de Unidad de Adquisiciones y Contrataciones'],
    ['analista', 'Analista', 'Analista de compras públicas'],
    ['solicitante', 'Solicitante', 'Usuario de unidad solicitante'],
  ];
  for (const [name, display, desc] of roles) {
    await run('INSERT INTO roles(name,display_name,description,is_system) VALUES(?,?,?,1)', [name, display, desc]);
  }
}

async function seedCategories() {
  const c = await get('SELECT TOP 1 id FROM categories');
  if (c) return;
  const cats = [
    ['Libre Gestión', '#22c55e', 'shopping_cart', 'Compras hasta $8,000 (Art. 40 LACAP)'],
    ['Licitación Pública', '#3b82f6', 'gavel', 'Compras mayores a $160,000 (Art. 39 LACAP)'],
    ['Licitación por Invitación', '#f59e0b', 'mail', 'De $8,000 a $160,000 (Art. 39-B LACAP)'],
    ['Contratación Directa', '#ef4444', 'handshake', 'Casos de excepción (Art. 72 LACAP)'],
    ['Consultoría', '#8b5cf6', 'psychology', 'Servicios de consultoría especializada'],
    ['Suministros', '#06b6d4', 'inventory', 'Bienes y materiales de oficina'],
    ['Servicios Generales', '#ec4899', 'build', 'Mantenimiento, limpieza, seguridad'],
    ['Tecnología', '#6366f1', 'computer', 'Equipos, software y servicios TIC'],
  ];
  for (const [name, color, icon, desc] of cats) {
    await run('INSERT INTO categories(name,color,icon,description) VALUES(?,?,?,?)', [name, color, icon, desc]);
  }
}

export async function ensureAdmin() {
  const ex = await get('SELECT id FROM users WHERE document_number=?', [config.admin.documentNumber]);
  if (ex) return;
  const hash = await bcrypt.hash(config.admin.password, 10);
  await run('INSERT INTO users(name,document_type,document_number,email,password_hash,role,unit_id,is_active,avatar_color) VALUES(?,?,?,?,?,?,?,1,?)',
    ['Administrador PGR', 'DUI', config.admin.documentNumber, 'admin@pgr.gob.sv', hash, 'admin', 1, '#1e40af']);
}

async function seedUsers() {
  const ex = await get('SELECT id FROM users WHERE document_number=?', ['01234567-8']);
  if (ex) return;
  const pwd = await bcrypt.hash('PGR2024!', 10);
  const users = [
    // [nombre, documento, email, rol, unit_id, color]
    ['Lic. Roberto Carlos Mejía', '01234567-8', 'rcmejia@pgr.gob.sv', 'jefe_uacp', 6, '#7c3aed'],
    ['Ing. María Fernanda López', '02345678-9', 'mflopez@pgr.gob.sv', 'analista', 6, '#db2777'],
    ['Lic. Carlos Eduardo Ramírez', '03456789-0', 'ceramirez@pgr.gob.sv', 'solicitante', 3, '#0891b2'],
    ['Licda. Ana Beatriz Hernández', '04567890-1', 'abhernandez@pgr.gob.sv', 'solicitante', 2, '#059669'],
    ['Ing. José Miguel Portillo', '05678901-2', 'jmportillo@pgr.gob.sv', 'solicitante', 4, '#d97706'],
  ];
  for (const [name, doc, email, role, uid, color] of users) {
    await run('INSERT INTO users(name,document_type,document_number,email,password_hash,role,unit_id,is_active,avatar_color) VALUES(?,?,?,?,?,?,?,1,?)',
      [name, 'DUI', doc, email, pwd, role, uid, color]);
  }
}

async function seedProjects() {
  const p = await get('SELECT TOP 1 id FROM projects');
  if (p) return;
  const projects = [
    // [título, descripción, unit_id, cat_id, tipo, prioridad, presupuesto, base legal, deadline, created_by, estado, assigned_to]
    ['Adquisición de equipos informáticos 2026', 'Compra de 50 computadoras portátiles Dell Latitude 5540 y 10 impresoras multifuncionales HP LaserJet Pro para las oficinas regionales de San Salvador, Santa Ana y San Miguel. Incluye garantía de 3 años y soporte técnico.',
      3, 8, 'licitacion_invitacion', 'alta', 125000, 'LACAP Art. 39-B', '2026-05-15', 4, 'en_revision', 3],
    ['Servicio de limpieza institucional 2026-2027', 'Contratación del servicio de limpieza integral para la sede central (Edificio PGR, 5 niveles) y 14 oficinas regionales. Incluye suministro de insumos, equipos y personal capacitado. Contrato por 12 meses con opción de prórroga.',
      6, 7, 'licitacion_publica', 'media', 250000, 'LACAP Art. 39', '2026-06-01', 2, 'aprobado', 2],
    ['Suministros de oficina Q2-2026', 'Adquisición de papelería, tóner, artículos de oficina y material de archivo para todas las unidades. Detalle: 500 resmas papel bond, 200 cartuchos tóner, material vario de escritorio según listado adjunto.',
      2, 6, 'libre_gestion', 'baja', 5500, 'LACAP Art. 40', '2026-04-20', 5, 'completado', 3],
    ['Consultoría legal en derecho administrativo LACAP', 'Contratación de firma consultora especializada en derecho administrativo para asesorar en la actualización de manuales de procedimientos de compras públicas conforme a reformas LACAP 2025.',
      5, 5, 'contratacion_directa', 'alta', 45000, 'LACAP Art. 72', '2026-04-30', 1, 'en_proceso', 2],
    ['Mantenimiento preventivo flota vehicular', 'Servicio de mantenimiento preventivo y correctivo para 12 vehículos institucionales (8 Toyota Hilux, 2 Toyota Prado, 2 microbuses Coaster). Incluye repuestos originales y mano de obra.',
      6, 7, 'libre_gestion', 'media', 7800, 'LACAP Art. 40', '2026-05-10', 1, 'en_revision', 3],
    ['Sistema de videovigilancia sede central', 'Instalación de 48 cámaras IP tipo domo y bullet Hikvision, NVR de 64 canales, cableado estructurado Cat6, monitor de vigilancia 55". Incluye centro de monitoreo en planta baja.',
      3, 8, 'licitacion_invitacion', 'urgente', 95000, 'LACAP Art. 39-B', '2026-04-18', 4, 'adjudicado', 2],
    ['Arrendamiento de fotocopiadoras multifuncionales', 'Contrato de arrendamiento de 25 fotocopiadoras multifuncionales Ricoh MP 4055 para todas las unidades. Incluye mantenimiento, tóner ilimitado y soporte técnico 24/7 por 24 meses.',
      6, 8, 'licitacion_invitacion', 'media', 48000, 'LACAP Art. 39-B', '2026-06-15', 2, 'en_revision', 3],
    ['Compra de mobiliario para oficinas regionales', 'Adquisición de escritorios ejecutivos, sillas ergonómicas, archiveros metálicos y mesas de reunión para las nuevas oficinas regionales de Soyapango y Apopa según especificaciones del plano arquitectónico.',
      4, 6, 'licitacion_invitacion', 'baja', 35000, 'LACAP Art. 39-B', '2026-07-01', 6, 'borrador', null],
    ['Servicio de vigilancia y seguridad privada', 'Contratación de empresa de seguridad privada para cobertura 24/7 en sede central y 5 oficinas regionales principales. 35 agentes de seguridad con arma de fuego, radios de comunicación y uniforme.',
      6, 7, 'licitacion_publica', 'alta', 320000, 'LACAP Art. 39', '2026-08-01', 1, 'en_revision', 2],
    ['Plataforma digital de gestión documental', 'Adquisición e implementación de sistema de gestión documental electrónica (SGDE) para digitalizar el archivo institucional. Incluye licencias, capacitación, migración de datos y soporte por 12 meses.',
      3, 8, 'licitacion_invitacion', 'alta', 89000, 'LACAP Art. 39-B', '2026-06-30', 4, 'en_revision', 3],
    ['Capacitación LACAP para personal de compras', 'Programa de formación en Ley de Adquisiciones y Contrataciones de la Administración Pública para 45 funcionarios. 5 módulos de 16 horas cada uno. Incluye material didáctico y certificación.',
      4, 5, 'libre_gestion', 'media', 6200, 'LACAP Art. 40', '2026-05-20', 6, 'aprobado', 2],
    ['Remodelación de aires acondicionados sede central', 'Sustitución de 30 unidades de aire acondicionado tipo split inverter de 24,000 BTU en los niveles 3, 4 y 5 del edificio PGR. Incluye desinstalación, instalación, carga de gas refrigerante R410A.',
      6, 7, 'licitacion_invitacion', 'media', 72000, 'LACAP Art. 39-B', '2026-07-15', 1, 'borrador', null],
  ];
  for (const [title, desc, uid, cid, , prio, budget, legal, deadline, created, status, assigned] of projects) {
    await run(`INSERT INTO projects(title,description,unit_id,category_id,status,priority,budget_estimated,legal_reference,deadline,created_by,assigned_to)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`, [title, desc, uid, cid, status, prio, budget, legal, deadline, created, assigned]);
  }
}

async function seedCorrespondences() {
  const c = await get('SELECT TOP 1 id FROM correspondences');
  if (c) return;
  const corrs = [
    // [asunto, cuerpo, de, para, project_id, label, leído, destacado, ai_cat, ai_pri, ai_resumen, fecha]
    ['Solicitud de compra de equipos informáticos - UI-2026-001',
      'Estimados miembros de la UACP,\n\nPor medio de la presente, la Unidad de Informática solicita formalmente la adquisición de 50 computadoras portátiles Dell Latitude 5540 y 10 impresoras HP LaserJet Pro MFP 4103fdw para las oficinas regionales.\n\nSe adjuntan las especificaciones técnicas, el cuadro comparativo de precios y la justificación presupuestaria.\n\nQuedamos atentos a su respuesta.\n\nAtentamente,\nIng. Carlos Eduardo Ramírez\nUnidad de Informática',
      4, 2, 1, 'inbox', 0, 0, 'compras', 'alta', 'Solicitud formal de 50 computadoras y 10 impresoras para oficinas regionales', '2026-03-01 08:30:00'],
    ['RE: Observaciones técnicas al pliego - Equipos informáticos',
      'Lic. Mejía,\n\nHemos revisado el pliego y encontramos las siguientes inconsistencias:\n1. La especificación de RAM indica 8GB pero el uso previsto requiere mínimo 16GB\n2. El almacenamiento SSD de 256GB es insuficiente para las aplicaciones jurídicas\n3. Falta incluir el sistema operativo en la especificación\n\nFavor corregir antes de publicar la invitación.\n\nIng. María Fernanda López\nAnalista UACP',
      3, 2, 1, 'inbox', 0, 0, 'revision', 'media', 'Inconsistencias en especificaciones técnicas: RAM, SSD y SO', '2026-03-15 16:30:00'],
    ['Aprobación presupuestaria - Servicio de limpieza PGR-2026',
      'Señores UACP,\n\nLa Unidad Financiera institucional CERTIFICA que existe disponibilidad presupuestaria en la línea de gasto 54301 "Servicios de Limpieza y Fumigación" por un monto de DOSCIENTOS CINCUENTA MIL DÓLARES ($250,000.00) para el ejercicio fiscal 2026-2027.\n\nSe autoriza proceder con el proceso de licitación pública.\n\nLicda. Ana Beatriz Hernández\nUnidad Financiera',
      5, 2, 2, 'inbox', 1, 0, 'aprobacion', 'alta', 'Certificación de disponibilidad presupuestaria $250,000 para limpieza', '2026-02-25 14:00:00'],
    ['URGENTE - Vencimiento próximo suministros Q2',
      'ALERTA AUTOMÁTICA DEL SISTEMA\n\nEl proceso de adquisición "Suministros de oficina Q2-2026" (Libre Gestión - LACAP Art. 40) tiene fecha límite el 20/04/2026.\n\nDías restantes: 9\nEstado actual: En Revisión\nMonto: $5,500.00\n\nSe requiere acción inmediata para evitar desabastecimiento.',
      1, 5, 3, 'inbox', 0, 1, 'alerta', 'urgente', 'Vencimiento en 9 días para suministros Q2 - requiere acción inmediata', '2026-04-08 08:00:00'],
    ['Informe de evaluación de ofertas - Limpieza institucional',
      'Lic. Mejía,\n\nAdjunto el Informe de Evaluación de Ofertas para la Licitación Pública LP-PGR-002-2026 "Servicio de Limpieza Institucional".\n\nOfertas recibidas: 4\n1. Grupo Limpiatodo, S.A. de C.V. - $235,000.00\n2. Servicios Integrales OSP - $248,500.00\n3. CleanPro El Salvador - $241,200.00\n4. Mantenimiento Total, S.A. - $252,800.00\n\nRecomendación: Adjudicar a Grupo Limpiatodo por oferta más económica que cumple especificaciones.\n\nIng. María Fernanda López\nAnalista UACP',
      3, 2, 2, 'inbox', 1, 0, 'evaluacion', 'media', '4 ofertas evaluadas - Recomendación: Grupo Limpiatodo $235,000', '2026-03-22 10:00:00'],
    ['Consulta sobre base legal - Contratación directa consultoría',
      'Estimado Procurador Adjunto,\n\nSolicitamos su opinión legal respecto a la procedencia de tramitar la "Consultoría legal en derecho administrativo LACAP" bajo la modalidad de Contratación Directa (Art. 72 LACAP), considerando que:\n\n1. Se trata de servicios profesionales especializados\n2. No existe en el mercado nacional otro proveedor con la especialización requerida\n3. El monto ($45,000) excede el límite de libre gestión\n\nFavor emitir dictamen.\n\nLic. Roberto Carlos Mejía\nJefe UACP',
      2, 1, 4, 'inbox', 0, 0, 'legal', 'alta', 'Consulta procedencia contratación directa Art. 72 para consultoría legal', '2026-03-12 11:00:00'],
    ['Actualización del catálogo de proveedores - Marzo 2026',
      'Señores,\n\nSe informa que durante el mes de marzo 2026 se registraron 15 nuevos proveedores en el catálogo institucional:\n\n- 5 proveedores de equipo informático\n- 3 empresas de servicios de limpieza\n- 2 firmas de consultoría legal\n- 3 distribuidores de suministros de oficina\n- 2 empresas de seguridad privada\n\nTotal de proveedores activos: 127\n\nIng. María Fernanda López\nAnalista UACP',
      3, 1, null, 'inbox', 1, 0, 'proveedores', 'baja', '15 nuevos proveedores registrados - Total activos: 127', '2026-03-31 10:00:00'],
    ['URGENTE - Incidentes de seguridad - Acelerar videovigilancia',
      'MEMO INTERNO DE URGENCIA\n\nSe reportaron 3 incidentes de seguridad en la sede central durante la última semana:\n- 25/03: Intento de ingreso no autorizado al archivo general (nivel sótano)\n- 27/03: Sustracción de equipo de oficina del nivel 4\n- 28/03: Persona no identificada en área restringida nivel 2\n\nSe solicita URGENTEMENTE acelerar el proceso de adquisición del sistema de videovigilancia.\n\nAdministrador PGR',
      1, 2, 6, 'inbox', 0, 1, 'seguridad', 'urgente', '3 incidentes de seguridad reportados - Acelerar videovigilancia', '2026-03-28 08:00:00'],
    ['Especificaciones técnicas - Plataforma de gestión documental',
      'Lic. Mejía,\n\nAdjunto los requerimientos técnicos para la Plataforma de Gestión Documental:\n\n1. Capacidad mínima: 500,000 documentos digitalizados\n2. OCR integrado para búsqueda en documentos escaneados\n3. Firma electrónica certificada compatible con CNR\n4. Módulo de flujos de trabajo (BPM)\n5. API REST para integración con sistemas existentes\n6. Respaldos automáticos en la nube\n7. Cumplimiento con Ley de Acceso a la Información Pública\n\nIng. Carlos Eduardo Ramírez\nUnidad de Informática',
      4, 2, 10, 'inbox', 0, 0, 'compras', 'alta', 'Requerimientos técnicos SGDE: 7 criterios principales', '2026-04-02 09:15:00'],
    ['Cotización aprobada - Mantenimiento de vehículos',
      'Señores UACP,\n\nSe aprobó la cotización presentada por TallerAuto S.A. de C.V. para el mantenimiento preventivo de la flota vehicular:\n\n- 8 Toyota Hilux: $450 c/u = $3,600\n- 2 Toyota Prado: $650 c/u = $1,300\n- 2 Coaster: $900 c/u = $1,800\nTotal: $6,700.00 (dentro del rango de Libre Gestión)\n\nSe autoriza proceder con la orden de compra.\n\nLicda. Ana Beatriz Hernández\nUnidad Financiera',
      5, 2, 5, 'inbox', 1, 0, 'aprobacion', 'media', 'Cotización vehículos aprobada - $6,700 TallerAuto SA de CV', '2026-04-05 11:30:00'],
    ['Solicitud de mobiliario para oficinas Soyapango y Apopa',
      'Estimado Lic. Mejía,\n\nLa Unidad de Recursos Humanos solicita la adquisición de mobiliario para las nuevas oficinas regionales:\n\nOficina Soyapango:\n- 15 escritorios ejecutivos 1.50m x 0.70m\n- 15 sillas ergonómicas con soporte lumbar\n- 5 archiveros metálicos de 4 gavetas\n- 2 mesas de reunión para 8 personas\n\nOficina Apopa:\n- 10 escritorios ejecutivos\n- 10 sillas ergonómicas\n- 3 archiveros metálicos\n- 1 mesa de reunión\n\nAdjunto planos con distribución propuesta.\n\nIng. José Miguel Portillo\nUnidad de RRHH',
      6, 2, 8, 'inbox', 0, 0, 'compras', 'baja', 'Solicitud mobiliario para 2 oficinas nuevas: Soyapango y Apopa', '2026-04-08 14:00:00'],
    ['Dictamen legal favorable - Contratación directa consultoría',
      'Señores UACP,\n\nHabiendo analizado la solicitud de contratación directa para la "Consultoría legal en derecho administrativo LACAP", DICTAMINAMOS:\n\nEs PROCEDENTE la contratación directa conforme al Art. 72 literal "c" de la LACAP, por tratarse de servicios profesionales de naturaleza especializada donde se acredita que no existe en el mercado competencia suficiente.\n\nSe recomienda documentar el expediente con los antecedentes de exclusividad.\n\nProcuraduría Adjunta',
      1, 2, 4, 'inbox', 1, 0, 'legal', 'alta', 'Dictamen favorable para contratación directa Art. 72 LACAP', '2026-03-20 14:00:00'],
    ['Informe de capacitación LACAP - Módulo 1 completado',
      'Señores,\n\nInformamos que se completó satisfactoriamente el Módulo 1 "Fundamentos de la LACAP" del programa de capacitación:\n\n- Participantes: 45 de 45 (100% asistencia)\n- Nota promedio evaluación: 8.7/10\n- Duración: 16 horas (4 sesiones)\n- Instructor: Dr. Ernesto Vásquez, consultor UNAC\n\nEl Módulo 2 "Procedimientos de Licitación" inicia el 15/05/2026.\n\nIng. José Miguel Portillo\nUnidad de RRHH',
      6, 1, 11, 'inbox', 0, 0, 'informativo', 'media', 'Módulo 1 LACAP completado: 45 participantes, nota promedio 8.7', '2026-05-05 10:00:00'],
    ['Acta de adjudicación - Sistema de videovigilancia',
      'ACTA DE ADJUDICACIÓN\nProceso: LI-PGR-003-2026\n\nLa Comisión Evaluadora de Ofertas RESUELVE adjudicar la Licitación por Invitación "Sistema de videovigilancia sede central" a:\n\nEmpresa: Seguridad Electrónica Centroamericana S.A. de C.V.\nMonto adjudicado: $89,750.00\nPlazo de ejecución: 45 días calendario\n\nLa adjudicación se fundamenta en la evaluación técnica (60%) y económica (40%) conforme a los criterios del pliego.\n\nComisión Evaluadora',
      2, 1, 6, 'inbox', 0, 1, 'adjudicacion', 'alta', 'Adjudicación videovigilancia a Seguridad Electrónica CA $89,750', '2026-04-10 16:00:00'],
    ['Solicitud de prórroga - Remodelación aires acondicionados',
      'Estimados,\n\nPor la presente solicito una prórroga de 30 días naturales para la presentación del expediente completo de la "Remodelación de aires acondicionados sede central".\n\nMotivos:\n1. Se requiere inspección técnica adicional en nivel 5 por daños en ductos\n2. El proveedor solicitó tiempo adicional para la cotización de unidades inverter de alta eficiencia\n3. Se está gestionando el permiso ambiental para el manejo de gas refrigerante\n\nNueva fecha propuesta: 15/08/2026\n\nAdministrador PGR',
      1, 2, 12, 'inbox', 0, 0, 'administrativo', 'media', 'Solicitud prórroga 30 días para aires acondicionados - 3 motivos', '2026-04-12 09:00:00'],
  ];
  for (const [subj, body, from, to, pid, label, read, star, aiCat, aiPri, aiSum, createdAt] of corrs) {
    await run(`INSERT INTO correspondences(subject,body,from_user_id,to_user_id,project_id,label,is_read,is_starred,ai_category,ai_priority,ai_summary,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, [subj, body, from, to, pid, label, read, star, aiCat, aiPri, aiSum, createdAt || null]);
  }
}

async function seedAlerts() {
  const a = await get('SELECT TOP 1 id FROM alerts');
  if (a) return;
  const alerts = [
    [3, 5, 'deadline_warning', 'Vencimiento próximo - Suministros Q2', 'El proyecto "Suministros de oficina Q2-2026" vence el 20/04/2026. Quedan 9 días.', '2026-04-17'],
    [6, 2, 'deadline_warning', 'URGENTE - Videovigilancia por vencer', 'El proyecto "Sistema de videovigilancia sede central" vence el 18/04/2026. Incidentes de seguridad pendientes.', '2026-04-15'],
    [4, 2, 'deadline_warning', 'Vencimiento próximo - Consultoría legal', 'La "Consultoría legal en derecho administrativo" vence el 30/04/2026.', '2026-04-25'],
    [1, 4, 'status_change', 'Cambio de estado - Equipos informáticos', 'El proyecto "Adquisición de equipos informáticos 2026" fue movido a "En revisión" por la UACP.', '2026-04-10'],
    [2, 2, 'info', 'Nueva oferta recibida - Limpieza', 'Se recibió la oferta de Grupo Limpiatodo S.A. de C.V. por $235,000 para el servicio de limpieza.', '2026-04-09'],
    [9, 2, 'info', 'Nuevo proyecto registrado - Vigilancia', 'Se registró el proyecto "Servicio de vigilancia y seguridad privada" por $320,000 para licitación pública.', '2026-04-10'],
    [10, 4, 'status_change', 'Proyecto en revisión - Gestión documental', 'El proyecto "Plataforma digital de gestión documental" está siendo evaluado por la UACP.', '2026-04-03'],
    [6, 1, 'info', 'Adjudicación completada - Videovigilancia', 'Se adjudicó el sistema de videovigilancia a Seguridad Electrónica CA por $89,750.', '2026-04-10'],
    [11, 6, 'status_change', 'Capacitación aprobada - LACAP', 'El programa de capacitación LACAP fue aprobado. Módulo 1 inicia el 20/04/2026.', '2026-04-12'],
    [5, 2, 'info', 'Cotización aprobada - Vehículos', 'La cotización de TallerAuto S.A. de C.V. por $6,700 fue aprobada por la Unidad Financiera.', '2026-04-06'],
  ];
  for (const [pid, uid, type, title, msg, trigger] of alerts) {
    await run('INSERT INTO alerts(project_id,user_id,type,title,message,trigger_date) VALUES(?,?,?,?,?,?)', [pid, uid, type, title, msg, trigger]);
  }
}

async function seedProcurement() {
  const p = await get('SELECT TOP 1 id FROM procurement_requests');
  if (p) return;
  const reqs = [
    ['PGR-0001-2026', 1, 3, 'Adquisición de equipos informáticos 2026', '50 computadoras Dell Latitude 5540 y 10 impresoras HP LaserJet Pro', 'LACAP Art. 39-B - Licitación por Invitación', 'licitacion_invitacion', 125000, 'en_revision', 'Requerimiento justificado por obsolescencia de equipos actuales (más de 5 años)', 4, null],
    ['PGR-0002-2026', 2, 6, 'Servicio de limpieza institucional 2026-2027', 'Limpieza integral sede central y 14 oficinas regionales', 'LACAP Art. 39 - Licitación Pública', 'licitacion_publica', 250000, 'evaluacion', 'Contrato actual vence el 31/05/2026. Se requiere continuidad del servicio.', 2, 1],
    ['PGR-0003-2026', 3, 2, 'Suministros de oficina Q2-2026', 'Papelería, tóner y materiales de oficina', 'LACAP Art. 40 - Libre Gestión', 'libre_gestion', 5500, 'adjudicado', 'Existencias actuales cubren hasta mediados de abril 2026', 5, 2],
    ['PGR-0004-2026', 4, 5, 'Consultoría legal derecho administrativo', 'Asesoría especializada en actualización de manuales LACAP', 'LACAP Art. 72 - Contratación Directa', 'contratacion_directa', 45000, 'en_proceso', 'Dictamen legal favorable de Procuraduría Adjunta. No existe competencia en mercado local.', 1, 1],
    ['PGR-0005-2026', 6, 3, 'Sistema de videovigilancia sede central', '48 cámaras IP, NVR 64 canales, centro de monitoreo', 'LACAP Art. 39-B - Licitación por Invitación', 'licitacion_invitacion', 95000, 'adjudicado', 'Urgencia por incidentes de seguridad reportados en sede central', 4, 2],
    ['PGR-0006-2026', 9, 6, 'Servicio de vigilancia y seguridad privada', '35 agentes de seguridad 24/7 para sede y 5 oficinas', 'LACAP Art. 39 - Licitación Pública', 'licitacion_publica', 320000, 'borrador', 'Contrato actual con Protección Total vence en agosto 2026', 1, null],
  ];
  for (const [code, pid, uid, title, desc, legal, type, amount, status, justification, created, approved] of reqs) {
    await run(`INSERT INTO procurement_requests(code,project_id,unit_id,title,description,legal_basis,procurement_type,estimated_amount,status,justification,created_by,approved_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, [code, pid, uid, title, desc, legal, type, amount, status, justification, created, approved]);
  }
}

async function seedProjectEvents() {
  const e = await get('SELECT TOP 1 id FROM project_events');
  if (e) return;
  const events = [
    // Proyecto 1 - Equipos informáticos (en_revision)
    [1, 4, 'created', 'Proyecto creado', 'Solicitud de adquisición de equipos informáticos registrada por la Unidad de Informática', '', 'borrador', '2026-03-01 08:30:00'],
    [1, 4, 'document', 'Especificaciones técnicas adjuntas', 'Se adjuntaron las especificaciones técnicas de 50 Dell Latitude 5540 y 10 HP LaserJet Pro', '', '', '2026-03-02 10:00:00'],
    [1, 4, 'status_change', 'Enviado a UACP para revisión', 'La Unidad de Informática envió la documentación completa a la UACP', 'borrador', 'en_revision', '2026-03-03 10:15:00'],
    [1, 3, 'correspondence', 'Solicitud formal recibida', 'Correspondencia oficial UI-2026-001 recibida en la UACP', '', '', '2026-03-05 09:00:00'],
    [1, 2, 'review', 'Revisión técnica iniciada', 'La Jefatura UACP asignó la revisión a la Ing. López', '', '', '2026-03-10 11:00:00'],
    [1, 3, 'correspondence', 'Observaciones técnicas emitidas', 'Se identificaron inconsistencias en RAM (8GB→16GB), SSD (256→512GB) y falta de SO', '', '', '2026-03-15 16:30:00'],
    [1, 4, 'note', 'Corrección de especificaciones aplicada', 'Se actualizaron los requisitos de RAM a 16GB, SSD a 512GB y se incluyó Windows 11 Pro', '', '', '2026-03-18 09:45:00'],
    [1, 2, 'review', 'Pliego corregido aprobado', 'La UACP aprobó las especificaciones corregidas. Listo para invitación a proveedores.', '', '', '2026-03-25 14:00:00'],

    // Proyecto 2 - Limpieza (aprobado)
    [2, 2, 'created', 'Proyecto creado', 'Solicitud de contratación de servicio de limpieza institucional registrada por UACP', '', 'borrador', '2026-02-15 08:00:00'],
    [2, 2, 'status_change', 'Enviado a revisión', 'Documentación enviada para evaluación presupuestaria', 'borrador', 'en_revision', '2026-02-18 10:00:00'],
    [2, 5, 'budget', 'Certificación presupuestaria', 'La Unidad Financiera certificó disponibilidad de $250,000 en línea 54301', '', '', '2026-02-25 14:00:00'],
    [2, 5, 'correspondence', 'Aprobación presupuestaria recibida', 'Certificación oficial de la UF para servicio de limpieza', '', '', '2026-02-25 15:00:00'],
    [2, 2, 'document', 'Pliego de licitación elaborado', 'Se elaboró el pliego LP-PGR-002-2026 con bases de competencia y criterios de evaluación', '', '', '2026-03-01 08:00:00'],
    [2, 2, 'status_change', 'Aprobado para licitación', 'Proyecto aprobado. Se procede a publicar convocatoria', 'en_revision', 'aprobado', '2026-03-05 10:00:00'],
    [2, 3, 'milestone', 'Publicación de convocatoria', 'Convocatoria publicada en Diario Oficial y COMPRASAL por 20 días hábiles', '', '', '2026-03-06 08:00:00'],
    [2, 3, 'milestone', 'Recepción de ofertas cerrada', 'Se recibieron 4 ofertas válidas de empresas proveedoras', '', '', '2026-03-20 17:00:00'],
    [2, 3, 'correspondence', 'Informe de evaluación enviado', 'Informe con análisis comparativo de 4 ofertas enviado al Jefe UACP', '', '', '2026-03-22 10:00:00'],
    [2, 2, 'review', 'Comité evaluador en sesión', 'Comité evaluando propuestas técnicas y económicas', '', '', '2026-03-25 09:00:00'],

    // Proyecto 3 - Suministros Q2 (completado)
    [3, 5, 'created', 'Proyecto creado', 'Solicitud de suministros de oficina para Q2-2026 por Unidad Financiera', '', 'borrador', '2026-03-10 08:00:00'],
    [3, 5, 'status_change', 'En revisión', 'Enviado a revisión por modalidad libre gestión (Art. 40 LACAP)', 'borrador', 'en_revision', '2026-03-12 09:00:00'],
    [3, 3, 'review', 'Revisión rápida aprobada', 'Monto dentro de rango de libre gestión. Se aprueba cotizar con 3 proveedores.', '', '', '2026-03-14 10:00:00'],
    [3, 3, 'status_change', 'Aprobado', 'Cotización mejor evaluada: Distribuidora La Oficina $5,350.00', 'en_revision', 'aprobado', '2026-03-18 11:00:00'],
    [3, 2, 'status_change', 'En proceso de compra', 'Orden de compra emitida a Distribuidora La Oficina S.A. de C.V.', 'aprobado', 'en_proceso', '2026-03-20 09:00:00'],
    [3, 5, 'milestone', 'Entrega recibida', 'Suministros recibidos conforme a orden de compra. Acta de recepción firmada.', '', '', '2026-04-05 14:00:00'],
    [3, 2, 'status_change', 'Completado', 'Proceso finalizado. Pago procesado por $5,350.00', 'en_proceso', 'completado', '2026-04-10 10:00:00'],

    // Proyecto 4 - Consultoría legal (en_proceso)
    [4, 1, 'created', 'Proyecto creado', 'Solicitud de consultoría legal especializada por la Dirección General', '', 'borrador', '2026-03-05 08:00:00'],
    [4, 1, 'status_change', 'En revisión', 'Verificación de procedencia de contratación directa Art. 72 LACAP', 'borrador', 'en_revision', '2026-03-08 10:00:00'],
    [4, 2, 'correspondence', 'Consulta legal enviada', 'Solicitud de dictamen a Procuraduría Adjunta sobre Art. 72', '', '', '2026-03-12 11:00:00'],
    [4, 1, 'legal', 'Dictamen legal favorable', 'Procuraduría Adjunta confirma procedencia de contratación directa. Art. 72 literal "c".', '', '', '2026-03-20 14:00:00'],
    [4, 2, 'status_change', 'En proceso', 'Contratación directa iniciada con firma seleccionada', 'en_revision', 'en_proceso', '2026-03-25 09:00:00'],
    [4, 2, 'document', 'Contrato elaborado', 'Contrato de servicios de consultoría por $45,000 remitido a firma legal', '', '', '2026-04-01 10:00:00'],

    // Proyecto 5 - Vehículos (en_revision)
    [5, 1, 'created', 'Proyecto creado', 'Solicitud de mantenimiento preventivo para 12 vehículos institucionales', '', 'borrador', '2026-03-15 08:00:00'],
    [5, 1, 'status_change', 'En revisión', 'Enviado para cotización por modalidad libre gestión', 'borrador', 'en_revision', '2026-03-18 09:00:00'],
    [5, 3, 'review', 'Cotizaciones solicitadas', 'Se solicitaron cotizaciones a 3 talleres automotrices', '', '', '2026-03-22 10:00:00'],
    [5, 5, 'budget', 'Cotización aprobada', 'Unidad Financiera aprobó cotización de TallerAuto S.A. de C.V. por $6,700', '', '', '2026-04-05 11:30:00'],

    // Proyecto 6 - Videovigilancia (adjudicado)
    [6, 4, 'created', 'Proyecto creado', 'Solicitud de sistema de videovigilancia para sede central por Unidad de Informática', '', 'borrador', '2026-02-01 08:00:00'],
    [6, 4, 'document', 'Planos de instalación', 'Planos arquitectónicos con ubicación de 48 cámaras y centro de monitoreo', '', '', '2026-02-03 10:00:00'],
    [6, 4, 'status_change', 'Enviado a UACP', 'Documentación técnica completa enviada para proceso de adquisición', 'borrador', 'en_revision', '2026-02-05 10:00:00'],
    [6, 3, 'review', 'Revisión técnica aprobada', 'Especificaciones de cámaras Hikvision y NVR aprobadas por UACP', '', '', '2026-02-15 14:00:00'],
    [6, 2, 'status_change', 'Aprobado para licitación', 'Proyecto aprobado para Licitación por Invitación (Art. 39-B)', 'en_revision', 'aprobado', '2026-02-20 09:00:00'],
    [6, 3, 'milestone', 'Invitaciones enviadas', 'Se invitó a 5 empresas especializadas en seguridad electrónica', '', '', '2026-03-01 08:00:00'],
    [6, 3, 'milestone', 'Recepción de ofertas', 'Se recibieron 3 ofertas técnicas y económicas', '', '', '2026-03-25 17:00:00'],
    [6, 1, 'correspondence', 'Incidentes de seguridad reportados', 'MEMO: 3 incidentes de seguridad que justifican urgencia del proyecto', '', '', '2026-03-28 08:00:00'],
    [6, 1, 'alert', 'Solicitud de aceleración', 'Se solicitó priorizar el proceso por razones de seguridad institucional', '', '', '2026-04-01 09:00:00'],
    [6, 2, 'status_change', 'Adjudicado', 'Adjudicado a Seguridad Electrónica Centroamericana por $89,750', 'aprobado', 'adjudicado', '2026-04-10 16:00:00'],

    // Proyecto 7 - Fotocopiadoras (en_revision)
    [7, 2, 'created', 'Proyecto creado', 'Solicitud de arrendamiento de 25 fotocopiadoras multifuncionales Ricoh', '', 'borrador', '2026-03-20 08:00:00'],
    [7, 2, 'status_change', 'En revisión', 'Documentación enviada a revisión técnica y financiera', 'borrador', 'en_revision', '2026-03-22 10:00:00'],
    [7, 3, 'review', 'Análisis de mercado', 'Se analizaron ofertas de Ricoh, Xerox y Canon. Ricoh MP 4055 mejor relación costo-beneficio.', '', '', '2026-04-01 14:00:00'],

    // Proyecto 8 - Mobiliario (borrador)
    [8, 6, 'created', 'Proyecto creado', 'Solicitud de mobiliario para oficinas Soyapango y Apopa registrada por RRHH', '', 'borrador', '2026-04-08 14:00:00'],
    [8, 6, 'document', 'Planos adjuntos', 'Planos de distribución para ambas oficinas adjuntados al expediente', '', '', '2026-04-09 09:00:00'],

    // Proyecto 9 - Seguridad privada (en_revision)
    [9, 1, 'created', 'Proyecto creado', 'Solicitud de servicio de vigilancia 24/7 para sede y 5 oficinas regionales', '', 'borrador', '2026-04-01 08:00:00'],
    [9, 1, 'status_change', 'En revisión', 'Enviado a UACP para elaboración de pliego de licitación pública', 'borrador', 'en_revision', '2026-04-03 10:00:00'],
    [9, 2, 'review', 'Análisis de requerimientos', 'UACP analizando necesidades: 35 agentes, turnos rotativos, armamento y comunicaciones', '', '', '2026-04-08 11:00:00'],

    // Proyecto 10 - Gestión documental (en_revision)
    [10, 4, 'created', 'Proyecto creado', 'Solicitud de plataforma SGDE por Unidad de Informática', '', 'borrador', '2026-03-28 08:00:00'],
    [10, 4, 'status_change', 'En revisión', 'Requerimientos técnicos enviados a la UACP para evaluación', 'borrador', 'en_revision', '2026-04-01 09:00:00'],
    [10, 4, 'correspondence', 'Especificaciones enviadas', '7 requerimientos técnicos principales definidos: OCR, firma electrónica, BPM, API REST, nube', '', '', '2026-04-02 09:15:00'],
    [10, 3, 'review', 'Evaluación de plataformas', 'Analista comparando 4 plataformas: Alfresco, OpenKM, Nuxeo, DocuWare', '', '', '2026-04-10 14:00:00'],

    // Proyecto 11 - Capacitación LACAP (aprobado)
    [11, 6, 'created', 'Proyecto creado', 'Programa de capacitación LACAP para 45 funcionarios registrado por RRHH', '', 'borrador', '2026-04-01 08:00:00'],
    [11, 6, 'status_change', 'En revisión', 'Propuesta de capacitación enviada para aprobación', 'borrador', 'en_revision', '2026-04-03 09:00:00'],
    [11, 2, 'status_change', 'Aprobado', 'Programa aprobado. Se contrató al Dr. Ernesto Vásquez como instructor', 'en_revision', 'aprobado', '2026-04-12 10:00:00'],
    [11, 6, 'milestone', 'Módulo 1 completado', '45 participantes completaron "Fundamentos LACAP" con nota promedio 8.7/10', '', '', '2026-05-05 10:00:00'],

    // Proyecto 12 - Aires acondicionados (borrador)
    [12, 1, 'created', 'Proyecto creado', 'Solicitud de remodelación de aires acondicionados niveles 3, 4 y 5', '', 'borrador', '2026-04-05 08:00:00'],
    [12, 1, 'note', 'Inspección técnica requerida', 'Se requiere inspección adicional de ductos en nivel 5 antes de proceder', '', '', '2026-04-10 09:00:00'],
    [12, 1, 'correspondence', 'Solicitud de prórroga', 'Se solicitó prórroga de 30 días por inspección adicional y permisos ambientales', '', '', '2026-04-12 09:00:00'],
  ];
  for (const [pid, uid, etype, title, desc, oldV, newV, createdAt] of events) {
    await run('INSERT INTO project_events(project_id,user_id,event_type,title,description,old_value,new_value,created_at) VALUES(?,?,?,?,?,?,?,?)',
      [pid, uid, etype, title, desc, oldV, newV, createdAt]);
  }
}

async function seedEmailConfig() {
  const ex = await get('SELECT TOP 1 id FROM user_email_config');
  if (ex) return;
  const configs = [
    // [user_id, email, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, provider, is_active]
    [1, 'admin@pgr.gob.sv', 'imap.pgr.gob.sv', 993, 1, 'smtp.pgr.gob.sv', 587, 1, 'institutional', 1],
    [2, 'rcmejia@pgr.gob.sv', 'imap.pgr.gob.sv', 993, 1, 'smtp.pgr.gob.sv', 587, 1, 'institutional', 1],
    [3, 'mflopez@pgr.gob.sv', 'imap.pgr.gob.sv', 993, 1, 'smtp.pgr.gob.sv', 587, 1, 'institutional', 1],
    [4, 'ceramirez@pgr.gob.sv', 'imap.pgr.gob.sv', 993, 1, 'smtp.pgr.gob.sv', 587, 1, 'institutional', 0],
    [5, 'abhernandez@pgr.gob.sv', 'imap.pgr.gob.sv', 993, 1, 'smtp.pgr.gob.sv', 587, 1, 'institutional', 0],
    [6, 'jmportillo@pgr.gob.sv', 'imap.pgr.gob.sv', 993, 1, 'smtp.pgr.gob.sv', 587, 1, 'institutional', 0],
  ];
  for (const [uid, email, ihost, iport, isec, shost, sport, ssec, prov, active] of configs) {
    await run('INSERT INTO user_email_config(user_id,email_address,imap_host,imap_port,imap_secure,smtp_host,smtp_port,smtp_secure,provider,is_active) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [uid, email, ihost, iport, isec, shost, sport, ssec, prov, active]);
  }
}

/* Normaliza los textos demo de LACAP (derogada) a la LCP vigente (DL 652/2023).
   Idempotente: solo modifica filas que aún contienen referencias LACAP. */
async function normalizeLcp() {
  await run("UPDATE categories SET name=N'Comparación de Precios', description=N'Hasta 240 salarios mínimos comercio (Art. 40 LCP)' WHERE name=N'Libre Gestión'");
  await run("UPDATE categories SET name=N'Licitación Competitiva', description=N'Más de 240 salarios mínimos comercio (Art. 39 LCP)' WHERE name=N'Licitación Pública'");
  await run("UPDATE categories SET name=N'Baja Cuantía', description=N'Compras inmediatas por fondo circulante (Art. 44 LCP)' WHERE name=N'Licitación por Invitación'");
  await run("UPDATE categories SET description=N'Casos de excepción (Art. 41 LCP)' WHERE name=N'Contratación Directa' AND description LIKE N'%LACAP%'");
  await run("UPDATE projects SET legal_reference=N'LCP Art. 41 - Contratación Directa' WHERE legal_reference LIKE N'%LACAP%72%'");
  await run("UPDATE projects SET legal_reference=CASE WHEN budget_estimated > 87600 THEN N'LCP Art. 39 - Licitación Competitiva' ELSE N'LCP Art. 40 - Comparación de Precios' END WHERE legal_reference LIKE N'%LACAP%'");
  await run("UPDATE procurement_requests SET legal_basis=N'LCP Art. 41 - Contratación Directa' WHERE procurement_type=N'contratacion_directa' AND legal_basis LIKE N'%LACAP%'");
  await run("UPDATE procurement_requests SET procurement_type=CASE WHEN estimated_amount > 87600 THEN N'licitacion_competitiva' ELSE N'comparacion_precios' END, legal_basis=CASE WHEN estimated_amount > 87600 THEN N'LCP Art. 39 - Licitación Competitiva' ELSE N'LCP Art. 40 - Comparación de Precios' END WHERE legal_basis LIKE N'%LACAP%'");
}

export async function seedAll() {
  await seedUnits();
  await seedRoles();
  await seedCategories();
  await ensureAdmin();
  if (config.seedDemoData) {
    await seedUsers();
    await seedProjects();
    await seedCorrespondences();
    await seedAlerts();
    await seedProcurement();
    await seedProjectEvents();
    await seedEmailConfig();
  }
  await normalizeLcp();
}

// Permite ejecutar directamente: npm run seed
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const { closePool } = await import('./db.js');
  try {
    await seedAll();
    console.log('✅ Seeds aplicados correctamente.');
  } catch (err) {
    console.error('❌ Error al aplicar seeds:', err);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}
