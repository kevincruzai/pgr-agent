# Manual de Instalación — PGR Sistema de Compras Públicas UACP

**Procuraduría General de la República · Unidad de Adquisiciones y Contrataciones Públicas**
Versión 1.0 — Junio 2026

Este manual cubre la instalación del sistema en **Google Cloud Platform (GCP)** y en **servidores Linux** (on-premise o cualquier nube). Para instalación en Windows con SQL Server Express local, ver `README.md`.

---

## 1. Arquitectura del sistema

| Componente | Tecnología | Notas |
|-----------|-----------|-------|
| Backend API | Node.js 22 + Express 5 (puerto 3621) | Sirve también el frontend compilado |
| Base de datos | Microsoft SQL Server 2017+ | En GCP: **Cloud SQL for SQL Server** |
| Frontend | React 19 + Vite (build estático) | Servido por el backend o por Nginx |
| IA | Google Gemini API (REST) | API Key desde panel admin o variable de entorno |
| Correo | IMAP/SMTP por usuario | imapflow + nodemailer |

> **Importante (Linux):** la autenticación Windows hacia SQL Server (`msnodesqlv8`) es exclusiva de Windows. En Linux el sistema usa el driver `tedious` con **autenticación SQL** (`DB_TRUSTED_CONNECTION=false`). El paquete `msnodesqlv8` es una dependencia *opcional*: instale con `npm ci --omit=optional` en Linux.

Modalidades de despliegue cubiertas:

- **Opción A** — GCP: Compute Engine (VM Ubuntu) + Cloud SQL for SQL Server *(recomendada)*
- **Opción B** — GCP: Cloud Run (contenedor) + Cloud SQL for SQL Server
- **Opción C** — Linux on-premise: Ubuntu Server + SQL Server 2022 para Linux

---

## 2. Requisitos previos

