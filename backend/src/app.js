import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import authRoutes from './routes/auth.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import correspondencesRoutes from './routes/correspondences.routes.js';
import projectsRoutes from './routes/projects.routes.js';
import { categoriesRouter, unitsRouter, usersRouter } from './routes/catalog.routes.js';
import procurementRoutes from './routes/procurement.routes.js';
import alertsRoutes from './routes/alerts.routes.js';
import adminRoutes from './routes/admin.routes.js';
import emailConfigRoutes from './routes/emailConfig.routes.js';
import pacRoutes from './routes/pac.routes.js';
import assistantRoutes from './routes/assistant.routes.js';
import { auditMiddleware } from './services/audit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '10mb' }));
  app.disable('x-powered-by');

  app.get('/api/health', (_req, res) => res.json({ ok: true, system: 'PGR-Compras-Publicas', db: 'sqlserver' }));

  /* Bitácora de auditoría: registra toda mutación de la API (DL 113/2024) */
  app.use('/api', auditMiddleware());

  app.use('/api/auth', authRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/correspondences', correspondencesRoutes);
  app.use('/api/projects', projectsRoutes);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/units', unitsRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/procurement', procurementRoutes);
  app.use('/api/alerts', alertsRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/email-config', emailConfigRoutes);
  app.use('/api/pac', pacRoutes);
  app.use('/api/assistant', assistantRoutes);

  /* ── Frontend estático en producción ── */
  app.use(express.static(path.join(__dirname, '..', '..', 'frontend', 'dist')));
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'dist', 'index.html'));
  });

  /* ── Manejo centralizado de errores (Express 5 captura promesas rechazadas) ── */
  app.use((err, _req, res, _next) => {
    console.error('[api]', err);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  });

  return app;
}
