import { extractTextFromPdf } from './pdfExtractor';
import { parseResumeWithLLM } from './resumeParser';
import { parseJobDescriptionWithLLM } from './jobParser';
import { resumeRepository, jobRepository } from '../../db';
import { ParsedResume, JobDescription } from '../../domain';
import { logger } from '../../utils/logger';

/* ── Resume parsing ─────────────────────────────────────────────────────── */

export interface ParseResumeResult {
  resume: ParsedResume;
  candidateId: string;
  resumeId: string;
}

/**
 * Full resume pipeline:
 *   PDF buffer → raw text extraction → Gemini LLM parse → DB persist
 *
 * Returns structured data + the DB ids needed downstream (evaluation creation).
 */
export async function parseAndSaveResume(
  pdfBuffer: Buffer,
  originalFilename: string,
): Promise<ParseResumeResult> {
  logger.info('Starting resume parse pipeline', { originalFilename });

  // Step 1: extract text from PDF
  const { text } = await extractTextFromPdf(pdfBuffer, originalFilename);

  // Step 2: LLM structured extraction
  const resume = await parseResumeWithLLM(text);

  // Step 3: persist to DB (upsert candidate + create resume row)
  const { candidateId, resumeId } = await resumeRepository.create(resume, originalFilename);

  logger.info('Resume parsed and saved', {
    candidateId,
    resumeId,
    candidate: resume.candidateName,
  });

  return { resume, candidateId, resumeId };
}

/* ── Job description parsing ─────────────────────────────────────────────── */

export interface ParseJobResult {
  job: JobDescription;
  jobId: string;
}

/**
 * Full JD pipeline:
 *   raw text → Gemini LLM parse → DB persist
 */
export async function parseAndSaveJob(
  rawText: string,
  overrides?: { title?: string; company?: string },
): Promise<ParseJobResult> {
  logger.info('Starting JD parse pipeline', { textLength: rawText.length });

  // LLM structured extraction
  const job = await parseJobDescriptionWithLLM(rawText, overrides);

  // Persist to DB
  const savedJob = await jobRepository.create(job);

  logger.info('Job description parsed and saved', {
    jobId: savedJob.id,
    title: savedJob.title,
    mustHaveCount: savedJob.requirements.mustHave.length,
  });

  return { job: savedJob, jobId: savedJob.id };
}
