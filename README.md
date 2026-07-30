# PGR - Sistema de Compras Públicas UACP

**Procuraduría General de la República · Unidad de Adquisiciones y Contrataciones Públicas**

## Stack Tecnológico

| Componente | Tecnología |
|-----------|-----------|
| Backend | Node.js + Express 5 + SQL Server |
| Base de datos | Microsoft SQL Server 2017+ (probado con SQL Server 2025 Express) |
| Frontend | React 19 + Vite |
| Auth | JWT + bcrypt |
| IA | Google Gemini (REST API, configurable desde el panel admin) |
| Correo | IMAP (imapflow) + SMTP (nodemailer) reales por usuario |

## Funciones de IA (Gemini) — reales

Se configuran en **Configuración → Gemini Pro API** (rol admin). Obtenga una API Key gratuita en
[Google AI Studio](https://aistudio.google.com/apikey), péguela, elija modelo (recomendado
`gemini-2.5-flash`), marque **Activado** y use **Probar Conexión** (hace una llamada real a Google
y reporta latencia y errores reales).

| Función | Dónde | Comportamiento sin Gemini |
|---------|-------|---------------------------|
| Observaciones inteligentes del portafolio | Dashboard | Análisis por reglas (se indica en el panel) |
| Clasificación de correspondencia (categoría/prioridad/resumen, incluye adjuntos) | Al enviar o sincronizar correos | Sin clasificar |
| Análisis de cadenas por proyecto (resumen, riesgo, acciones, estado sugerido) | Bandeja → vista hilos → "Analizar con Gemini" | Mensaje indicando cómo activarlo |
| Asistente LCP (método de contratación y asesoría según monto) | Procesos de Compra → Nueva → "Asistente LCP" | Solo la regla de umbrales LCP (siempre funciona) |
| **Chat del proyecto** (botón flotante 💬 en el detalle): pregunta estado, responsable, fechas, riesgos, correspondencia | Proyectos → detalle | Mensaje indicando cómo activarlo |
| **Análisis ejecutivo de riesgos de vencimiento** para administración | Generado por el escáner de alertas | Solo alertas por reglas (siempre funcionan) |

### Escáner de vencimientos (sistema de alertas)

El servidor vigila la cartera automáticamente (configurable en Configuración → Seguimiento; default cada 12 h, mínimo 1 h) y también manualmente con **"Escanear Vencimientos"** en Gestión de Alertas:

- **Vencidos**: deadline pasada y proceso activo → alerta urgente al responsable asignado.
- **Por vencer**: deadline dentro de 7 días → alerta de advertencia.
- **Sin actividad**: proyecto activo sin eventos de seguimiento en 14 días → alerta informativa.
- Anti-duplicados (la misma alerta no se repite en 3 días) y, con Gemini activo, un **análisis ejecutivo de riesgos** dirigido a admin/jefe UCP.

También puede definirse `GEMINI_API_KEY` en `backend/.env` (tiene prioridad sobre la clave guardada en BD).

## Correo electrónico real (IMAP/SMTP)

### Getting Started (usuarios nuevos)

Al primer inicio de sesión de un usuario nuevo aparece un **asistente de bienvenida** que lo guía
para conectar su cuenta de **Gmail** en 3 pasos: qué logrará, cómo generar su **App Password** de
Google (con enlaces directos a la verificación en 2 pasos y a las contraseñas de aplicación), y la
conexión con **validación real contra Gmail** + primera sincronización automática. Tiene botón
**"Omitir por ahora"** en todo momento (nunca bloquea); la configuración queda disponible después
en la sección **Correo Electrónico**. El estado se guarda en BD (`users.onboarding_done`), por lo
que el asistente no vuelve a aparecer en ningún dispositivo tras completarse u omitirse.

Cada usuario configura su cuenta en **Configuración de Correo**:

- **Probar Conexión** valida IMAP y SMTP de verdad contra el servidor configurado.
- **Sincronizar Ahora** importa los últimos correos del buzón INBOX al sistema (sin duplicados,
  clasificados con Gemini si está activo).
