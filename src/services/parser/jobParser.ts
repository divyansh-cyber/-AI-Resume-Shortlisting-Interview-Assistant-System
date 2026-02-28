import { v4 as uuidv4 } from 'uuid';
import { chatCompletion } from './geminiClient';
import { JobDescription } from '../../domain';
import { logger } from '../../utils/logger';
import { ValidationError } from '../../utils/errors';

const JD_SYSTEM_PROMPT = `You are an expert at parsing job descriptions. Extract structured requirements from a job description and return a single valid JSON object — nothing else, no markdown.

Rules:
1. Return ONLY a JSON object matching the schema below.
2. mustHave: skills/tools/qualifications explicitly marked as "required", "must have", "you must", or listed without any qualifier (these are implicit requirements).
3. niceToHave: skills marked as "preferred", "nice to have", "bonus", "plus", "advantage", or "ideally".
4. Normalise skill names consistently: "Node.js", "TypeScript", "PostgreSQL", "AWS", "Kubernetes".
5. contextualPhrases: short phrases (3-7 words) that describe the working environment or ownership expectations, e.g. "own features end-to-end", "lead architecture decisions", "high-traffic systems", "fast-paced startup".
6. responsibilities: individual bullet-point responsibilities as an array of strings.
7. employmentType must be one of: "full-time", "part-time", "contract", "internship", or null.
8. minExperienceYears: extract the shortest acceptable years of experience mentioned. null if not stated.

JSON Schema:
{
  "title": string,
  "company": string | null,
  "location": string | null,
  "employmentType": "full-time" | "part-time" | "contract" | "internship" | null,
  "minExperienceYears": number | null,
  "requirements": {
    "mustHave": string[],
    "niceToHave": string[],
    "contextualPhrases": string[]
  },
  "responsibilities": string[]
}`;

/**
 * Parses a raw job description string into a structured `JobDescription`.
 */
export async function parseJobDescriptionWithLLM(
  rawText: string,
  overrides?: { title?: string; company?: string },
): Promise<JobDescription> {
  logger.debug('Parsing job description with Gemini', { textLength: rawText.length });

  const responseText = await chatCompletion(
    [
      { role: 'system', content: JD_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Parse the following job description:\n\n---\n${rawText}\n---`,
      },
    ],
    { temperature: 0.1 },
  );

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    logger.error('Gemini returned invalid JSON for JD parse', {
      preview: responseText.slice(0, 200),
    });
    throw new ValidationError('LLM returned malformed JSON during job description parsing');
  }

  return normaliseJobDescription(parsed, rawText, overrides);
}

function normaliseJobDescription(
  raw: Record<string, unknown>,
  rawText: string,
  overrides?: { title?: string; company?: string },
): JobDescription {
  const reqs = (raw.requirements as Record<string, unknown> | undefined) ?? {};

  const validEmploymentTypes = ['full-time', 'part-time', 'contract', 'internship'];
  const empType = typeof raw.employmentType === 'string' && validEmploymentTypes.includes(raw.employmentType)
    ? (raw.employmentType as JobDescription['employmentType'])
    : null;

  return {
    id: uuidv4(),
    title: overrides?.title ?? (typeof raw.title === 'string' ? raw.title : 'Untitled Role'),
    company: overrides?.company ?? strOrNull(raw.company),
    location: strOrNull(raw.location),
    employmentType: empType,
    minExperienceYears: numOrNull(raw.minExperienceYears),
    requirements: {
      mustHave: strArray(reqs.mustHave),
      niceToHave: strArray(reqs.niceToHave),
      contextualPhrases: strArray(reqs.contextualPhrases),
    },
    responsibilities: strArray(raw.responsibilities),
    rawText,
    parsedAt: new Date().toISOString(),
  };
}

/* ── Coercion helpers (local duplicates kept to avoid cross-file coupling) ─ */
function strOrNull(val: unknown): string | null {
  return typeof val === 'string' && val.trim() ? val.trim() : null;
}

function numOrNull(val: unknown): number | null {
  if (typeof val === 'number' && isFinite(val)) return val;
  if (typeof val === 'string') {
    const n = parseFloat(val);
    return isFinite(n) ? n : null;
  }
  return null;
}

function strArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());
}
