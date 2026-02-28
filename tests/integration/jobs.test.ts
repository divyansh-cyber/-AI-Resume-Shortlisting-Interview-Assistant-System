import request from 'supertest';
import { createApp } from '../../src/api/app';
import { NotFoundError } from '../../src/utils/errors';

// ── Mock DB layer ─────────────────────────────────────────────────────────────
jest.mock('../../src/db', () => ({
  jobRepository: {
    create: jest.fn(),
    findAll: jest.fn(),
    findById: jest.fn(),
    count: jest.fn(),
  },
  evaluationRepository: {
    findById: jest.fn(),
    findByJobId: jest.fn(),
  },
  resumeRepository: {
    create: jest.fn(),
  },
}));

// ── Mock parser service ───────────────────────────────────────────────────────
jest.mock('../../src/services/parser', () => ({
  parseAndSaveJob: jest.fn(),
  parseResumeWithLLM: jest.fn(),
  extractTextFromPdf: jest.fn(),
}));

import { jobRepository } from '../../src/db';
import { parseAndSaveJob } from '../../src/services/parser';

const mockJobRepo = jobRepository as jest.Mocked<typeof jobRepository>;
const mockParseAndSaveJob = parseAndSaveJob as jest.MockedFunction<typeof parseAndSaveJob>;

function makeFakeJob(overrides = {}) {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    title: 'Senior Engineer',
    company: 'Acme',
    location: 'Remote',
    employmentType: 'full-time',
    minExperienceYears: 4,
    requirements: {
      mustHave: ['TypeScript', 'Node.js'],
      niceToHave: ['Redis'],
      bonusPoints: [],
    },
    responsibilities: ['Build APIs'],
    rawText: 'Senior Engineer TypeScript Node.js...',
    parsedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('Jobs Routes (Integration)', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── POST /api/jobs ────────────────────────────────────────────────────────

  describe('POST /api/jobs', () => {
    it('returns 201 with jobId when body is valid', async () => {
      const fakeJob = makeFakeJob();
      mockParseAndSaveJob.mockResolvedValue({
        job: fakeJob as any,
        jobId: fakeJob.id,
      } as any);

      const res = await request(app)
        .post('/api/jobs')
        .send({
          title: 'Senior Engineer',
          company: 'Acme',
          rawText: 'A'.repeat(60),
        })
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('jobId');
      expect(res.body.title).toBe('Senior Engineer');
    });

    it('returns 400 when rawText is missing', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .send({ title: 'Engineer' })
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(400);
    });

    it('returns 400 when rawText is too short (< 50 chars)', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .send({ title: 'Engineer', rawText: 'Short' })
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(400);
    });

    it('returns 400 when title is missing', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .send({ rawText: 'A'.repeat(60) })
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(400);
    });
  });

  // ── GET /api/jobs ────────────────────────────────────────────────────────

  describe('GET /api/jobs', () => {
    it('returns 200 with data array and meta', async () => {
      mockJobRepo.findAll.mockResolvedValue([makeFakeJob() as any]);
      mockJobRepo.count.mockResolvedValue(1);

      const res = await request(app).get('/api/jobs');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toMatchObject({ total: 1 });
    });

    it('returns empty array when no jobs exist', async () => {
      mockJobRepo.findAll.mockResolvedValue([]);
      mockJobRepo.count.mockResolvedValue(0);

      const res = await request(app).get('/api/jobs');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.meta.total).toBe(0);
    });
  });

  // ── GET /api/jobs/:id ────────────────────────────────────────────────────

  describe('GET /api/jobs/:id', () => {
    it('returns 200 with job when found', async () => {
      const fakeJob = makeFakeJob();
      mockJobRepo.findById.mockResolvedValue(fakeJob as any);

      const res = await request(app).get(`/api/jobs/${fakeJob.id}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(fakeJob.id);
    });

    it('returns 400 for invalid UUID format', async () => {
      const res = await request(app).get('/api/jobs/not-a-uuid');
      expect(res.status).toBe(400);
    });

    it('returns 404 when job does not exist', async () => {
      mockJobRepo.findById.mockRejectedValue(
        new NotFoundError('Job not found'),
      );

      const res = await request(app).get(
        '/api/jobs/aaaaaaaa-0000-4000-8000-000000000099',
      );

      expect(res.status).toBe(404);
    });
  });

  // ── GET /health ───────────────────────────────────────────────────────────

  describe('GET /health', () => {
    it('returns 200 ok', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });
});
