# Informe de Instalación y Puesta en Marcha
## Sistema PGR — Compras Públicas UACP

**Procuraduría General de la República · Unidad de Adquisiciones y Contrataciones Públicas**

| Dato | Valor |
|------|-------|
| Fecha del informe | 2026-06-03 |
| Versión del sistema | 1.0.0 (backend y frontend) |
| Propósito de uso | **Análisis de proyectos de compra** y **seguimiento en tiempo real** |
| Estado del entorno | Node.js v22.22.3 y npm 10.9.8 detectados · dependencias **pendientes de instalar** |

---

## 1. Resumen ejecutivo

El sistema PGR es una aplicación web compuesta por dos servicios independientes:

- **Backend** — API REST en Node.js + Express 5 con base de datos SQLite (archivo local, sin servidor de BD externo). Maneja autenticación (JWT + bcrypt), proyectos, solicitudes LACAP, correspondencia y la línea de tiempo de eventos.
- **Frontend** — Aplicación React 19 servida con Vite, que consume la API y muestra el dashboard, los proyectos y las alertas.

Para los dos objetivos planteados, el sistema ya incluye la base funcional:

- **Análisis de proyectos** → módulo *Dashboard* con KPIs (`/api/dashboard/stats`): total de proyectos, proyectos por estado, por categoría, presupuestos y próximos vencimientos. Cada proyecto tiene detalle con línea de tiempo (`/api/projects/:id/detail`).
- **Seguimiento en tiempo real** → tabla `project_events` que registra cada cambio de estado y evento del proyecto, más el módulo de *Alertas* (`alerts`) para vencimientos y cambios de estado. (Ver la sección 7 sobre el alcance real del "tiempo real").

---

## 2. Requisitos

### 2.1 Software (mínimo)

| Requisito | Versión recomendada | Estado en este equipo |
|-----------|--------------------|------------------------|
| Node.js | ≥ 18 LTS (probado en v22) | ✅ v22.22.3 |
| npm | ≥ 9 | ✅ 10.9.8 |
| Sistema operativo | Windows 10/11, Linux o macOS | ✅ Windows 11 Pro |
| Navegador | Chrome / Edge / Firefox actualizado | — |

> SQLite no requiere instalación aparte: se incluye como dependencia (`sqlite3`) y la base se crea como archivo local en `backend/database/pgr_compras.db`.

### 2.2 Hardware (referencia para uso institucional)

| Recurso | Mínimo | Recomendado (varios usuarios) |
|---------|--------|-------------------------------|
| CPU | 2 núcleos | 4 núcleos |
| RAM | 2 GB | 4–8 GB |
| Disco | 500 MB libres | 2 GB (crecimiento de BD y adjuntos) |
| Red | Localhost | LAN institucional / IP fija |

### 2.3 Puertos de red

| Servicio | Puerto | Origen |
|----------|--------|--------|
| Backend API | `3621` | Configurable con `PORT` |
| Frontend (Vite) | `5176` | Definido en `vite.config.js` |

El frontend hace *proxy* de `/api` hacia `http://localhost:3621`, por lo que ambos deben correr a la vez.

---

## 3. Procedimiento de instalación

### Opción A — Automática (Windows)

Desde la raíz del proyecto, ejecutar:

```bat
iniciar.bat
```

El script instala dependencias de backend y frontend si faltan, y abre dos ventanas: backend (`node --watch server.js`) y frontend (`npx vite`).

### Opción B — Manual (recomendada para servidor / control paso a paso)

```bash
# 1) Backend
cd backend
npm install
npm run dev        # desarrollo (recarga automática) — o: npm start (producción)

# 2) Frontend (en otra terminal)
cd frontend
npm install
npm run dev        # desarrollo — o: npm run build && npm run preview (producción)
```

### Verificación post-instalación

1. **API viva:** abrir `http://localhost:3621/api/health` → debe responder `{"ok":true,"system":"PGR-Compras-Publicas"}`.
2. **Frontend:** abrir `http://localhost:5176` → debe cargar la pantalla de login.
3. **Acceso:** ingresar con las credenciales de administrador (sección 5).
4. **Datos de prueba:** el backend siembra automáticamente unidades, categorías, 12 proyectos y eventos de ejemplo en el primer arranque, útil para validar el módulo de análisis sin cargar datos reales.

---

## 4. Configuración (variables de entorno)

El backend lee estas variables (todas con valor por defecto, pero **deben cambiarse en producción**):

| Variable | Valor por defecto | Recomendación |
|----------|-------------------|---------------|
| `PORT` | `3621` | Mantener o ajustar según red |
| `JWT_SECRET` | `pgr-compras-publicas-secret-change-me` | **Cambiar obligatoriamente** por una cadena larga y aleatoria |
| `ADMIN_DOC` | `00000000-0` | Definir DUI real del administrador |
| `ADMIN_PASSWORD` | `AdminPGR2024!` | **Cambiar** antes de producción |
| `CORS_ORIGIN` | `*` (todos) | Restringir al dominio/IP del frontend |

Ejemplo en Windows (PowerShell), antes de arrancar el backend:

