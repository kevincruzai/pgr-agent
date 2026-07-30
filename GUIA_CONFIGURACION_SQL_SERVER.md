# Guía de Configuración de SQL Server — PGR Sistema de Compras Públicas

**Versión 1.0 — Junio 2026**

Esta guía explica cómo instalar, configurar y conectar Microsoft SQL Server para el sistema,
en los tres escenarios posibles. Los comandos fueron validados en el entorno real del proyecto.

| Escenario | Autenticación | Driver que usa el sistema | Cuándo usarlo |
|-----------|---------------|---------------------------|----------------|
| **A. Local Windows** (desarrollo) | Windows (integrada) | `msnodesqlv8` (ODBC) | Tu PC de desarrollo |
| **B. Servidor Windows/remoto** | SQL (usuario/contraseña) | `tedious` (JS puro) | Producción on-premise Windows |
| **C. Linux / GCP Cloud SQL** | SQL (usuario/contraseña) | `tedious` | Producción Linux/nube (ver `MANUAL_INSTALACION_GCP_LINUX.md`) |

---

## 1. Escenario A — SQL Server Express local en Windows (desarrollo)

### 1.1 Instalar SQL Server Express

1. Descargar **SQL Server Express** (gratuito): <https://www.microsoft.com/es-es/sql-server/sql-server-downloads>
2. Ejecutar el instalador → tipo **Básica**. Esto crea la instancia con nombre **`SQLEXPRESS`**.
3. Instalar las herramientas de línea de comandos (si no vienen incluidas):
   - **ODBC Driver 18 for SQL Server**: <https://learn.microsoft.com/sql/connect/odbc/download-odbc-driver-for-sql-server>
   - **sqlcmd (Command Line Utilities)**: <https://learn.microsoft.com/sql/tools/sqlcmd/sqlcmd-utility>

### 1.2 Verificar que el servicio corre

```bash
# El servicio debe mostrar STATE: RUNNING
sc query "MSSQL$SQLEXPRESS" | find "STATE"

# Si está detenido, iniciarlo (cmd como administrador):
net start "MSSQL$SQLEXPRESS"
```

### 1.3 Probar la conexión con autenticación Windows

```bash
sqlcmd -S localhost\SQLEXPRESS -E -C -Q "SELECT @@VERSION"
```

