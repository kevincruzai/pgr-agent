# ════════════════════════════════════════════════════════════════
# PGR - Sistema de Compras Públicas UACP
# Imagen para GCP (Cloud Run / GKE / Compute Engine con Docker)
# Build (desde la RAÍZ del repositorio):
#   docker build -f deploy/Dockerfile -t pgr-compras .
# ════════════════════════════════════════════════════════════════

# ─── Etapa 1: build del frontend ───
FROM node:22-slim AS frontend-build
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npx vite build

# ─── Etapa 2: dependencias del backend (sin msnodesqlv8: en Linux se usa tedious/SQL auth) ───
FROM node:22-slim AS backend-deps
WORKDIR /build/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev --omit=optional

# ─── Etapa 3: imagen final ───
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app

COPY --from=backend-deps /build/backend/node_modules ./backend/node_modules
COPY backend/ ./backend/
# El backend sirve el frontend compilado desde ../frontend/dist
COPY --from=frontend-build /build/frontend/dist ./frontend/dist

# Usuario sin privilegios
RUN useradd -r -u 1001 pgrapp && chown -R pgrapp:pgrapp /app
USER pgrapp

# Cloud Run inyecta PORT; el backend lo respeta (default 3621)
EXPOSE 3621
WORKDIR /app/backend
CMD ["node", "--use-system-ca", "server.js"]
