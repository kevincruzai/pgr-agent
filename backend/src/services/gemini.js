import { all } from '../db.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-2.5-flash';

/** Lee la configuración de Gemini guardada por el admin (tabla settings). */
export async function getGeminiSettings() {
  const rows = await all("SELECT [key], value FROM settings WHERE [key] LIKE 'gemini_%'");
  const s = {};
  rows.forEach(r => { s[r.key] = r.value; });
  return {
    apiKey: process.env.GEMINI_API_KEY || s.gemini_api_key || '',
    model: s.gemini_model || DEFAULT_MODEL,
    enabled: s.gemini_enabled === 'true',
    temperature: Math.min(2, Math.max(0, parseFloat(s.gemini_temperature) || 0.7)),
    maxTokens: Math.min(8192, Math.max(64, parseInt(s.gemini_max_tokens) || 1024)),
  };
}

export async function isGeminiActive() {
  const s = await getGeminiSettings();
  return s.enabled && !!s.apiKey;
}

/**
 * Llamada base a generateContent. Con jsonSchema fuerza salida JSON validable.
 * Lanza Error con mensaje legible si la API falla.
 */
/* Espera por defecto de una llamada. Las tareas de razonamiento largo (agrupar
   correspondencia, analizar una cadena con adjuntos) suben este valor: con los
   modelos "pro" una sola respuesta puede tardar más de un minuto. */
const DEFAULT_TIMEOUT_MS = 30000;

async function requestGemini({ apiKey, model, temperature, maxTokens }, contents, { jsonSchema = null, systemInstruction = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const body = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      ...(jsonSchema ? { responseMimeType: 'application/json', responseSchema: jsonSchema } : {}),
    },
  };
  if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(err.name === 'AbortError'
      ? `Tiempo de espera agotado conectando con Gemini (${Math.round(timeoutMs / 1000)}s)`
      : `No se pudo conectar con la API de Gemini: ${err.cause?.message || err.message}`);
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || `HTTP ${res.status}`;
    throw new Error(`Gemini API: ${msg}`);
  }
  const finishReason = data.candidates?.[0]?.finishReason || '';
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  if (!text) throw new Error(`Gemini no devolvió contenido (finishReason: ${finishReason || 'desconocido'})`);
  /* Con salida JSON forzada, agotar el presupuesto de tokens deja el JSON a medias
     y el JSON.parse del llamador falla con un error incomprensible. Se detecta aquí. */
  if (jsonSchema && finishReason === 'MAX_TOKENS') {
    throw new Error('La respuesta de Gemini se truncó por el límite de tokens de salida. Reduzca el tamaño del lote o aumente "Máx. tokens" en Configuración → Gemini Pro API.');
  }
  return text;
}

async function generateContent(cfg, prompt, { jsonSchema = null, systemInstruction = null, extraParts = [], timeoutMs } = {}) {
  return requestGemini(cfg, [{ role: 'user', parts: [{ text: prompt }, ...extraParts] }], { jsonSchema, systemInstruction, timeoutMs });
}

/** Chat multi-turno con el contexto de un proyecto. history: [{role:'user'|'assistant', text}] */
export async function chatWithProject(projectContext, history) {
  const cfg = await getGeminiSettings();
  if (!cfg.enabled || !cfg.apiKey) return null;
  const systemInstruction = `Eres el asistente del proyecto de compra pública dentro del sistema de la Unidad de Compras Públicas (UCP) de la PGR de El Salvador (Ley de Compras Públicas - LCP, DL 652/2023).
Responde SIEMPRE en español, de forma breve y directa (máximo ~120 palabras salvo que pidan detalle), basándote ÚNICAMENTE en el contexto del proyecto que se te da abajo.
Si te preguntan por el estado, el responsable, fechas, riesgos de vencimiento, presupuesto, correspondencia o pasos siguientes: responde con los datos del contexto, citando fechas y nombres concretos.
Si algo no está en el contexto, dilo claramente ("no consta en el expediente") en lugar de inventarlo.
La fecha de hoy es ${new Date().toISOString().slice(0, 10)}.

CONTEXTO DEL PROYECTO (JSON):
${JSON.stringify(projectContext).slice(0, 18000)}`;
  const contents = history.slice(-12).map(h => ({
    role: h.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(h.text || '').slice(0, 2000) }],
  }));
  return requestGemini({ ...cfg, temperature: 0.4, maxTokens: Math.max(cfg.maxTokens, 1536) }, contents, { systemInstruction });
}

