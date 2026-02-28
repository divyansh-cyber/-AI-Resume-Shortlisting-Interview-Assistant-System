/**
 * Groq client — uses the OpenAI-compatible Groq API for chat completions.
 * Embeddings are computed locally (Groq does not provide an embeddings endpoint).
 */
import OpenAI from 'openai';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import { ExternalServiceError } from '../../utils/errors';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey: config.gemini.apiKey,
      baseURL: GROQ_BASE_URL,
    });
  }
  return _client;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Sends a chat-completion request to Grok and returns the raw JSON string.
 *
 * We set `response_format: { type: 'json_object' }` so the model always
 * returns valid JSON (equivalent to Gemini's `responseMimeType: application/json`).
 */
export async function chatCompletion(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const { temperature = 0.2, maxTokens = 8192 } = opts;

  const responseText = await withRetry(
    async () => {
      const response = await getClient().chat.completions.create({
        model: config.gemini.chatModel,   // e.g. "grok-3-mini"
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content ?? '{}';
      return content;
    },
    { maxAttempts: 3 },
  ).catch((err) => {
    logger.error('Grok chat completion failed', { err });
    throw new ExternalServiceError('Grok', err instanceof Error ? err.message : undefined);
  });

  logger.debug('Grok response received', {
    model: config.gemini.chatModel,
    responseLength: responseText.length,
  });

  return responseText;
}

/**
 * Groq does not provide an embeddings API.
 * We compute a simple local TF (term-frequency) vector so cosine-similarity
 * scoring still works without any external call.
 */
export async function createEmbedding(
  text: string,
  _taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' = 'RETRIEVAL_DOCUMENT',
): Promise<number[]> {
  const tokens = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const freq: Record<string, number> = {};
  for (const t of tokens) freq[t] = (freq[t] ?? 0) + 1;

  // Hash each token into a 512-dim vector (random projection style)
  const dim = 512;
  const vec = new Array<number>(dim).fill(0);
  for (const [token, count] of Object.entries(freq)) {
    let h = 5381;
    for (let i = 0; i < token.length; i++) h = ((h * 33) ^ token.charCodeAt(i)) >>> 0;
    vec[h % dim] += count;
  }
  // L2-normalise
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / norm);
}

// Stub kept for any future streaming usage
export function getChatModel(): null {
  return null;
}