- Al redactar correspondencia interna se puede marcar **"Enviar también por correo electrónico real
  (SMTP)"** para entregar el mensaje al email del destinatario.
- Para Gmail/Outlook se requiere App Password.
- Si un antivirus intercepta los puertos de correo (AVG/Avast Mail Shield), defina
  `EMAIL_ALLOW_INVALID_CERTS=true` en `backend/.env` (solo desarrollo).

## Despliegue en GCP / Linux

Para instalar en **Google Cloud Platform** (Compute Engine o Cloud Run + Cloud SQL for SQL Server) o en
**servidores Linux** (Ubuntu + SQL Server para Linux), siga el manual dedicado:

- [MANUAL_INSTALACION_GCP_LINUX.md](MANUAL_INSTALACION_GCP_LINUX.md) (versión Markdown)
- `Manual_Instalacion_PGR_GCP_Linux_v1.docx` (versión Word — se regenera con `python gen_manual_gcp_docx.py`)
- Archivos de despliegue en [deploy/](deploy/): `Dockerfile`, `pgr-backend.service` (systemd), `nginx-pgr.conf`

> En Linux instale el backend con `npm ci --omit=optional` (omite `msnodesqlv8`, que es solo-Windows)
> y use autenticación SQL (`DB_TRUSTED_CONNECTION=false`).

## Requisitos (instalación local Windows)

- Node.js 20 o superior (probado en Node 24; con Node 24 se requiere `msnodesqlv8` ≥ 5.2.0,
  ya fijado en `backend/package.json` — un `npm install` limpio descarga el binario nativo correcto)
- SQL Server (instancia local `SQLEXPRESS` por defecto) con ODBC Driver 17/18
- `sqlcmd` (para crear el esquema). Las herramientas modernas (`mssql-tools18`) exigen el flag
  `-C` para confiar en el certificado autofirmado de SQL Server; ya está incluido en `db:schema` e `iniciar.bat`.

## Instalación

```bash
# 1. Crear la base de datos y el esquema
cd backend
npm run db:schema        # ejecuta sql/001..008 contra localhost\SQLEXPRESS (idempotente, usa -C)

# 2. Configurar variables de entorno
cp .env.example .env     # ajustar JWT_SECRET, credenciales de BD, etc.

# 3. Instalar dependencias y sembrar datos
npm install
npm run seed             # datos iniciales + datos demo (SEED_DEMO_DATA=false para omitir demo)

# 4. Iniciar
npm run dev              # backend en :3621
cd ../frontend && npm install && npm run dev   # frontend en :5176
```

En Windows también puede usarse `iniciar.bat` desde la raíz del proyecto.

> 📘 Guía completa de SQL Server (instalación, modo mixto, TCP/IP, respaldos, troubleshooting):
> [GUIA_CONFIGURACION_SQL_SERVER.md](GUIA_CONFIGURACION_SQL_SERVER.md) ·
> versión Word: `Guia_Configuracion_SQL_Server_PGR_v1.docx` (se regenera con `python gen_guia_sql_docx.py`)

## Configuración de base de datos (`backend/.env`)

**Autenticación Windows** (desarrollo local, por defecto):

```env
DB_TRUSTED_CONNECTION=true
DB_SERVER=localhost
DB_INSTANCE=SQLEXPRESS
DB_DATABASE=PGR_Compras
DB_ODBC_DRIVER=ODBC Driver 18 for SQL Server
```

**Autenticación SQL** (producción / servidor remoto):

```env
DB_TRUSTED_CONNECTION=false
DB_SERVER=servidor.pgr.gob.sv
DB_PORT=1433
DB_DATABASE=PGR_Compras
DB_USER=pgr_app
DB_PASSWORD=********
DB_ENCRYPT=true
```

## Bitácora de auditoría (DL 113/2024)

El sistema mantiene un **registro de acciones a prueba de manipulación** (Configuración → Bitácora, solo administrador general):

