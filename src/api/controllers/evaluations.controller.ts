import fs from 'fs';
import { Request, Response } from 'express';
import { z } from 'zod';
import { jobRepository, evaluationRepository, resumeRepository } from '../../db';
import { parseResumeWithLLM } from '../../services/parser';
import { extractTextFromPdf } from '../../services/parser';
import { runScoringEngine } from '../../services/scoring';
import { classifyTier } from '../../services/questions';
import { runVerification } from '../../services/verification';
import { generateQuestionsAndSummary } from '../../services/questions';
import { ValidationError } from '../../utils/errors';
import { logger } from '../../utils/logger';

// ── Zod schemas ───────────────────────────────────────────────────────────────

const CreateEvaluationBody = z.object({
  jobId: z.string().uuid('jobId must be a valid UUID'),
  skipVerification: z
    .union([z.boolean(), z.string().transform((v) => v === 'true')])
    .default(false),
});

const UuidParam = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

const JobUuidParam = z.object({
  jobId: z.string().uuid('jobId must be a valid UUID'),
});

const PaginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  tier: z.enum(['A', 'B', 'C']).optional(),
});

export const evaluationSchemas = {
  CreateEvaluationBody,
  UuidParam,
  JobUuidParam,
  PaginationQuery,
};

// ── Controller methods ────────────────────────────────────────────────────────

/**
 * POST /evaluations
 *
 * Accepts a multipart POST with:
 *   - `resume`: PDF file (required)
 *   - `jobId`: UUID string (required, in form fields)
 *   - `skipVerification`: boolean string optional
 *
 * Returns 202 immediately with an evaluation ID.
 * The full pipeline runs asynchronously in the background.
 */
export async function createEvaluation(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    throw new ValidationError('A PDF resume file is required (field name: "resume").');
  }

  const body = CreateEvaluationBody.parse(req.body);

  // Verify job exists before kicking off expensive pipeline
  const jd = await jobRepository.findById(body.jobId);

  // Read PDF into buffer then delete the temp file
  const pdfBuffer = fs.readFileSync(req.file.path);
  fs.unlink(req.file.path, (err) => {
    if (err) logger.warn('Failed to delete temp upload file', { path: req.file!.path });
  });

  // Create the evaluation DB row in 'pending' state
  // We need a candidateId + resumeId first — parse synchronously so we have an id.
  const { text: rawText } = await extractTextFromPdf(pdfBuffer, req.file.originalname);
  const parsedResume = await parseResumeWithLLM(rawText);

  const { candidateId, resumeId } = await resumeRepository.create(
    parsedResume,
    req.file.originalname,
  );

  const evaluation = await evaluationRepository.create({
    candidateId,
    resumeId,
    jobId: body.jobId,
  });

  // Return 202 immediately — pipeline continues in background
  res.status(202).json({
    id: evaluation.id,
    candidateId,
    jobId: body.jobId,
    status: 'pending',
    message: 'Evaluation accepted. Poll GET /evaluations/:id for status updates.',
  });

  // ── Background pipeline (non-blocking) ──────────────────────────────────
  void runEvaluationPipeline({
    evaluationId: evaluation.id,
    parsedResume,
    jd,
    skipVerification: body.skipVerification as boolean,
  });
}

/**
 * GET /evaluations/:id
 * Returns the current state of an evaluation (status + results when complete).
 */
export async function getEvaluation(req: Request, res: Response): Promise<void> {
  const { id } = UuidParam.parse(req.params);
  const evaluation = await evaluationRepository.findById(id);
  res.json(evaluation);
}

/**
 * GET /jobs/:jobId/evaluations
 * Returns paginated completed evaluations for a job, sorted by score desc.
 */
export async function listEvaluationsForJob(req: Request, res: Response): Promise<void> {
  const { jobId } = JobUuidParam.parse(req.params);
  const { limit, offset, tier } = PaginationQuery.parse(req.query);

  // Verify job exists
  await jobRepository.findById(jobId);

  const [evaluations, counts] = await Promise.all([
    evaluationRepository.findByJob(jobId, { limit, offset, tier }),
    evaluationRepository.countByJob(jobId),
  ]);

  res.json({
    data: evaluations.map((e) => ({
      id: e.id,
      candidateId: e.candidateId,
      status: e.status,
      overallScore: e.scoreCard?.overallScore ?? null,
      tier: e.tierClassification?.tier ?? null,
      executiveSummary: e.executiveSummary,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    })),
    meta: {
      total: counts.total,
      tierBreakdown: { A: counts.A, B: counts.B, C: counts.C },
      limit,
      offset,
    },
  });
}

// ── Background pipeline ───────────────────────────────────────────────────────

interface PipelineOptions {
  evaluationId: string;
  parsedResume: import('../../domain').ParsedResume;
  jd: import('../../domain').JobDescription;
  skipVerification: boolean;
}

async function runEvaluationPipeline(opts: PipelineOptions): Promise<void> {
  const { evaluationId, parsedResume, jd, skipVerification } = opts;

  try {
    // ── Steps 1 & 2 in parallel: Scoring + Verification ───────────────────
    await evaluationRepository.updateStatus(evaluationId, 'scoring');

    const [scoreCard, verification] = await Promise.all([
      runScoringEngine(parsedResume, jd),
      runVerification(parsedResume, { skipVerification }),
    ]);

    const tier = classifyTier(scoreCard);

    await Promise.all([
      evaluationRepository.updateScoring(evaluationId, scoreCard, tier),
      evaluationRepository.updateVerification(evaluationId, verification),
    ]);

    logger.info('Scoring complete', {
      evaluationId,
      overallScore: scoreCard.overallScore,
      tier: tier.tier,
    });

    // ── Step 3: Question generation ────────────────────────────────────────
    await evaluationRepository.updateStatus(evaluationId, 'generating');
    const { interviewQuestions, executiveSummary } = await generateQuestionsAndSummary(
      parsedResume,
      jd,
      scoreCard,
      tier,
      verification,
    );

    await evaluationRepository.updateQuestionsAndComplete(
      evaluationId,
      interviewQuestions,
      executiveSummary,
    );

    logger.info('Evaluation pipeline complete', {
      evaluationId,
      questionCount: interviewQuestions.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown pipeline error';
    logger.error('Evaluation pipeline failed', { evaluationId, err });
    await evaluationRepository.updateStatus(evaluationId, 'failed', message).catch(() => {
      logger.error('Failed to update evaluation status to failed', { evaluationId });
    });
  }
}
