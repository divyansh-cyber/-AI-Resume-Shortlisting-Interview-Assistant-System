import express, { Application, Request, Response } from 'express';

/**
 * Minimal app factory — routes and middleware will be wired in Stage 8 (API layer).
 * This stub exists so src/index.ts can compile during earlier stages.
 */
export function createApp(): Application {
  const app = express();
  app.use(express.json());

  // Liveness probe (used by Docker HEALTHCHECK and ALB health checks)
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  return app;
}