- **Registro automático** de toda operación que modifica datos (quién, qué, cuándo, desde qué IP, con qué resultado), más eventos de seguridad: **intentos de login fallidos** (con motivo, nunca la contraseña), inicios de sesión, **impersonaciones** (las acciones en sesión de control quedan marcadas "VÍA ADMIN") y **descargas de documentos adjuntos**.
- **Saneo automático**: contraseñas, claves de API y secretos jamás se escriben (se reemplazan por `[REDACTADO]`).
- **Integridad encadenada**: cada registro guarda un hash SHA-256 que encadena al anterior; el botón **"Verificar integridad"** recorre toda la cadena y detecta cualquier alteración o borrado de registros (probado en la suite: una manipulación directa en BD es detectada con el registro exacto).
- Visor con filtros (texto, usuario, fechas, solo fallos), paginación y **export CSV** para entregar a auditoría.
- La bitácora es **append-only** por diseño: no hay endpoints para editarla ni borrarla. Nota operativa: asume una sola instancia del backend escribiendo (la cadena se serializa en proceso).

## Pruebas (auditoría de operatividad)

```bash
cd backend
npm test     # 50 pruebas en ~2.5s (node:test nativo, sin dependencias extra)
```

| Suite | Qué verifica |
|-------|--------------|
| `test/lcp.unit.test.js` | Reglas LCP puras: umbrales exactos ($87,600 inclusive), Baja Cuantía, escalado por salario mínimo, fases del ciclo |
| `test/gemini.unit.test.js` | Preparación de adjuntos para IA: tipos analizables, normalización MIME, límites de 4MB/10MB |
| `test/api.integration.test.js` | Operatividad real contra SQL Server: salud, autenticación (401/409/onboarding), autorización por rol (solicitante/jefe/admin/impersonación), ciclo de proyectos con auditoría en timeline, correspondencia con control de acceso, PAC (correlativos, exclusión de Baja Cuantía, totales), asistente LCP, escáner de alertas, presupuesto (consistencia aritmética), catálogos modernizados a LCP |

Los datos de prueba usan el prefijo `TEST-AUDIT` y se eliminan automáticamente al finalizar.

## Estructura del backend

```
backend/
├── server.js                  # Punto de entrada (Express, rutas, arranque)
├── sql/001_schema.sql         # Esquema T-SQL (idempotente)
├── src/
│   ├── config.js              # Configuración desde variables de entorno
│   ├── db.js                  # Pool de conexiones mssql + helpers all/get/run
│   ├── seed.js                # Datos iniciales (npm run seed)
│   ├── middleware/auth.js     # JWT: signToken, requireAuth, requireAdmin
│   └── routes/                # Rutas por módulo
│       ├── auth.routes.js
│       ├── dashboard.routes.js
│       ├── correspondences.routes.js
│       ├── projects.routes.js
│       ├── catalog.routes.js  # categorías + unidades
│       ├── procurement.routes.js
│       ├── alerts.routes.js
│       ├── admin.routes.js
│       └── emailConfig.routes.js
```

## Puertos

- **Backend API**: `http://localhost:3621`
- **Frontend**: `http://localhost:5176`

## Credenciales Admin (desarrollo)

- **DUI**: `00000000-0`
- **Contraseña**: `AdminPGR2024!`

> En producción definir `ADMIN_DOC`, `ADMIN_PASSWORD` y `JWT_SECRET` en `.env` (el servidor no arranca en producción sin `JWT_SECRET`).

## Módulos

