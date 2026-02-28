import pdfParse from 'pdf-parse';
import { logger } from '../../utils/logger';
import { ValidationError } from '../../utils/errors';

export interface ExtractedText {
  text: string;
  pageCount: number;
  originalFilename: string;
}

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const MIN_TEXT_LENGTH = 50;

/**
 * Extracts raw text from a PDF buffer.
 *
 * Validates size and minimum content length up-front so the LLM is never
 * called with an unusable payload.
 */
export async function extractTextFromPdf(
  buffer: Buffer,
  originalFilename: string,
): Promise<ExtractedText> {
  if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new ValidationError(
      `PDF exceeds maximum size of ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB`,
    );
  }

  let parsed: { text: string; numpages: number };
  try {
    parsed = await pdfParse(buffer);
  } catch (err) {
    logger.warn('pdf-parse failed to parse file', { originalFilename, err });
    throw new ValidationError(
      'Could not read the PDF. Make sure the file is a valid, non-encrypted PDF.',
    );
  }

  const text = normaliseWhitespace(parsed.text);

  if (text.length < MIN_TEXT_LENGTH) {
    throw new ValidationError(
      'The PDF appears to be image-only or empty. Please provide a text-based PDF.',
    );
  }

  logger.debug('PDF extracted', {
    originalFilename,
    pages: parsed.numpages,
    chars: text.length,
  });

  return { text, pageCount: parsed.numpages, originalFilename };
}

/**
 * Collapses excessive blank lines and trims unicode whitespace artefacts
 * that pdf-parse sometimes produces.
 */
function normaliseWhitespace(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')           // CRLF → LF
    .replace(/[ \t]+/g, ' ')          // collapse horizontal whitespace
    .replace(/\n{3,}/g, '\n\n')       // collapse 3+ blank lines → 2
    .trim();
}