/**
 * Chat multi-turno con el espacio de trabajo del usuario (correos, proyectos,
 * alertas y solicitudes propios + agregados institucionales de presupuesto/PAC).
 * El aislamiento por usuario lo garantiza quien arma `workspaceContext`
 * (assistant.routes.js); aquí solo se instruye al modelo a no salirse de él.
 * history: [{role:'user'|'assistant', text}]
 */
export async function chatWithWorkspace(workspaceContext, history) {
  const cfg = await getGeminiSettings();
  if (!cfg.enabled || !cfg.apiKey) return null;
  const systemInstruction = `Eres el asistente personal de trabajo dentro del sistema de la Unidad de Adquisiciones y Contrataciones Públicas (UACP) de la Procuraduría General de la República de El Salvador, alineado a la Ley de Compras Públicas (LCP, DL 652/2023), su ente rector DINAC y COMPRASAL.

Responde SIEMPRE en español, de forma breve y directa (máximo ~150 palabras salvo que pidan detalle o una lista).

REGLA CRÍTICA DE ALCANCE: el contexto de abajo contiene ÚNICAMENTE los datos del usuario que te pregunta (sus correos, sus proyectos, sus alertas y sus solicitudes) más cifras institucionales agregadas (presupuesto anual y PAC). Basa tus respuestas EXCLUSIVAMENTE en ese contexto.
- Nunca inventes ni supongas datos de otros usuarios, ni afirmes conocer proyectos o correos que no aparezcan aquí.
- Si te preguntan por información de otra persona o por algo que no está en el contexto, responde que no tienes acceso a esos datos y sugiere consultarlo con la UACP.
- Las cifras de presupuesto y PAC son totales institucionales compartidos: puedes citarlas como tales, pero no dispones del desglose por proyecto ajeno.

Cuando cites correos, proyectos o montos, usa nombres, códigos y fechas concretos del contexto. Si algo no consta, dilo claramente en lugar de inventarlo.
La fecha de hoy es ${new Date().toISOString().slice(0, 10)}.

CONTEXTO DEL USUARIO (JSON):
${JSON.stringify(workspaceContext).slice(0, 24000)}`;
  const contents = history.slice(-12).map(h => ({
    role: h.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(h.text || '').slice(0, 2000) }],
  }));
  return requestGemini({ ...cfg, temperature: 0.4, maxTokens: Math.max(cfg.maxTokens, 1536) }, contents, { systemInstruction });
}

/** Análisis ejecutivo IA de los riesgos de vencimiento detectados por el escáner de alertas. */
export async function summarizeDeadlineRisks(risks) {
  const cfg = await getGeminiSettings();
  if (!cfg.enabled || !cfg.apiKey) return null;
  const schema = { type: 'OBJECT', properties: { title: { type: 'STRING' }, message: { type: 'STRING' } }, required: ['title', 'message'] };
  const prompt = `Eres analista de la UCP de la PGR (El Salvador, LCP). El escáner de vencimientos detectó estos riesgos en la cartera de proyectos.
Genera en español: un título corto de alerta (máx 60 caracteres) y un mensaje ejecutivo (máx 600 caracteres) que priorice los casos más críticos, con cifras y acciones recomendadas concretas.

RIESGOS DETECTADOS (JSON):
${JSON.stringify(risks).slice(0, 8000)}`;
  const text = await generateContent({ ...cfg, temperature: 0.3 }, prompt, { jsonSchema: schema });
  return JSON.parse(text);
}

