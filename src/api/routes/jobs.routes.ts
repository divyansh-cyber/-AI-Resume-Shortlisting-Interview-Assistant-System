import { Router } from 'express';
import { createJob, listJobs, getJob } from '../controllers/jobs.controller';

const router = Router();

/**
 * POST /jobs
 * Body: { title, company?, rawText }
 * Creates a new job description from raw text using LLM parsing.
 */
router.post('/', createJob);

/**
 * GET /jobs
 * Query: limit, offset
 * Returns paginated list of jobs.
 */
router.get('/', listJobs);

/**
 * GET /jobs/:id
 * Returns a single job with full requirements.
 */
router.get('/:id', getJob);

export default router;
