import { Pool, PoolClient, QueryResult } from 'pg';
import { config } from '../config';
import { logger } from '../utils/logger';

let pool: Pool | null = null;

/**
 * Returns the singleton Pool instance.
 *
 * Using a singleton prevents accidentally creating multiple pools
 * (each would hold its own set of idle connections) when modules are
 * imported in different places.
 */
export function getPostgresPool(): Pool {
  if (!pool) {
    pool = new Pool(
      config.postgres.connectionString
        ? { connectionString: config.postgres.connectionString, max: 20, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 }
        : {
            host: config.postgres.host,
            port: config.postgres.port,
            database: config.postgres.database,
            user: config.postgres.user,
            password: config.postgres.password,
            max: 20,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 5_000,
          },
    );

    pool.on('error', (err) => {
      logger.error('Unexpected PostgreSQL pool error', { err });
    });

    pool.on('connect', () => {
      logger.debug('New PostgreSQL client connected');
    });
  }

  return pool;
}

/**
 * Convenience wrapper — runs a single parameterised query.
 */
export async function query<T extends object = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const start = Date.now();
  const result = await getPostgresPool().query<T>(text, params);
  const duration = Date.now() - start;
  logger.debug('Executed query', { text: text.slice(0, 80), duration, rows: result.rowCount });
  return result;
}

/**
 * Runs multiple queries inside a single transaction.
 *
 * @example
 *   await withTransaction(async (client) => {
 *     await client.query('INSERT INTO jobs …', []);
 *     await client.query('INSERT INTO evaluations …', []);
 *   });
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPostgresPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