/** Prueba real de conexión. Acepta overrides (key/modelo del formulario sin guardar). */
export async function testConnection(overrides = {}) {
  const saved = await getGeminiSettings();
  const cfg = {
    ...saved,
    ...(overrides.apiKey ? { apiKey: overrides.apiKey } : {}),
    ...(overrides.model ? { model: overrides.model } : {}),
    temperature: 0,
    maxTokens: 1024,
  };
  if (!cfg.apiKey) throw new Error('No hay API Key configurada. Obtenga una en https://aistudio.google.com/apikey');
  const startedAt = Date.now();
  const text = await generateContent(cfg, 'Responde únicamente con la palabra: OK');
  return { model: cfg.model, latencyMs: Date.now() - startedAt, reply: text.trim().slice(0, 40) };
}

/* Tipos de adjunto que Gemini puede analizar inline */
const ANALYZABLE_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv']);
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;        // por adjunto
const MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024; // por solicitud

/** Convierte adjuntos {buffer, contentType, filename} en partes inlineData dentro del presupuesto de tamaño. */
export function buildAttachmentParts(attachments = []) {
  const parts = [];
  const names = [];
  let total = 0;
  for (const a of attachments) {
    const mime = (a.contentType || '').split(';')[0].trim().toLowerCase();
    if (!ANALYZABLE_MIME.has(mime)) { names.push(`${a.filename} (no analizable: ${mime || 'desconocido'})`); continue; }
    if (!a.buffer || a.buffer.length > MAX_ATTACHMENT_BYTES || total + a.buffer.length > MAX_TOTAL_ATTACHMENT_BYTES) {
      names.push(`${a.filename} (omitido por tamaño)`); continue;
    }
    total += a.buffer.length;
    names.push(a.filename);
    parts.push({ inlineData: { mimeType: mime, data: a.buffer.toString('base64') } });
  }
  return { parts, names };
}

/** Clasifica una correspondencia: categoría, prioridad y resumen. Analiza adjuntos (PDF/imágenes) si se proveen. */
export async function classifyCorrespondence(subject, body, attachments = []) {
  const cfg = await getGeminiSettings();
  if (!cfg.enabled || !cfg.apiKey) return null;
  const schema = {
    type: 'OBJECT',
    properties: {
      category: { type: 'STRING', enum: ['compras', 'aprobacion', 'revision', 'legal', 'alerta', 'evaluacion', 'adjudicacion', 'proveedores', 'seguridad', 'administrativo', 'informativo'] },
      priority: { type: 'STRING', enum: ['baja', 'media', 'alta', 'urgente'] },
      summary: { type: 'STRING' },
    },
    required: ['category', 'priority', 'summary'],
  };
  const { parts, names } = buildAttachmentParts(attachments);
  const prompt = `Eres el clasificador de correspondencia de la Unidad de Compras Públicas (UCP) de la PGR de El Salvador, regida por la Ley de Compras Públicas (LCP, DL 652/2023).
Clasifica el siguiente mensaje y genera un resumen de máximo 120 caracteres en español.
${names.length ? `El mensaje incluye ${names.length} documento(s) adjunto(s): ${names.join(', ')}. Analiza el contenido de los adjuntos provistos y refléjalo en la clasificación y el resumen.` : ''}

ASUNTO: ${subject}

CONTENIDO:
${String(body || '').slice(0, 6000)}`;
  const text = await generateContent({ ...cfg, temperature: 0.2, maxTokens: Math.max(cfg.maxTokens, 2048) }, prompt,
    { jsonSchema: schema, extraParts: parts, timeoutMs: parts.length ? 120000 : 60000 }); // analizar adjuntos tarda más
  const parsed = JSON.parse(text);
  return {
    category: parsed.category || '',
    priority: parsed.priority || '',
    summary: String(parsed.summary || '').slice(0, 480),
  };
}

