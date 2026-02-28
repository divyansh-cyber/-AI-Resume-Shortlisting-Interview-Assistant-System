import 'express-async-errors';
import express, { Application, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'path';

import { config } from '../config';
import { logger } from '../utils/logger';
import jobsRouter from './routes/jobs.routes';
import evaluationsRouter from './routes/evaluations.routes';
import { listEvaluationsForJob } from './routes/evaluations.routes';
import { errorHandler } from './middleware/errorHandler';

export function createApp(): Application {
  const app = express();

  // ── Security middleware ────────────────────────────────────────────────────
  app.use(
    helmet({
      // Relax CSP so the frontend can fetch the same-origin API
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          connectSrc: ["'self'"],
        },
      },
    }),
  );
  app.use(cors());

  // ── Static frontend ( public/ ) ───────────────────────────────────
  app.use(express.static(path.join(__dirname, '..', '..', 'public')));

  // ── Request logging ───────────────────────────────────────────────────────
  if (!config.server.isTest) {
    app.use(
      morgan('combined', {
        stream: { write: (msg) => logger.http(msg.trim()) },
      }),
    );
  }

  // ── Body parsing ──────────────────────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // ── Rate limiting ─────────────────────────────────────────────────────────
  const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: 'RATE_LIMIT',
        message: 'Too many requests. Please retry after a moment.',
      },
    },
  });
  app.use('/api', limiter);

  // ── Health probe (no rate-limit, no auth) ─────────────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ── API routes ────────────────────────────────────────────────────────────
  app.use('/api/jobs', jobsRouter);
  app.use('/api/evaluations', evaluationsRouter);

  // GET /api/jobs/:jobId/evaluations — nested resource shortcut
  app.get('/api/jobs/:jobId/evaluations', listEvaluationsForJob);

  // ── 404 handler ───────────────────────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'The requested endpoint does not exist.' },
    });
  });

  // ── Global error handler (must be last) ───────────────────────────────────
  app.use(errorHandler);

  return app;
}
