import request from 'supertest';
import { createApp } from '../../src/api/app';
import { NotFoundError } from '../../src/utils/errors';

// ── Mock all external dependencies ────────────────────────────────────────────
jest.mock('../../src/db', () => ({
  jobRepository: {
    findById: jest.fn(),
    count: jest.fn(),
    findAll: jest.fn(),
  },
  evaluationRepository: {
    create: jest.fn(),
    findById: jest.fn(),
    findByJob: jest.fn(),
    updateStatus: jest.fn(),
    updateScoring: jest.fn(),
    updateVerification: jest.fn(),
    updateQuestionsAndComplete: jest.fn(),
    count: jest.fn(),
    countByJob: jest.fn(),
  },
  resumeRepository: {
    create: jest.fn(),
  },
}));

jest.mock('../../src/services/parser', () => ({
  parseAndSaveJob: jest.fn(),
  parseResumeWithLLM: jest.fn(),
  extractTextFromPdf: jest.fn(),
}));

jest.mock('../../src/services/scoring', () => ({
  runScoringEngine: jest.fn(),
}));

jest.mock('../../src/services/verification', () => ({
  runVerification: jest.fn(),
}));

jest.mock('../../src/services/questions', () => ({
  classifyTier: jest.fn(),
  generateQuestionsAndSummary: jest.fn(),
}));

// ── Import mocks after jest.mock calls ────────────────────────────────────────
import { evaluationRepository, jobRepository } from '../../src/db';

const mockJobRepo = jobRepository as jest.Mocked<typeof jobRepository>;

const mockEvalRepo = evaluationRepository as jest.Mocked<typeof evaluationRepository>;

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_UUID = 'bbbbbbbb-0000-4000-8000-000000000001';
const EVAL_UUID = 'cccccccc-0000-4000-8000-000000000002';

function makeFakeEvaluation(overrides = {}) {
  return {
    id: EVAL_UUID,
    jobId: VALID_UUID,
    candidateId: 'cand-1',
    resumeId: 'res-1',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}


describe('Evaluations Routes (Integration)', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── GET /api/evaluations/:id ──────────────────────────────────────────────

  describe('GET /api/evaluations/:id', () => {
    it('returns 200 with evaluation when found', async () => {
      mockEvalRepo.findById.mockResolvedValue(makeFakeEvaluation() as any);

      const res = await request(app).get(`/api/evaluations/${EVAL_UUID}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(EVAL_UUID);
    });

    it('returns 400 for invalid UUID format', async () => {
      const res = await request(app).get('/api/evaluations/not-a-uuid');
      expect(res.status).toBe(400);
    });

    it('returns 404 when evaluation not found', async () => {
      mockEvalRepo.findById.mockRejectedValue(
        new NotFoundError('Evaluation not found'),
      );

      const res = await request(app).get(`/api/evaluations/${EVAL_UUID}`);
      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/evaluations (no file) ──────────────────────────────────────

  describe('POST /api/evaluations — missing file', () => {
    it('returns 400 when no resume PDF is attached', async () => {
      const res = await request(app)
        .post('/api/evaluations')
        .field('jobId', VALID_UUID);

      expect(res.status).toBe(400);
    });

    it('returns 400 when jobId is missing', async () => {
      const res = await request(app)
        .post('/api/evaluations')
        .attach('resume', Buffer.from('%PDF-1.4 fake'), {
          filename: 'test.pdf',
          contentType: 'application/pdf',
        });

      expect(res.status).toBe(400);
    });

    it('returns 400 when jobId is not a valid UUID', async () => {
      const res = await request(app)
        .post('/api/evaluations')
        .field('jobId', 'not-a-uuid')
        .attach('resume', Buffer.from('%PDF-1.4 fake'), {
          filename: 'test.pdf',
          contentType: 'application/pdf',
        });

      expect(res.status).toBe(400);
    });
  });

  // ── GET /api/jobs/:jobId/evaluations ──────────────────────────────────────

  describe('GET /api/jobs/:jobId/evaluations', () => {
    it('returns 200 with evaluation list for a job', async () => {
      mockJobRepo.findById.mockResolvedValue({} as any); // job exists check
      mockEvalRepo.findByJob.mockResolvedValue([makeFakeEvaluation() as any]);
      mockEvalRepo.countByJob.mockResolvedValue({ total: 1, A: 1, B: 0, C: 0 } as any);

      const res = await request(app).get(`/api/jobs/${VALID_UUID}/evaluations`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns 400 for invalid jobId UUID', async () => {
      const res = await request(app).get('/api/jobs/not-a-uuid/evaluations');
      expect(res.status).toBe(400);
    });
  });

  // ── Non-existent routes ───────────────────────────────────────────────────

  describe('Unknown routes', () => {
    it('returns 404 for unknown route', async () => {
      const res = await request(app).get('/api/does-not-exist');
      expect(res.status).toBe(404);
    });
  });
});
