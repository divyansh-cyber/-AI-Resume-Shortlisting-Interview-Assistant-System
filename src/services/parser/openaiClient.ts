/**
 * @deprecated  This project uses Gemini Pro as its LLM provider.
 * This file is kept as a re-export shim so any existing imports don't break.
 * Import from './geminiClient' directly for new code.
 */
export * from './geminiClient';

// --- original openai imports below are intentionally removed ---
// Keeping this file as a thin shim avoids chasing down stale import paths.
import { logger as _logger } from '../../utils/logger'; void _logger;
import { ExternalServiceError } from '../../utils/errors';

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: config.openai.apiKey });
  }
  return _client;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Sends a chat completion request and returns the raw text response.
 *
 * Wraps the call in our retry utility so transient 429s / 5xxs are handled
 * automatically without callers needing to think about it.
 */
export async function chatCompletion(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const { temperature = 0.2, maxTokens = 4096 } = opts;

  const response = await withRetry(
    () =>
      getClient().chat.completions.create({
        model: config.openai.chatModel,
        messages,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' }, // all calls return JSON
      }),
    { maxAttempts: 3 },
  ).catch((err) => {
    logger.error('OpenAI chat completion failed', { err });
    throw new ExternalServiceError('OpenAI', err instanceof Error ? err.message : undefined);
  });

  const content = response.choices[0]?.message?.content ?? '';
  logger.debug('OpenAI response received', {
    model: config.openai.chatModel,
    promptTokens: response.usage?.prompt_tokens,
    completionTokens: response.usage?.completion_tokens,
  });

  return content;
}

/**
 * Generates an embedding vector for the given text.
 * Results are cached by the caller (see CacheKeys.embedding in redis.ts).
 */
export async function createEmbedding(text: string): Promise<number[]> {
  // Truncate to avoid exceeding token limits (8191 tokens for text-embedding-3-small)
  const truncated = text.slice(0, 25_000);

  const response = await withRetry(
    () =>
      getClient().embeddings.create({
        model: config.openai.embeddingModel,
        input: truncated,
      }),
    { maxAttempts: 3 },
  ).catch((err) => {
    logger.error('OpenAI embedding failed', { err });
    throw new ExternalServiceError('OpenAI Embeddings', err instanceof Error ? err.message : undefined);
  });

  return response.data[0].embedding;
}