1. **Dashboard** — KPIs, vencimientos próximos, proyectos recientes, distribución por categorías
2. **Bandeja de Entrada** — Interfaz Gmail-like con clasificación IA, destacados, archivo, búsqueda
3. **Proyectos** — Seguimiento de proyectos de compra con estados, prioridades, deadlines; **edición manual** de fechas de inicio/fin, responsable, presupuesto y demás campos (cada cambio queda registrado en el timeline)
4. **Solicitudes LACAP** — Creación de solicitudes basadas en la Ley de Adquisiciones y Contrataciones (LACAP)
5. **Alertas** — Sistema de alertas para vencimientos y cambios de estado
6. **Unidades Solicitantes** — Directorio de unidades institucionales
7. **Seguimiento de Proyectos (admin)** — Configuración → Seguimiento: estado de cada proyecto de la unidad (fechas, responsable, último seguimiento, actividad) y botón para **sincronizar los buzones de correo de toda la unidad** (cada correo se organiza en el perfil de su dueño)
8. **Sincronización automática de correo** — el servidor sincroniza todos los buzones activos en segundo plano, con intervalo configurable (mínimo 1 minuto) desde Configuración → Seguimiento (solo admin); los cambios aplican sin reiniciar
9. **Adjuntos de correo** — al sincronizar se guardan los documentos adjuntos (descargables desde el detalle del correo) y **Gemini los analiza** (PDF/imágenes) para clasificar; el análisis de cadenas sugiere el **estado del proyecto según la evidencia** de correos y documentos, aplicable con un clic
10. **Login como (control de admin)** — el administrador general puede entrar a la cuenta de cualquier usuario desde Gestión de Usuarios, con banner permanente y retorno seguro a su sesión
10b. **Gestión de Usuarios** (acceso directo "Usuarios" en el menú, admin/jefe UCP) — el admin crea las cuentas con **clave temporal** (botón "Generar"), cargo, teléfono, rol y unidad; las credenciales se muestran una sola vez para entregarlas por canal seguro. El usuario está **obligado a cambiar la clave en su primer ingreso** (pantalla bloqueante con requisitos de fortaleza); el reseteo de clave por el admin reactiva la obligación. Cada usuario gestiona sus datos de contacto y su contraseña desde **Mi Perfil** (clic en su nombre, barra superior)
11. **Presupuesto anual de compras** — el admin define año y monto; el dashboard muestra a toda la unidad el cumplimiento (comprometido/ejecutado/disponible) con alerta si se excede

> El tab **Gemini Pro API** solo es visible y accesible para la cuenta de **administrador general** (rol `admin`); el jefe UACP ve el resto de la configuración.

## Marco legal: Ley de Compras Públicas (LCP, DL 652/2023)

El sistema está alineado a la **LCP** (que derogó la LACAP en marzo 2023), su ente rector **DINAC** y el sistema **COMPRASAL**. Métodos de contratación para obras, bienes y servicios:

- **Comparación de Precios** — Hasta 240 salarios mínimos del sector comercio (~$87,600) (Art. 40)
- **Licitación Competitiva** — Más de 240 salarios mínimos (Art. 39)
- **Contratación Directa** — Casos de excepción tasados, sin límite de monto (Art. 41)
- **Baja Cuantía** — Compras inmediatas por fondo circulante; el límite lo define la máxima autoridad (Art. 44). **Se excluye de la PAC** y se reporta mensualmente en COMPRASAL.

El salario mínimo (umbral) y el límite institucional de Baja Cuantía son **configurables** en Configuración → Seguimiento.

### Módulo PAC (Planificación Anual de Compras — LCP Art. 17)

Listado referencial del ejercicio fiscal con el formato DINAC: correlativo, descripción del objeto,
código ONU (UNSPSC), unidad solicitante, fuente de financiamiento, método de contratación, monto
estimado y mes estimado. Incluye resumen vs. presupuesto anual, programación por trimestre, estado
de cada proceso (programado → en proceso → contratado), vínculo al proyecto de seguimiento y
**exportación CSV** para carga en COMPRASAL. Debe publicarse dentro de los 30 días de iniciado el
ejercicio fiscal.

### Ciclo de compra pública (LCP Art. 1)

Cada proyecto muestra su **fase LCP** derivada del estado: Planificación → Selección del
contratista → Contratación → Seguimiento → Liquidación.

