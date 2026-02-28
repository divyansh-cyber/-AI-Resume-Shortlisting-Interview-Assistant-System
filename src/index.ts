import 'express-async-errors';
import { config } from './config';
import { createApp } from './api/app';
import { getPostgresPool } from './db/postgres';
import { getRedisClient } from './db/redis';
import { logger } from './utils/logger';

async function main(): Promise<void> {
  // Establish DB connections before accepting traffic
  const pool = getPostgresPool();
  const redis = getRedisClient();

  try {
    await pool.query('SELECT 1');
    logger.info('PostgreSQL connected');

    await redis.ping();
    logger.info('Redis connected');
  } catch (err) {
    logger.error('Failed to connect to required services. Exiting.', { err });
    process.exit(1);
  }

  const app = createApp();

  const server = app.listen(config.server.port, () => {
    logger.info(`🚀  Server running on port ${config.server.port} [${config.server.nodeEnv}]`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}. Shutting down gracefully…`);
    server.close(async () => {
      await pool.end();
      await redis.quit();
      logger.info('All connections closed. Goodbye.');
      process.exit(0);
    });

    // Force-exit after 10 seconds
    setTimeout(() => {
      logger.error('Graceful shutdown timed out. Forcing exit.');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Unhandled error during startup', { err });
  process.exit(1);
});
