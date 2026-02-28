import { sleep } from './math';
import { logger } from './logger';

interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  shouldRetry?: (err: unknown) => boolean;
}

/**
 * Retries an async function with exponential back-off.
 *
 * @example
 *   const result = await withRetry(() => openai.embeddings.create(...), { maxAttempts: 3 });
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 500,
    backoffFactor = 2,
    shouldRetry = defaultShouldRetry,
  } = options;

  let lastError: unknown;
  let delayMs = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt === maxAttempts || !shouldRetry(err)) {
        break;
      }

      logger.warn(`Attempt ${attempt}/${maxAttempts} failed. Retrying in ${delayMs}ms…`, {
        error: err instanceof Error ? err.message : String(err),
      });

      await sleep(delayMs);
      delayMs *= backoffFactor;
    }
  }

  throw lastError;
}

function defaultShouldRetry(err: unknown): boolean {
  if (err instanceof Error) {
    // Retry on network errors and 5xx / rate-limit HTTP errors
    const retryMessages = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'rate limit', '502', '503', '429'];
    return retryMessages.some((m) => err.message.toLowerCase().includes(m.toLowerCase()));
  }
  return false;
}
