import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';

import { env } from './config/env';
import { ensureSchema } from './db/schema';

import authRoutes from './routes/auth';
import eventsRoutes from './routes/events';
import paymentsRoutes from './routes/payments';
import ivsRoutes from './routes/ivs';
import adminRoutes from './routes/admin';
import uploadsRoutes from './routes/uploads';
import razorpayRoutes from './routes/razorpay';
import viewingSessionsRoutes from './routes/viewing-sessions';
import recordingsRoutes from './routes/recordings';
import invoicesRoutes from './routes/invoices';
import { startViewerStatsRecording } from './services/viewer-stats.service';

async function main() {
  await ensureSchema();

  // Start recording viewer stats every 5 minutes
  startViewerStatsRecording();

  const app = express();

  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  // CORS is handled by Apache reverse proxy in production
  // Only enable for local development
  if (process.env.NODE_ENV !== 'production') {
    app.use(
      cors({
        origin: ['http://localhost:8100', 'http://localhost:4200'],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'Origin', 'X-Requested-With'],
      })
    );
  }

  // Razorpay webhook needs raw body for signature verification
  // Must be before express.json() middleware
  app.use('/api/razorpay/webhook', express.raw({ type: 'application/json' }), (req, _res, next) => {
    // Store raw body for signature verification, then parse as JSON
    if (Buffer.isBuffer(req.body)) {
      (req as any).rawBody = req.body.toString('utf8');
      req.body = JSON.parse((req as any).rawBody);
    }
    next();
  });

  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Serve uploaded files statically
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

  app.use('/api/auth', authRoutes);
  app.use('/api/events', eventsRoutes);
  app.use('/api/payments', paymentsRoutes);
  app.use('/api/ivs', ivsRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/uploads', uploadsRoutes);
  app.use('/api/razorpay', razorpayRoutes);
  app.use('/api/viewing-sessions', viewingSessionsRoutes);
  app.use('/api/recordings', recordingsRoutes);
  app.use('/api/invoices', invoicesRoutes);

  app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Backend listening on http://localhost:${env.port}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error starting server', err);
  process.exit(1);
});
