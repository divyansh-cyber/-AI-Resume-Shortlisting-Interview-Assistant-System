/**
 * Minimal migration runner.
 *
 * Strategy: keep a `schema_migrations` table that records which SQL files
 * have been applied.  On each run, apply any files not yet recorded — in
 * filename-sorted order — inside individual transactions so a failed
 * migration never leaves the schema half-applied.
 *
 * Run:  npm run db:migrate
 */
import fs from 'fs';
import path from 'path';
import { PoolClient } from 'pg';
import { getPostgresPool } from './postgres';
import { logger } from '../utils/logger';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT        PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(client: PoolClient): Promise<Set<string>> {
  const result = await client.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations ORDER BY filename',
  );
  return new Set(result.rows.map((r) => r.filename));
}

async function runMigrations(): Promise<void> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await ensureMigrationsTable(client);

    const applied = await getAppliedMigrations(client);

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort(); // lexicographic order == chronological order given 001_, 002_, …

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) {
        logger.debug(`Skipping already-applied migration: ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
      logger.info(`Applying migration: ${file}`);

      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      ran++;
    }

    await client.query('COMMIT');
    logger.info(`Migrations complete. ${ran} new migration(s) applied.`);
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Migration failed — rolled back', { err });
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch((err) => {
  logger.error('Fatal migration error', { err });
  process.exit(1);
});
