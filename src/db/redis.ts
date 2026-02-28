import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';

let client: Redis | null = null;

/**
 * Returns the singleton Redis client.
 * ioredis handles automatic reconnection by default.
 */
export function getRedisClient(): Redis {
  if (!client) {
    client = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password || undefined,
      // Retry connection up to 10 times with exponential back-off
      retryStrategy: (times) => {
        if (times > 10) {
          logger.error('Redis: max reconnection attempts reached');
          return null; // stop retrying
        }
        return Math.min(times * 200, 3000);
      },
      lazyConnect: false,
      enableReadyCheck: true,
    });

    client.on('connect', () => logger.info('Redis connected'));
    client.on('ready', () => logger.debug('Redis ready'));
    client.on('error', (err) => logger.error('Redis error', { err }));
    client.on('reconnecting', () => logger.warn('Redis reconnecting…'));
  }

  return client;
}

/* ── Typed cache helpers ─────────────────────────────────────────────────── */

/**
 * Retrieves and JSON-parses a cached value.
 * Returns null if missing or on parse error (treat as cache miss).
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await getRedisClient().get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    logger.warn('Cache: failed to parse cached value', { key });
    return null;
  }
}

/**
 * JSON-stringifies and stores a value with an optional TTL (seconds).
 * Falls back to the global REDIS_CACHE_TTL from config if not specified.
 */
export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number = config.redis.cacheTtl,
): Promise<void> {
  await getRedisClient().set(key, JSON.stringify(value), 'EX', ttlSeconds);
}

/**
 * Removes a cached key (e.g. when the underlying data changes).
 */
export async function cacheDel(key: string): Promise<void> {
  await getRedisClient().del(key);
}

/**
 * Cache key factories — centralised so key formats never diverge.
 */
export const CacheKeys = {
  embedding: (text: string): string => `emb:${Buffer.from(text).toString('base64').slice(0, 64)}`,
  evaluation: (id: string): string => `eval:${id}`,
  job: (id: string): string => `job:${id}`,
  githubProfile: (username: string): string => `gh:${username}`,
} as const;