`-E` = autenticación Windows (tu sesión actual); `-C` = confiar en el certificado autofirmado de
SQL Server (obligatorio con `sqlcmd`/ODBC 18, de lo contrario falla con *"certificate chain ... not
trusted"*). Si responde con la versión, SQL Server está operativo.

### 1.4 Crear la base de datos y el esquema del sistema

Desde la carpeta `backend/` del proyecto:

```bash
npm run db:schema
```

Este comando ejecuta en orden las 8 migraciones de `backend/sql/` (todas idempotentes — pueden
re-ejecutarse sin dañar datos; cada `sqlcmd` usa `-C` para confiar en el certificado):

| Archivo | Qué crea |
|---------|----------|
| `001_schema.sql` | Base `PGR_Compras` + 11 tablas + índices |
| `002_email_import.sql` | Soporte de correos externos (IMAP) y adjuntos |
| `003_project_dates.sql` | Fechas de inicio/fin de proyectos |
| `004_attachments.sql` | Tabla de documentos adjuntos |
| `005_pac_lcp.sql` | Módulo PAC + modernización LACAP→LCP |
| `006_onboarding.sql` | Asistente de bienvenida |
| `007_user_profile.sql` | Campos de perfil de usuario |
| `008_audit_log.sql` | Bitácora de auditoría (DL 113/2024) |

### 1.5 Configurar el `.env` del backend

```env
DB_TRUSTED_CONNECTION=true
DB_SERVER=localhost
DB_INSTANCE=SQLEXPRESS
DB_DATABASE=PGR_Compras
DB_ODBC_DRIVER=ODBC Driver 18 for SQL Server
DB_TRUST_SERVER_CERTIFICATE=true
```

### 1.6 Sembrar datos y arrancar

```bash
npm run seed     # catálogos + usuario admin (+ datos demo si SEED_DEMO_DATA=true)
npm run dev      # debe imprimir: "Conectado a SQL Server (PGR_Compras)"
```

---

## 2. Escenario B — Autenticación SQL (servidor remoto / producción Windows)

La autenticación Windows solo funciona en la misma máquina/dominio. Para servidores remotos o
producción se usa un **login SQL** dedicado. Requiere 3 pasos en el servidor:

### 2.1 Habilitar el modo mixto (Windows + SQL)

Con **SQL Server Management Studio (SSMS)**: clic derecho en el servidor → *Properties* →
*Security* → marcar **SQL Server and Windows Authentication mode** → OK.

O por línea de comandos (cmd **como administrador**; la ruta `MSSQLxx` varía según versión —
`MSSQL17` = SQL Server 2025, `MSSQL16` = 2022):

```bash
reg add "HKLM\SOFTWARE\Microsoft\Microsoft SQL Server\MSSQL17.SQLEXPRESS\MSSQLServer" /v LoginMode /t REG_DWORD /d 2 /f
net stop "MSSQL$SQLEXPRESS" && net start "MSSQL$SQLEXPRESS"
```

### 2.2 Crear el login de aplicación (nunca usar `sa` en la app)

```bash
sqlcmd -S localhost\SQLEXPRESS -E -C -Q "
CREATE LOGIN pgr_app WITH PASSWORD = 'CLAVE_FUERTE_AQUI', CHECK_POLICY = ON;
"
# Si la base ya existe, darle propiedad sobre ella:
sqlcmd -S localhost\SQLEXPRESS -E -C -Q "
USE PGR_Compras;
CREATE USER pgr_app FOR LOGIN pgr_app;
ALTER ROLE db_owner ADD MEMBER pgr_app;
"
# Si pgr_app debe poder CREAR la base (primera instalación):
sqlcmd -S localhost\SQLEXPRESS -E -C -Q "ALTER SERVER ROLE dbcreator ADD MEMBER pgr_app;"
```

Probar el login:

```bash
sqlcmd -S localhost\SQLEXPRESS -U pgr_app -P 'CLAVE_FUERTE_AQUI' -C -Q "SELECT DB_NAME()"
```

### 2.3 Habilitar TCP/IP y puerto fijo (necesario para conexiones remotas)

SQL Server Express trae TCP/IP **deshabilitado** por defecto:

1. Abrir **SQL Server Configuration Manager** → *SQL Server Network Configuration* →
   *Protocols for SQLEXPRESS* → **TCP/IP** → *Enabled = Yes*.
2. Doble clic en TCP/IP → pestaña *IP Addresses* → sección **IPAll**:
   - **TCP Dynamic Ports**: dejar vacío
   - **TCP Port**: `1433`
3. Reiniciar el servicio: `net stop "MSSQL$SQLEXPRESS" && net start "MSSQL$SQLEXPRESS"`
4. Abrir el firewall de Windows:

```bash
netsh advfirewall firewall add rule name="SQL Server 1433" dir=in action=allow protocol=TCP localport=1433
```

> Con puerto fijo 1433 ya no se necesita el servicio *SQL Server Browser* ni el nombre de
> instancia: se conecta con `DB_SERVER=ip_del_servidor` y `DB_PORT=1433` (sin `DB_INSTANCE`).
> Si prefiere mantener puertos dinámicos + nombre de instancia, inicie el servicio
> **SQL Server Browser** y abra también UDP 1434.

### 2.4 `.env` para autenticación SQL

```env
DB_TRUSTED_CONNECTION=false
DB_SERVER=192.168.1.50        # IP o nombre DNS del servidor SQL
DB_PORT=1433
DB_DATABASE=PGR_Compras
DB_USER=pgr_app
DB_PASSWORD=CLAVE_FUERTE_AQUI
DB_ENCRYPT=true
DB_TRUST_SERVER_CERTIFICATE=true   # false si instaló un certificado TLS real
```

> Con `DB_TRUSTED_CONNECTION=false` el sistema usa el driver `tedious` (JavaScript puro):
> en Linux instale el backend con `npm ci --omit=optional` para omitir `msnodesqlv8` (solo-Windows).

---

## 3. Escenario C — Linux / Google Cloud SQL

Siga el `MANUAL_INSTALACION_GCP_LINUX.md` (secciones 4.1 y 6). En resumen: es el Escenario B
(autenticación SQL) donde el servidor es Cloud SQL for SQL Server o `mssql-server` en Ubuntu;
el esquema se aplica con `sqlcmd` de `mssql-tools18` usando `-C` para confiar en el certificado.

---

## 4. Verificación completa de la instalación

Ejecutar en orden — los 4 deben pasar:

```bash
# 1. SQL Server responde y la base existe
sqlcmd -S localhost\SQLEXPRESS -E -C -Q "SELECT name FROM sys.databases WHERE name='PGR_Compras'"

# 2. Las 13 tablas existen
sqlcmd -S localhost\SQLEXPRESS -E -d PGR_Compras -Q "SELECT COUNT(*) AS tablas FROM sys.tables"

# 3. El backend conecta (debe responder {"ok":true,...,"db":"sqlserver"})
cd backend && npm run dev     # en otra terminal:
curl http://localhost:3621/api/health

# 4. La suite de auditoría completa (50 pruebas contra la BD real)
cd backend && npm test
```

---

## 5. Respaldos y mantenimiento

```bash
# Respaldo completo (crear la carpeta C:\Respaldos antes)
sqlcmd -S localhost\SQLEXPRESS -E -C -Q "BACKUP DATABASE PGR_Compras TO DISK='C:\Respaldos\PGR_Compras.bak' WITH INIT"

# Restaurar
sqlcmd -S localhost\SQLEXPRESS -E -C -Q "RESTORE DATABASE PGR_Compras FROM DISK='C:\Respaldos\PGR_Compras.bak' WITH REPLACE"
```

Recomendado en producción: respaldo diario programado (Tarea de Windows o Agente SQL en
ediciones superiores a Express) y copia del archivo `.bak` fuera del servidor. En Cloud SQL los
respaldos automáticos se configuran al crear la instancia (`--backup-start-time`).

---

## 6. Solución de problemas

| Error | Causa | Solución |
|-------|-------|----------|
| `Could not open a connection... error: 40` o `ETIMEOUT` | TCP/IP deshabilitado, firewall, o instancia sin Browser | Sección 2.3: habilitar TCP/IP, puerto 1433 fijo, regla de firewall |
| `Login failed for user 'pgr_app'` (18456) | Modo mixto no habilitado o clave incorrecta | Sección 2.1 (LoginMode=2 + reinicio) y verificar clave |
| `Login failed for user ''` con auth Windows | El servicio corre con cuenta sin acceso o se usó `-U` vacío | Usar `-E` / `DB_TRUSTED_CONNECTION=true` en la misma máquina |
| `self signed certificate` / `certificate verify failed` | Certificado autofirmado del servidor | `DB_TRUST_SERVER_CERTIFICATE=true` (o instalar certificado real) |
| `The variable name '@P1' has already been declared` | Conflicto de nombres de parámetros con ODBC | Ya resuelto en el sistema (`src/db.js` usa prefijo `prm`); no nombrar parámetros `p1, p2...` en código nuevo |
| `npm install` falla compilando `msnodesqlv8` en Linux | Dependencia opcional solo-Windows | `npm ci --omit=optional` |
| `Cannot find module 'mssql/msnodesqlv8'` en Linux | `DB_TRUSTED_CONNECTION` quedó en `true` | Ponerlo en `false` y configurar usuario/clave SQL |
| `CREATE DATABASE permission denied` | El login no es `dbcreator` | Sección 2.2, o ejecutar `001_schema.sql` una vez como administrador |
| El servicio no aparece (`MSSQL$SQLEXPRESS`) | Instancia con otro nombre o instalación por defecto | `sc query type= service state= all \| find "MSSQL"` para ver el nombre real; instancia por defecto = servicio `MSSQLSERVER` y conexión `-S localhost` sin `\SQLEXPRESS` |
| `sqlcmd` no se reconoce | Herramientas CLI no instaladas o fuera del PATH | Instalar Command Line Utilities; típicamente quedan en `C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn` |

---

## 7. Referencia: cómo decide el sistema qué driver usar

El backend ([src/config.js](backend/src/config.js) y [src/db.js](backend/src/db.js)) elige según `.env`:

```
DB_TRUSTED_CONNECTION=true  → msnodesqlv8 (ODBC, autenticación Windows, solo Windows)
DB_TRUSTED_CONNECTION=false → tedious (TCP, usuario/contraseña SQL, multiplataforma)
```

Variables disponibles: `DB_SERVER`, `DB_INSTANCE`, `DB_PORT`, `DB_DATABASE`, `DB_USER`,
`DB_PASSWORD`, `DB_ENCRYPT`, `DB_TRUST_SERVER_CERTIFICATE`, `DB_ODBC_DRIVER`, `DB_POOL_MAX`,
y `DB_CONNECTION_STRING` (cadena ODBC completa que tiene prioridad sobre las demás en modo Windows).