```powershell
$env:JWT_SECRET="<cadena-larga-aleatoria>"
$env:ADMIN_PASSWORD="<contraseña-fuerte>"
$env:CORS_ORIGIN="http://localhost:5176"
npm start
```

---

## 5. Credenciales iniciales

| Campo | Valor por defecto |
|-------|-------------------|
| DUI | `00000000-0` |
| Contraseña | `AdminPGR2024!` |

> ⚠️ Cambiar la contraseña del administrador en el primer acceso y crear usuarios reales por rol (`admin`, `jefe_uacp`, `analista`, `solicitante`).

---

## 6. Uso 1 — Análisis de proyectos

El sistema cubre el análisis a través de:

- **Dashboard de KPIs** (`GET /api/dashboard/stats`): totales de proyectos, solicitudes y unidades; conteo de proyectos pendientes; distribución por estado y por categoría; próximos vencimientos.
- **Listado y detalle de proyectos** (`/api/projects`, `/api/projects/:id/detail`): estado, prioridad, presupuesto estimado, referencia legal LACAP, unidad solicitante y responsable asignado.
- **Categorización LACAP**: Libre Gestión, Licitación por Invitación, Licitación Pública, Contratación Directa, etc.
- **Gráficas**: el frontend usa `recharts` para visualizar distribución por estado/categoría y presupuesto.

Esto permite responder preguntas de análisis como: ¿cuántos proyectos hay por estado?, ¿qué unidad concentra más presupuesto?, ¿qué procesos están por vencer?

---

## 7. Uso 2 — Seguimiento en tiempo real

### Lo que el sistema ya hace

- **Línea de tiempo por proyecto** (`project_events`): cada creación, cambio de estado, documento, hito o nota queda registrada con fecha, usuario y valores anterior/nuevo. Es la base del seguimiento.
- **Alertas** (`alerts`): vencimientos próximos (`deadline_warning`), cambios de estado y eventos informativos por usuario.
- **Recarga automática en desarrollo**: `node --watch` (backend) y Vite HMR (frontend) reflejan cambios al instante mientras se desarrolla.

### Importante: alcance del "tiempo real"

Tal como está hoy, **la interfaz NO se actualiza sola**: el frontend obtiene datos cuando se carga o se navega (modelo *request/response*). Para lograr un seguimiento "en tiempo real" en el sentido de **actualización automática en pantalla sin recargar**, se requiere una de estas mejoras (no incluidas aún):

| Opción | Esfuerzo | Descripción |
|--------|----------|-------------|
| **Polling** | Bajo | El frontend consulta `/api/dashboard/stats` o `/api/projects` cada N segundos. Rápido de implementar. |
| **Server-Sent Events (SSE)** | Medio | El backend empuja eventos nuevos (`project_events`/`alerts`) al navegador por una conexión HTTP persistente. Ideal para un panel de seguimiento. |
| **WebSockets** | Medio-alto | Comunicación bidireccional (p. ej. con `socket.io`) para múltiples usuarios viendo cambios al instante. |

**Recomendación:** para un panel de seguimiento institucional, implementar **SSE o polling cada 15–30 s** sobre los endpoints existentes. No requiere cambiar el modelo de datos, solo añadir el mecanismo de actualización. Conviene confirmar este punto antes de comprometer "tiempo real" en producción.

---

## 8. Recomendaciones para producción

1. **Seguridad de credenciales:** cambiar `JWT_SECRET`, `ADMIN_PASSWORD` y restringir `CORS_ORIGIN`.
2. **Persistencia como servicio:** ejecutar el backend con un gestor de procesos (`pm2`, `nssm` o servicio de Windows) para que reinicie solo. Usar `npm start` (sin `--watch`).
3. **Frontend compilado:** servir el build estático (`npm run build` → carpeta `dist/`) detrás de un servidor (IIS, Nginx) en lugar del servidor de desarrollo de Vite.
4. **Respaldos:** programar copia periódica del archivo `backend/database/pgr_compras.db` (contiene todos los datos). Es un único archivo, fácil de respaldar.
5. **HTTPS:** colocar un proxy inverso con certificado TLS si se expone fuera de la LAN.
6. **Escalamiento de datos:** SQLite es adecuado para uso departamental (decenas de usuarios concurrentes). Si crece a uso institucional masivo o escritura intensa, evaluar migración a PostgreSQL.

---

## 9. Conclusión

El requerimiento es **instalable de inmediato** en este equipo: el entorno (Node v22.22.3, npm 10.9.8) cumple los requisitos y solo falta ejecutar `npm install` en `backend/` y `frontend/` (o `iniciar.bat`). La base de datos ya existe en `backend/database/pgr_compras.db`.

- ✅ **Análisis de proyectos:** soportado de fábrica (dashboard, KPIs, categorías LACAP, detalle con línea de tiempo).
- ⚠️ **Seguimiento en tiempo real:** la *trazabilidad* (eventos y alertas) ya existe, pero la *actualización automática en pantalla* requiere añadir polling/SSE/WebSockets (sección 7). Recomendado planificarlo como ajuste posterior a la instalación base.