## API Endpoints

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/health` | No | Health check |
| POST | `/api/auth/login` | No | Login |
| POST | `/api/auth/register` | No | Registro |
| GET | `/api/auth/me` | Sí | Usuario actual |
| GET | `/api/dashboard/stats` | Sí | Estadísticas dashboard |
| GET | `/api/dashboard/ai-insights` | Sí | Análisis del portafolio |
| GET | `/api/correspondences` | Sí | Listar correspondencia |
| GET | `/api/correspondences/by-project` | Sí | Hilos agrupados por proyecto |
| POST | `/api/correspondences` | Sí | Enviar correspondencia |
| PUT | `/api/correspondences/:id/star` | Sí | Destacar/quitar |
| PUT | `/api/correspondences/:id/read` | Sí | Marcar como leído |
| PUT | `/api/correspondences/:id/archive` | Sí | Archivar |
| GET | `/api/projects` | Sí | Listar proyectos |
| POST | `/api/projects` | Sí | Crear proyecto |
| PUT | `/api/projects/:id/status` | Sí | Cambiar estado |
| PUT | `/api/projects/:id` | Sí | Edición manual (fechas inicio/fin, responsable, etc.; registra el cambio en el timeline) |
| GET | `/api/projects/:id/detail` | Sí | Detalle con timeline |
| POST | `/api/projects/:id/events` | Sí | Agregar evento al timeline |
| GET | `/api/admin/projects/overview` | Admin | Seguimiento general de todos los proyectos |
| POST | `/api/admin/email-sync-all` | Admin | Sincronizar buzones IMAP de toda la unidad |
| POST | `/api/admin/impersonate/:id` | Admin general | Login como otro usuario (control) |
| GET | `/api/correspondences/:id/attachments` | Sí | Adjuntos del correo |
| GET | `/api/correspondences/:id/attachments/:attId/download` | Sí | Descargar adjunto |
| GET | `/api/dashboard/budget-compliance` | Sí | Cumplimiento del presupuesto anual |
| GET/POST/PUT/DELETE | `/api/pac` | Sí (DELETE admin) | Planificación Anual de Compras (PAC) |
| POST | `/api/projects/:id/chat` | Sí | Chat IA con el expediente del proyecto |
| POST | `/api/admin/alerts/scan` | Admin | Escaneo manual de vencimientos |
| POST | `/api/auth/change-password` | Sí | Cambio de contraseña propio (limpia la clave temporal) |
| PUT | `/api/auth/profile` | Sí | Actualizar datos de contacto propios |
| GET | `/api/admin/audit` | Admin general | Bitácora de auditoría (filtros + paginación) |
| GET | `/api/admin/audit/verify` | Admin general | Verificación de integridad de la cadena hash |
| GET | `/api/categories` | No | Categorías |
| GET | `/api/units` | No | Unidades solicitantes |
| POST/PUT/DELETE | `/api/units...` | Admin | CRUD de unidades |
| GET | `/api/procurement` | Sí | Solicitudes LACAP |
| POST | `/api/procurement` | Sí | Nueva solicitud |
| POST | `/api/procurement/suggest` | Sí | Asistente LACAP (modalidad por monto + asesoría Gemini) |
| POST | `/api/correspondences/by-project/:id/analyze` | Sí | Análisis Gemini de la cadena del proyecto |
| GET | `/api/users/directory` | Sí | Directorio de usuarios activos (destinatarios) |
| GET | `/api/alerts` | Sí | Alertas del usuario |
| PUT | `/api/alerts/:id/read` | Sí | Marcar alerta leída |
| GET/POST/PUT/DELETE | `/api/admin/...` | Admin | Usuarios, alertas, configuración |
| POST | `/api/admin/gemini/test` | Admin | Prueba real de conexión con Gemini |
| GET/PUT | `/api/email-config` | Sí | Configuración de correo del usuario |
| POST | `/api/email-config/test` | Sí | Prueba real IMAP/SMTP |
| POST | `/api/email-config/sync` | Sí | Sincronizar buzón IMAP al sistema |

## Nota: npm detrás de AVG Antivirus

Si `npm install` falla con `UNABLE_TO_VERIFY_LEAF_SIGNATURE` (AVG intercepta TLS), usar el certificado exportado en `.certs/`:

```bash
NODE_EXTRA_CA_CERTS="C:\repository\PGR\.certs\avg-root.pem" npm install
```
