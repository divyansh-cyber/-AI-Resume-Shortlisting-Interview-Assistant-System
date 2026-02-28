import { v4 as uuidv4 } from 'uuid';
import { chatCompletion } from './geminiClient';
import { ParsedResume } from '../../domain';
import { logger } from '../../utils/logger';
import { ValidationError } from '../../utils/errors';

/**
 * System prompt is long but deliberate: Gemini needs explicit instructions
 * for every edge case (missing fields, date formats, ownership language)
 * or it will hallucinate or collapse important structure.
 */
const RESUME_SYSTEM_PROMPT = `You are an expert resume parser. Your job is to extract structured data from raw resume text and return it as a single valid JSON object — nothing else, no markdown.

Rules:
1. Return ONLY a JSON object matching the schema below.
2. Use null for any field you cannot find. Do not guess or invent data.
3. For dates, use ISO 8601 format (YYYY-MM or YYYY-MM-DD). If only year is known, use YYYY-01.
4. Normalise skill names: "Node.js" not "node js", "TypeScript" not "typescript".
5. Extract achievements separately from responsibilities. An achievement has a measurable outcome (numbers, %, $, multipliers, named outcomes).
6. For ownershipSignals in projects, extract exact phrases that indicate the candidate led or owned the work: "built from scratch", "sole developer", "led the team", "architected", "drove", "founded", etc.
7. List ALL technologies mentioned in each work experience role under technologiesUsed.
8. isCurrent is true only if endDate is null/missing and there is explicit language like "present", "current", "ongoing".

JSON Schema:
{
  "candidateName": string | null,
  "email": string | null,
  "phone": string | null,
  "location": string | null,
  "linkedinUrl": string | null,
  "githubUrl": string | null,
  "portfolioUrl": string | null,
  "summary": string | null,
  "skills": {
    "technical": string[],
    "soft": string[],
    "other": string[]
  },
  "experience": [
    {
      "company": string,
      "title": string,
      "location": string | null,
      "startDate": string | null,
      "endDate": string | null,
      "isCurrent": boolean,
      "description": string,
      "achievements": string[],
      "technologiesUsed": string[]
    }
  ],
  "education": [
    {
      "institution": string,
      "degree": string | null,
      "field": string | null,
      "graduationYear": number | null,
      "gpa": number | null
    }
  ],
  "projects": [
    {
      "name": string,
      "description": string,
      "technologiesUsed": string[],
      "ownershipSignals": string[],
      "url": string | null
    }
  ],
  "certifications": [
    {
      "name": string,
      "issuer": string | null,
      "year": number | null
    }
  ]
}`;

/**
 * Calls Gemini to parse raw resume text into a structured `ParsedResume` object.
 *
 * The LLM is instructed to return JSON only — `responseMimeType: 'application/json'`
 * in the Gemini config enforces this at the model level, so we can safely
 * JSON.parse without a try/catch for most cases. We still validate the shape
 * and fill in defaults to handle partial outputs gracefully.
 */
export async function parseResumeWithLLM(rawText: string): Promise<ParsedResume> {
  logger.debug('Parsing resume with Gemini', { textLength: rawText.length });

  const responseText = await chatCompletion(
    [
      { role: 'system', content: RESUME_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Parse the following resume text:\n\n---\n${rawText}\n---`,
      },
    ],
    { temperature: 0.1 }, // Low temp — we want consistent extraction, not creativity
  );

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    logger.error('Gemini returned invalid JSON for resume parse', {
      preview: responseText.slice(0, 200),
    });
    throw new ValidationError('LLM returned malformed JSON during resume parsing');
  }

  return normaliseParsedResume(parsed, rawText);
}

/**
 * Fills in defaults and assigns runtime ids — ensures the object always
 * satisfies the `ParsedResume` interface regardless of what the LLM returns.
 */
function normaliseParsedResume(
  raw: Record<string, unknown>,
  rawText: string,
): ParsedResume {
  const skills = (raw.skills as Record<string, unknown> | undefined) ?? {};

  return {
    id: uuidv4(),
    candidateName: strOrNull(raw.candidateName),
    email: strOrNull(raw.email),
    phone: strOrNull(raw.phone),
    location: strOrNull(raw.location),
    linkedinUrl: strOrNull(raw.linkedinUrl),
    githubUrl: strOrNull(raw.githubUrl),
    portfolioUrl: strOrNull(raw.portfolioUrl),
    summary: strOrNull(raw.summary),
    skills: {
      technical: strArray(skills.technical),
      soft: strArray(skills.soft),
      other: strArray(skills.other),
    },
    experience: normaliseExperiences(raw.experience),
    education: normaliseEducation(raw.education),
    projects: normaliseProjects(raw.projects),
    certifications: normaliseCertifications(raw.certifications),
    rawText,
    parsedAt: new Date().toISOString(),
  };
}

function normaliseExperiences(raw: unknown): ParsedResume['experience'] {
  if (!Array.isArray(raw)) return [];
  return raw.map((e: Record<string, unknown>) => ({
    company: str(e.company, 'Unknown Company'),
    title: str(e.title, 'Unknown Title'),
    location: strOrNull(e.location),
    startDate: strOrNull(e.startDate),
    endDate: strOrNull(e.endDate),
    isCurrent: Boolean(e.isCurrent),
    description: str(e.description, ''),
    achievements: strArray(e.achievements),
    technologiesUsed: strArray(e.technologiesUsed),
  }));
}

function normaliseEducation(raw: unknown): ParsedResume['education'] {
  if (!Array.isArray(raw)) return [];
  return raw.map((e: Record<string, unknown>) => ({
    institution: str(e.institution, 'Unknown Institution'),
    degree: strOrNull(e.degree),
    field: strOrNull(e.field),
    graduationYear: numOrNull(e.graduationYear),
    gpa: numOrNull(e.gpa),
  }));
}

function normaliseProjects(raw: unknown): ParsedResume['projects'] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p: Record<string, unknown>) => ({
    name: str(p.name, 'Unnamed Project'),
    description: str(p.description, ''),
    technologiesUsed: strArray(p.technologiesUsed),
    ownershipSignals: strArray(p.ownershipSignals),
    url: strOrNull(p.url),
  }));
}

function normaliseCertifications(raw: unknown): ParsedResume['certifications'] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c: Record<string, unknown>) => ({
    name: str(c.name, 'Unknown Certification'),
    issuer: strOrNull(c.issuer),
    year: numOrNull(c.year),
  }));
}

/* ── Small coercion helpers ─────────────────────────────────────────────── */
function str(val: unknown, fallback: string): string {
  return typeof val === 'string' && val.trim() ? val.trim() : fallback;
}

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
  return val.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
            .map((v) => v.trim());
}
