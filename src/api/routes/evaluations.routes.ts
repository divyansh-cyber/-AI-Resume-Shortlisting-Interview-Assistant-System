import { Router } from 'express';
import {
  createEvaluation,
  getEvaluation,
  listEvaluationsForJob,
} from '../controllers/evaluations.controller';
import { uploadResumeAsync } from '../middleware/upload';
import { Request, Response, NextFunction } from 'express';

const router = Router();

/**
 * POST /evaluations
 * Multipart form: resume (PDF), jobId (string), skipVerification? (bool string)
 * Returns 202 with evaluationId immediately; pipeline runs async.
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await uploadResumeAsync(req, res);
    await createEvaluation(req, res);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /evaluations/:id
 * Returns evaluation status and results (when complete).
 */
router.get('/:id', getEvaluation);

export default router;

export { listEvaluationsForJob };