/** Genera observaciones inteligentes del portafolio para el dashboard. */
export async function generateInsights(portfolioData) {
  const cfg = await getGeminiSettings();
  if (!cfg.enabled || !cfg.apiKey) return null;
  const schema = { type: 'OBJECT', properties: { insights: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['insights'] };
  const prompt = `Eres analista experto en compras públicas de El Salvador (Ley de Compras Públicas - LCP) en la PGR.
Analiza este estado del portafolio de adquisiciones y genera entre 5 y 8 observaciones ejecutivas accionables en español.
Cada observación: una sola oración o dos, concreta, con cifras, iniciando con un emoji relevante y una etiqueta corta en mayúsculas (ej: "⚠️ ATENCIÓN INMEDIATA: ...").
Considera los plazos de la LCP, la PAC, concentración de presupuesto, riesgos de vencimiento y carga de trabajo.

DATOS DEL PORTAFOLIO (JSON):
${JSON.stringify(portfolioData).slice(0, 12000)}`;
  const text = await generateContent({ ...cfg, maxTokens: Math.max(cfg.maxTokens, 2048) }, prompt, { jsonSchema: schema });
  const parsed = JSON.parse(text);
  return Array.isArray(parsed.insights) ? parsed.insights.filter(i => typeof i === 'string' && i.trim()) : null;
}

/** Analiza una cadena de correspondencia de un proyecto (con documentos adjuntos si se proveen).
    Incluye el ESTADO DEL PROYECTO que la evidencia del correo sugiere. */
export async function analyzeThread(projectTitle, messages, attachments = [], currentStatus = '') {
  const cfg = await getGeminiSettings();
  if (!cfg.enabled || !cfg.apiKey) return null;
  const schema = {
    type: 'OBJECT',
    properties: {
      summary: { type: 'STRING' },
      current_state: { type: 'STRING' },
      pending_actions: { type: 'ARRAY', items: { type: 'STRING' } },
      risk_level: { type: 'STRING', enum: ['bajo', 'medio', 'alto'] },
      suggested_status: { type: 'STRING', enum: ['borrador', 'en_revision', 'aprobado', 'en_proceso', 'adjudicado', 'completado', 'cancelado'] },
      suggested_status_reason: { type: 'STRING' },
      documents_findings: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['summary', 'current_state', 'pending_actions', 'risk_level', 'suggested_status', 'suggested_status_reason'],
  };
  const { parts, names } = buildAttachmentParts(attachments);
  const corpus = messages.map(m => `[${m.created_at}] DE: ${m.from_name || m.external_from || 'Sistema'} | ASUNTO: ${m.subject}\n${String(m.body || '').slice(0, 1200)}`).join('\n---\n');
  const prompt = `Eres analista de la Unidad de Compras Públicas (UCP) de la PGR (El Salvador, Ley de Compras Públicas - LCP). Analiza esta cadena de correspondencia del proyecto "${projectTitle}".
El ciclo de compra pública LCP tiene las fases: planificación → selección del contratista → contratación → seguimiento → liquidación.
Estados posibles del proyecto en el sistema: borrador → en_revision → aprobado → en_proceso → adjudicado → completado (o cancelado).
Estado registrado actualmente en el sistema: "${currentStatus || 'desconocido'}".
Devuelve en español:
- resumen ejecutivo (máx 300 caracteres)
- estado actual del trámite (descripción)
- acciones pendientes concretas
- nivel de riesgo de incumplimiento de plazos
- suggested_status: el estado del flujo que la EVIDENCIA de los correos y documentos respalda (puede coincidir o no con el registrado)
- suggested_status_reason: justificación breve citando la evidencia (correo o documento)
${names.length ? `- documents_findings: hallazgos concretos extraídos de los documentos adjuntos provistos (${names.join(', ')})` : ''}

CADENA (${messages.length} mensajes, orden cronológico):
${corpus.slice(0, 14000)}`;
  const text = await generateContent({ ...cfg, temperature: 0.3, maxTokens: Math.max(cfg.maxTokens, 3072) }, prompt,
    { jsonSchema: schema, extraParts: parts, timeoutMs: 180000 }); // la cadena puede llevar PDFs adjuntos
  return JSON.parse(text);
}

/**
 * Agrupa correspondencia suelta en EXPEDIENTES/PROYECTOS de compra pública.
 *
 * Recibe los correos ya importados y clasificados (asunto, resumen IA, remitente,
 * fecha) junto con los proyectos que YA existen, y devuelve los grupos que la
 * evidencia respalda: cada grupo es un proyecto (existente o nuevo) con los
 * correos que le pertenecen. Los mensajes que no corresponden a ninguna
 * adquisición (notificaciones automáticas, boletines, spam) quedan fuera.
 *
 * items: [{id, subject, ai_summary, ai_category, ai_priority, from, date}]
 * existingProjects: [{id, title, status}]
 */
export async function groupCorrespondencesIntoProjects(items, existingProjects = []) {
  const cfg = await getGeminiSettings();
  if (!cfg.enabled || !cfg.apiKey) return null;
  const schema = {
    type: 'OBJECT',
    properties: {
      groups: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            project_id: { type: 'INTEGER' }, // id de un proyecto existente, o 0 si es nuevo
            title: { type: 'STRING' },
            description: { type: 'STRING' },
            priority: { type: 'STRING', enum: ['baja', 'media', 'alta', 'urgente'] },
            suggested_status: { type: 'STRING', enum: ['borrador', 'en_revision', 'aprobado', 'en_proceso', 'adjudicado', 'completado', 'cancelado'] },
            estimated_amount: { type: 'NUMBER' },
            rationale: { type: 'STRING' },
            correspondence_ids: { type: 'ARRAY', items: { type: 'INTEGER' } },
          },
          required: ['project_id', 'title', 'description', 'priority', 'suggested_status', 'rationale', 'correspondence_ids'],
        },
      },
      unassigned_ids: { type: 'ARRAY', items: { type: 'INTEGER' } },
    },
    required: ['groups', 'unassigned_ids'],
  };

  const projectList = existingProjects.length
    ? existingProjects.map(p => `  - id ${p.id}: "${p.title}" (estado: ${p.status || 'borrador'})`).join('\n')
    : '  (todavía no hay proyectos registrados)';

  const corpus = items.map(i =>
    `- id ${i.id} | ${String(i.date || '').slice(0, 10)} | DE: ${String(i.from || 'desconocido').slice(0, 80)} | CAT: ${i.ai_category || '—'} | ASUNTO: ${String(i.subject || '').slice(0, 200)}${i.ai_summary ? `\n    RESUMEN: ${String(i.ai_summary).slice(0, 240)}` : ''}`
  ).join('\n');

  const prompt = `Eres el analista documental de la Unidad de Adquisiciones y Contrataciones Públicas (UACP) de la Procuraduría General de la República de El Salvador, bajo la Ley de Compras Públicas (LCP, DL 652/2023; ente rector DINAC, sistema COMPRASAL).

TAREA: organizar la correspondencia de abajo en EXPEDIENTES de compra pública. Un expediente (proyecto) agrupa todos los correos referidos a UNA MISMA adquisición o proceso: la solicitud, cotizaciones, aprobaciones, evaluación de ofertas, adjudicación, orden de compra, contrato y su seguimiento.

REGLAS:
1. Agrupa por el PROCESO DE ADQUISICIÓN al que se refiere el correo, no por remitente ni por fecha. Correos con asuntos distintos ("Solicitud de cotización sillas ergonómicas", "RE: cotización mobiliario", "Adjudicación mobiliario UACP") pertenecen al MISMO expediente si tratan de la misma compra.
2. Si el correo corresponde a uno de los PROYECTOS YA EXISTENTES, usa su id en project_id. Si abre un expediente nuevo, usa project_id = 0 y propón un título claro y específico (máx 90 caracteres, ej. "Adquisición de mobiliario de oficina para la UACP").
3. NO fuerces agrupaciones: un correo que no trate de una adquisición concreta (notificaciones automáticas, boletines, publicidad, correos personales, avisos de sistema, spam) va en unassigned_ids. Es preferible dejarlo sin asignar que inventar un expediente.
4. Un expediente nuevo debe tener al menos 1 correo con contenido real de compra pública. No crees expedientes genéricos tipo "Correos varios" o "Notificaciones".
5. Cada id de correo puede aparecer UNA SOLA VEZ, en un único grupo o en unassigned_ids.
6. Usa SOLO los id que aparecen en la lista. No inventes id.
7. description: 1 o 2 oraciones en español sobre el objeto de la adquisición.
8. suggested_status: la fase que la evidencia de los correos respalda (borrador → en_revision → aprobado → en_proceso → adjudicado → completado).
9. estimated_amount: monto en dólares si aparece en los correos; 0 si no consta. No lo inventes.
10. rationale: en una oración, la evidencia concreta que sustenta el grupo.

PROYECTOS YA EXISTENTES:
${projectList}

CORRESPONDENCIA A ORGANIZAR (${items.length} correos):
${corpus.slice(0, 30000)}`;

  /* El JSON de salida crece con el número de grupos (un objeto por expediente más
     la lista de ids): 8192 tokens se agotaban a mitad de la respuesta. */
  const text = await generateContent(
    { ...cfg, temperature: 0.2, maxTokens: Math.max(cfg.maxTokens, 32768) },
    prompt,
    { jsonSchema: schema, timeoutMs: 240000 } // razonamiento largo sobre decenas de correos
  );
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Gemini devolvió una respuesta JSON incompleta al agrupar la correspondencia. Reintente con un lote menor.');
  }
  return {
    groups: Array.isArray(parsed.groups) ? parsed.groups : [],
    unassigned_ids: Array.isArray(parsed.unassigned_ids) ? parsed.unassigned_ids : [],
  };
}

