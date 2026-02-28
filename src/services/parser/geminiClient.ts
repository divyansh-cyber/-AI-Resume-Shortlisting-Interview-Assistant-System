import {
  GoogleGenerativeAI,
  GenerativeModel,
  HarmCategory,
  HarmBlockThreshold,
} from '@google/generative-ai';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import { ExternalServiceError } from '../../utils/errors';

let _genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!_genAI) {
    _genAI = new GoogleGenerativeAI(config.gemini.apiKey);
  }
  return _genAI;
}

/**
 * Returns a Gemini GenerativeModel configured for chat/reasoning.
 * Safety thresholds are set to BLOCK_NONE for professional resume content —
 * resumes mention industries (defence, pharma, weapons) that could otherwise
 * trigger false-positive blocks.
 */
function getChatModel(): GenerativeModel {
  return getGenAI().getGenerativeModel({
    model: config.gemini.chatModel,
    safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json', // always return JSON
    },
  });
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Sends a chat completion request to Gemini and returns the raw JSON string.
 *
 * Gemini's SDK does not have an explicit "system" role in its chat history —
 * the system prompt is passed as the first `user` turn and immediately followed
 * by a synthetic `model` acknowledgement.  This is the recommended workaround.
 *
 * All calls use `responseMimeType: 'application/json'` so the response is
 * always valid JSON (Gemini enforces this at the model level).
 */
export async function chatCompletion(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const { temperature = 0.2, maxTokens = 8192 } = opts;

  const model = getGenAI().getGenerativeModel({
    model: config.gemini.chatModel,
    safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      responseMimeType: 'application/json',
    },
  });

  // Separate system prompt from conversation turns
  const systemMessage = messages.find((m) => m.role === 'system');
  const conversationMessages = messages.filter((m) => m.role !== 'system');

  // Build Gemini chat history (all turns except the last, which is the live prompt)
  const history = buildHistory(systemMessage, conversationMessages.slice(0, -1));
  const lastMessage = conversationMessages[conversationMessages.length - 1];

  const responseText = await withRetry(
    async () => {
      const chat = model.startChat({ history });
      const result = await chat.sendMessage(lastMessage?.content ?? '');
      return result.response.text();
    },
    { maxAttempts: 3 },
  ).catch((err) => {
    logger.error('Gemini chat completion failed', { err });
    throw new ExternalServiceError('Gemini', err instanceof Error ? err.message : undefined);
  });

  logger.debug('Gemini response received', {
    model: config.gemini.chatModel,
    responseLength: responseText.length,
  });

  return responseText;
}

/**
 * Generates an embedding vector using Gemini's text-embedding-004 model.
 * task_type "RETRIEVAL_DOCUMENT" is used for resume/JD text; callers that
 * query against a corpus should use "RETRIEVAL_QUERY".
 */
export async function createEmbedding(
  text: string,
  taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' = 'RETRIEVAL_DOCUMENT',
): Promise<number[]> {
  // text-embedding-004 supports up to 2048 tokens; truncate conservatively
  const truncated = text.slice(0, 20_000);

  const embModel = getGenAI().getGenerativeModel({
    model: config.gemini.embeddingModel,
  });

  const result = await withRetry(
    () =>
      embModel.embedContent({
        content: { parts: [{ text: truncated }], role: 'user' },
        taskType: taskType as Parameters<typeof embModel.embedContent>[0]['taskType'],
      }),
    { maxAttempts: 3 },
  ).catch((err) => {
    logger.error('Gemini embedding failed', { err });
    throw new ExternalServiceError('Gemini Embeddings', err instanceof Error ? err.message : undefined);
  });

  return result.embedding.values;
}

/* ── Private helpers ─────────────────────────────────────────────────────── */

/**
 * Converts our internal message array into the Gemini SDK's history format.
 *
 * Gemini history entries must alternate user / model.  If a system prompt
 * exists we inject it as a user turn followed by a model acknowledgement so
 * the model "knows" its instructions before the real conversation starts.
 */
function buildHistory(
  systemMessage: ChatMessage | undefined,
  priorMessages: ChatMessage[],
): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
  const history: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  if (systemMessage) {
    history.push({ role: 'user',  parts: [{ text: systemMessage.content }] });
    history.push({ role: 'model', parts: [{ text: 'Understood. I will follow these instructions.' }] });
  }

  for (const msg of priorMessages) {
    history.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    });
  }

  return history;
}

// Re-export getChatModel for internal use in streaming scenarios (future)
export { getChatModel };
