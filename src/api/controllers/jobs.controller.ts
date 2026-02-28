import { Request, Response } from 'express';
import { z } from 'zod';
import { jobRepository } from '../../db';
import { parseAndSaveJob } from '../../services/parser';
import { NotFoundError } from '../../utils/errors';

// ── Zod schemas ──────────────────────────────────────────────────────────────

const CreateJobBody = z.object({
  title: z.string().min(1).max(200),
  company: z.string().max(200).optional(),
  rawText: z.string().min(50, 'Job description must be at least 50 characters'),
});

const PaginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const UuidParam = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

export const jobSchemas = { CreateJobBody, PaginationQuery, UuidParam };

// ── Controller methods ───────────────────────────────────────────────────────

/**
 * POST /jobs
 * Accepts raw JD text, runs LLM parsing, persists to DB.
 */
export async function createJob(req: Request, res: Response): Promise<void> {
  const body = CreateJobBody.parse(req.body);

  const { job, jobId } = await parseAndSaveJob(body.rawText, {
    title: body.title,
    company: body.company,
  });

  res.status(201).json({
    jobId,
    title: job.title,
    company: job.company,
    mustHaveCount: job.requirements.mustHave.length,
    niceToHaveCount: job.requirements.niceToHave.length,
    createdAt: job.parsedAt,
  });
}

/**
 * GET /jobs
 * Returns paginated list of jobs.
 */
export async function listJobs(req: Request, res: Response): Promise<void> {
  const { limit, offset } = PaginationQuery.parse(req.query);

  const [jobs, total] = await Promise.all([
    jobRepository.findAll(limit, offset),
    jobRepository.count(),
  ]);

  res.json({
    data: jobs.map((j) => ({
      id: j.id,
      title: j.title,
      company: j.company,
      location: j.location,
      employmentType: j.employmentType,
      minExperienceYears: j.minExperienceYears,
      mustHaveCount: j.requirements.mustHave.length,
      parsedAt: j.parsedAt,
    })),
    meta: { total, limit, offset },
  });
}

/**
 * GET /jobs/:id
 * Returns a single job with full requirements.
 */
export async function getJob(req: Request, res: Response): Promise<void> {
  const { id } = UuidParam.parse(req.params);
  const job = await jobRepository.findById(id);
  if (!job) throw new NotFoundError('Job', id);
  res.json(job);
}