/** Asistente LCP: explica el método de contratación aplicable a un monto (Ley de Compras Públicas, DL 652/2023). */
export async function adviseLcp(amount, description, thresholds = {}) {
  const cfg = await getGeminiSettings();
  if (!cfg.enabled || !cfg.apiKey) return null;
  const schema = {
    type: 'OBJECT',
    properties: {
      recommendation: { type: 'STRING' },
      considerations: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['recommendation', 'considerations'],
  };
  const limit = Number(thresholds.competitiveThreshold || 87600).toLocaleString('en-US');
  const bajaCuantia = thresholds.bajaCuantiaLimit > 0 ? `Baja Cuantía hasta $${Number(thresholds.bajaCuantiaLimit).toLocaleString('en-US')} (Art. 44, fondo circulante, excluida de la PAC); ` : '';
  const prompt = `Eres asesor legal en compras públicas de El Salvador bajo la Ley de Compras Públicas (LCP, DL 652/2023, que derogó la LACAP). Ente rector: DINAC; sistema: COMPRASAL.
Métodos y umbrales vigentes: ${bajaCuantia}Comparación de Precios hasta $${limit} = 240 salarios mínimos del sector comercio (Art. 40, mínimo 3 ofertantes); Licitación Competitiva mayor a $${limit} (Art. 39, documento de solicitud publicado en COMPRASAL, Panel Evaluador de Ofertas); Contratación Directa solo en casos de excepción tasados (Art. 41, sin límite de monto).
Para una adquisición de $${Number(amount).toLocaleString('en-US')} ${description ? `descrita como: "${String(description).slice(0, 500)}"` : ''}
da en español una recomendación breve de método y base legal LCP (máx 250 caracteres) y de 2 a 4 consideraciones prácticas (documento de solicitud, plazos de evaluación, PAC/COMPRASAL, riesgos).`;
  const text = await generateContent({ ...cfg, temperature: 0.3 }, prompt, { jsonSchema: schema });
  return JSON.parse(text);
}