- Código fuente del sistema (este repositorio).
- Dominio o IP fija para acceso de usuarios (recomendado: `compras.pgr.gob.sv`).
- API Key de Gemini (opcional, para las funciones de IA): <https://aistudio.google.com/apikey>
- En GCP: proyecto con facturación habilitada y [gcloud CLI](https://cloud.google.com/sdk/docs/install) autenticado:

```bash
gcloud auth login
gcloud config set project PGR-COMPRAS-PROD   # su ID de proyecto
```

---

## 3. Opción A — GCP: Compute Engine + Cloud SQL for SQL Server (recomendada)

### 3.1 Crear la instancia Cloud SQL for SQL Server

```bash
gcloud services enable sqladmin.googleapis.com compute.googleapis.com

# Instancia SQL Server Express (suficiente para uso departamental; use STANDARD para institucional)
gcloud sql instances create pgr-sqlserver \
  --database-version=SQLSERVER_2022_EXPRESS \
  --tier=db-custom-2-8192 \
  --region=us-central1 \
  --root-password='CAMBIE_ESTA_CLAVE_FUERTE' \
  --storage-size=20GB --storage-auto-increase \
  --backup-start-time=03:00

# Usuario de aplicación (evite usar sqlserver/root en la app)
gcloud sql users create pgr_app --instance=pgr-sqlserver --password='OTRA_CLAVE_FUERTE'
```

Anote la **IP pública o privada** de la instancia:

```bash
gcloud sql instances describe pgr-sqlserver --format='value(ipAddresses)'
```

> **Red recomendada:** habilite **IP privada** en la instancia y coloque la VM en la misma red VPC. Si usa IP pública, autorice solo la IP de la VM en *Authorized networks* o use **Cloud SQL Auth Proxy**.

### 3.2 Crear la VM (Ubuntu 24.04 LTS)

```bash
gcloud compute instances create pgr-app \
  --zone=us-central1-a \
  --machine-type=e2-standard-2 \
  --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-balanced \
  --tags=http-server,https-server

# Firewall para HTTP/HTTPS (el puerto 3621 NO se expone; Nginx hace de proxy)
gcloud compute firewall-rules create allow-http --allow=tcp:80 --target-tags=http-server
gcloud compute firewall-rules create allow-https --allow=tcp:443 --target-tags=https-server

gcloud compute ssh pgr-app --zone=us-central1-a
```

### 3.3 Instalar software base en la VM

```bash
# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git nginx

# Herramientas cliente de SQL Server (sqlcmd) — para crear el esquema
curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | sudo gpg --dearmor -o /usr/share/keyrings/microsoft.gpg
echo "deb [signed-by=/usr/share/keyrings/microsoft.gpg] https://packages.microsoft.com/ubuntu/24.04/prod noble main" | sudo tee /etc/apt/sources.list.d/mssql-release.list
sudo apt-get update
sudo ACCEPT_EULA=Y apt-get install -y mssql-tools18 unixodbc-dev
echo 'export PATH="$PATH:/opt/mssql-tools18/bin"' >> ~/.bashrc && source ~/.bashrc
```

### 3.4 Desplegar la aplicación

```bash
# Usuario de servicio y código
sudo useradd -r -m -d /opt/pgr pgrapp
sudo git clone https://SU_REPOSITORIO/pgr.git /opt/pgr   # o copie el código con scp
cd /opt/pgr

# Backend (sin msnodesqlv8: Linux usa tedious/SQL auth)
cd backend && npm ci --omit=optional

# Frontend (compilar y dejar el build que sirve el backend)
cd ../frontend && npm ci && npx vite build
```

### 3.5 Crear el esquema de base de datos

```bash
cd /opt/pgr/backend
IP_SQL=10.x.x.x   # IP de Cloud SQL

sqlcmd -S $IP_SQL -U pgr_app -P 'OTRA_CLAVE_FUERTE' -C -i sql/001_schema.sql
sqlcmd -S $IP_SQL -U pgr_app -P 'OTRA_CLAVE_FUERTE' -C -i sql/002_email_import.sql
```

> `-C` confía en el certificado autofirmado de Cloud SQL. Si `pgr_app` no tiene permiso `CREATE DATABASE`, ejecute `001_schema.sql` una vez como usuario `sqlserver` y otorgue después `db_owner` sobre `PGR_Compras` a `pgr_app`.

### 3.6 Configurar variables de entorno de producción

Cree `/opt/pgr/backend/.env`:

```env
NODE_ENV=production
PORT=3621
# OBLIGATORIO: secreto JWT fuerte (el servidor NO arranca en producción sin él)
JWT_SECRET=GENERE_UNO_CON: openssl rand -hex 48
CORS_ORIGIN=https://compras.pgr.gob.sv

# Credenciales del administrador inicial
ADMIN_DOC=00000000-0
ADMIN_PASSWORD=CAMBIE_ESTA_CLAVE

# SQL Server (autenticación SQL — obligatorio en Linux)
DB_TRUSTED_CONNECTION=false
DB_SERVER=10.x.x.x          # IP de Cloud SQL
DB_PORT=1433
DB_DATABASE=PGR_Compras
DB_USER=pgr_app
DB_PASSWORD=OTRA_CLAVE_FUERTE
DB_ENCRYPT=true
DB_TRUST_SERVER_CERTIFICATE=true   # certificado autofirmado de Cloud SQL

# Producción: sin datos de demostración
SEED_DEMO_DATA=false

# IA (opcional; también puede configurarse desde el panel admin)
# GEMINI_API_KEY=AIza...
```

```bash
sudo chown -R pgrapp:pgrapp /opt/pgr
sudo chmod 600 /opt/pgr/backend/.env

# Datos iniciales (unidades, roles, categorías y usuario admin)
cd /opt/pgr/backend && sudo -u pgrapp npm run seed
```

### 3.7 Servicio systemd + Nginx + HTTPS

```bash
sudo cp /opt/pgr/deploy/pgr-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pgr-backend
systemctl status pgr-backend      # debe mostrar "Conectado a SQL Server"

sudo cp /opt/pgr/deploy/nginx-pgr.conf /etc/nginx/sites-available/pgr
sudo ln -s /etc/nginx/sites-available/pgr /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Certificado TLS gratuito (requiere DNS apuntando a la VM)
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d compras.pgr.gob.sv
```

### 3.8 Verificación

```bash
curl -s http://localhost:3621/api/health
# → {"ok":true,"system":"PGR-Compras-Publicas","db":"sqlserver"}
```

Abra `https://compras.pgr.gob.sv`, inicie sesión con el ADMIN_DOC/ADMIN_PASSWORD configurados, y en **Configuración → Gemini Pro API** pegue la API Key y use **Probar Conexión**.

---

## 4. Opción B — GCP: Cloud Run + Cloud SQL (contenedor)

Útil si la institución prefiere infraestructura sin servidores. Requiere la instancia Cloud SQL de la sección 3.1 con **IP privada** y un [conector VPC](https://cloud.google.com/vpc/docs/serverless-vpc-access).

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com vpcaccess.googleapis.com

# Conector VPC (una sola vez)
gcloud compute networks vpc-access connectors create pgr-vpc \
  --region=us-central1 --range=10.8.0.0/28

# Construir y publicar la imagen (desde la raíz del repositorio)
gcloud artifacts repositories create pgr --repository-format=docker --location=us-central1
gcloud builds submit --tag us-central1-docker.pkg.dev/$(gcloud config get-value project)/pgr/pgr-compras -f deploy/Dockerfile .

# Desplegar
gcloud run deploy pgr-compras \
  --image=us-central1-docker.pkg.dev/$(gcloud config get-value project)/pgr/pgr-compras \
  --region=us-central1 \
  --vpc-connector=pgr-vpc \
  --allow-unauthenticated \
  --min-instances=1 \
  --set-env-vars="NODE_ENV=production,DB_TRUSTED_CONNECTION=false,DB_SERVER=IP_PRIVADA_SQL,DB_PORT=1433,DB_DATABASE=PGR_Compras,DB_USER=pgr_app,DB_ENCRYPT=true,DB_TRUST_SERVER_CERTIFICATE=true,SEED_DEMO_DATA=false" \
  --set-secrets="JWT_SECRET=pgr-jwt-secret:latest,DB_PASSWORD=pgr-db-password:latest,ADMIN_PASSWORD=pgr-admin-password:latest"
```

Los secretos se crean con Secret Manager:

```bash
gcloud services enable secretmanager.googleapis.com
echo -n "$(openssl rand -hex 48)" | gcloud secrets create pgr-jwt-secret --data-file=-
echo -n 'OTRA_CLAVE_FUERTE' | gcloud secrets create pgr-db-password --data-file=-
echo -n 'CLAVE_ADMIN' | gcloud secrets create pgr-admin-password --data-file=-
```

El esquema (sección 3.5) y los seeds se ejecutan una vez desde una VM o Cloud Shell con acceso a la instancia. Asocie su dominio en **Cloud Run → Manage custom domains**.

> Nota: `--min-instances=1` evita arranques en frío y mantiene el cache de insights de Gemini.

---

## 5. Opción C — Linux on-premise (Ubuntu + SQL Server para Linux)

SQL Server 2022 corre nativamente en Ubuntu 20.04/22.04 (en 24.04 puede usarse el repositorio de 22.04 o un contenedor oficial `mcr.microsoft.com/mssql/server:2022-latest`).

### 5.1 Instalar SQL Server 2022

```bash
curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | sudo gpg --dearmor -o /usr/share/keyrings/microsoft.gpg
echo "deb [signed-by=/usr/share/keyrings/microsoft.gpg] https://packages.microsoft.com/ubuntu/22.04/mssql-server-2022 jammy main" | sudo tee /etc/apt/sources.list.d/mssql-server.list
sudo apt-get update && sudo apt-get install -y mssql-server

sudo /opt/mssql/bin/mssql-conf setup
# Elija edición (Express es gratuita), acepte EULA y defina la clave de 'sa'

systemctl status mssql-server
```

### 5.2 Crear usuario de aplicación

```bash
sqlcmd -S localhost -U sa -P 'CLAVE_SA' -C -Q "
CREATE LOGIN pgr_app WITH PASSWORD='OTRA_CLAVE_FUERTE';
ALTER SERVER ROLE dbcreator ADD MEMBER pgr_app;"
```

### 5.3 Aplicación

Siga las secciones **3.3 a 3.8** usando `DB_SERVER=localhost` en el `.env`. Todo lo demás es idéntico.

> **Antivirus que interceptan correo:** si el servidor tiene un antivirus tipo AVG/Avast que intercepta los puertos IMAP/SMTP (raro en servidores Linux), defina `EMAIL_ALLOW_INVALID_CERTS=true`. En servidores limpios déjelo sin definir.

---

## 6. Lista de verificación de seguridad (producción)

- [ ] `JWT_SECRET` único y fuerte (≥48 bytes aleatorios); nunca el valor de desarrollo.
- [ ] `ADMIN_PASSWORD` cambiado; cambie también la clave dentro del sistema tras el primer ingreso.
- [ ] `SEED_DEMO_DATA=false` (sin usuarios ni proyectos de demostración).
- [ ] `CORS_ORIGIN` restringido al dominio institucional.
- [ ] Puerto 3621 NO expuesto a Internet (solo Nginx en 80/443; en GCP no cree regla de firewall para 3621).
- [ ] SQL Server sin IP pública o con redes autorizadas restringidas.
- [ ] HTTPS activo (certbot renueva automáticamente; verifique `systemctl list-timers | grep certbot`).
- [ ] Respaldos: Cloud SQL automáticos (sección 3.1) o, on-premise, respaldo diario de `PGR_Compras` (`BACKUP DATABASE`).
- [ ] `.env` con permisos `600` y propietario `pgrapp`.
- [ ] API Key de Gemini tratada como secreto (panel admin la guarda en BD; restrinja la key por API en Google Cloud Console).

## 7. Operación

| Tarea | Comando |
|-------|---------|
| Estado del servicio | `systemctl status pgr-backend` |
| Logs en vivo | `journalctl -u pgr-backend -f` |
| Reiniciar | `sudo systemctl restart pgr-backend` |
| Actualizar versión | `cd /opt/pgr && git pull && cd backend && npm ci --omit=optional && cd ../frontend && npm ci && npx vite build && sudo systemctl restart pgr-backend` |
| Respaldo manual (on-premise) | `sqlcmd -S localhost -U sa -C -Q "BACKUP DATABASE PGR_Compras TO DISK='/var/opt/mssql/backup/pgr.bak'"` |

## 8. Solución de problemas

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| `FATAL: no se pudo iniciar... JWT_SECRET` | Falta `JWT_SECRET` con `NODE_ENV=production` | Definirlo en `.env` |
| `Failed to connect ... ETIMEOUT` | Firewall/red hacia SQL Server | Verificar IP privada/redes autorizadas, puerto 1433 |
| `self signed certificate` al conectar a BD | Certificado de Cloud SQL | `DB_TRUST_SERVER_CERTIFICATE=true` |
| `Login failed for user 'pgr_app'` | Clave o permisos | Revisar usuario en Cloud SQL / otorgar `db_owner` en `PGR_Compras` |
| npm falla compilando `msnodesqlv8` en Linux | Dependencia opcional solo-Windows | Instalar con `npm ci --omit=optional` |
| Gemini: `API key not valid` | Key incorrecta | Generar nueva en Google AI Studio y probar desde el panel admin |
| IMAP `unable to verify the first certificate` | Antivirus/proxy intercepta TLS | Excepción en el antivirus o `EMAIL_ALLOW_INVALID_CERTS=true` (solo si se entiende el riesgo) |
| 502 en Nginx | Backend caído | `journalctl -u pgr-backend -n 50` |

---

*Documento generado para la UACP — PGR El Salvador. Acompañado de los archivos de despliegue en `deploy/` (Dockerfile, pgr-backend.service, nginx-pgr.conf). Versión Word: `Manual_Instalacion_PGR_GCP_Linux_v1.docx`.*
