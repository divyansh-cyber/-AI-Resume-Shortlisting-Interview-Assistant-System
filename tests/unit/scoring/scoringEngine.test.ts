import { runScoringEngine } from '../../../src/services/scoring/scoringEngine';
import * as semanticScorer from '../../../src/services/scoring/semanticSimilarityScorer';
import { ParsedResume, JobDescription } from '../../../src/domain';

jest.mock('../../../src/services/scoring/semanticSimilarityScorer');

const mockSemantic = semanticScorer.computeSemanticSimilarityScore as jest.MockedFunction<
  typeof semanticScorer.computeSemanticSimilarityScore
>;

function makeResume(overrides: Partial<ParsedResume> = {}): ParsedResume {
  return {
    id: 'resume-1',
    candidateName: 'Alice Smith',
    email: 'alice@example.com',
    phone: null,
    location: null,
    linkedinUrl: 'https://linkedin.com/in/alice',
    githubUrl: 'https://github.com/alice',
    portfolioUrl: null,
    summary: null,
    skills: { technical: ['TypeScript', 'Node.js', 'PostgreSQL'], soft: [], other: [] },
    experience: [
      {
        company: 'Acme Corp',
        title: 'Senior Engineer',
        location: null,
        startDate: '2019-01',
        endDate: '2024-01',
        isCurrent: false,
        description: 'Led development of payment service. Reduced latency by 40%.',
        achievements: ['Reduced latency by 40%', 'Improved throughput 3x'],
        technologiesUsed: ['TypeScript', 'Node.js'],
      },
    ],
    education: [
      { institution: 'MIT', degree: 'BSc Computer Science', field: null, graduationYear: 2018, gpa: null },
    ],
    projects: [],
    certifications: [],
    rawText: 'Alice Smith TypeScript Node.js PostgreSQL',
    parsedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeJob(overrides: Partial<JobDescription> = {}): JobDescription {
  return {
    id: 'job-1',
    title: 'Senior Software Engineer',
    company: 'TechCorp',
    location: null,
    employmentType: 'full-time',
    minExperienceYears: 4,
    requirements: {
      mustHave: ['TypeScript', 'Node.js', 'PostgreSQL'],
      niceToHave: ['Redis', 'Docker'],
      contextualPhrases: [],
    },
    responsibilities: ['Design APIs', 'Build microservices'],
    rawText: 'Senior Software Engineer TypeScript Node.js PostgreSQL',
    parsedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('runScoringEngine', () => {
  beforeEach(() => {
    mockSemantic.mockResolvedValue({
      value: 70,
      explanation: 'Semantic similarity: 70',
      evidence: ['TypeScript', 'Node.js'],
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns a ScoreCard with all required fields', async () => {
    const result = await runScoringEngine(makeResume(), makeJob());
    expect(result).toHaveProperty('exactMatchScore');
    expect(result).toHaveProperty('semanticSimilarityScore');
    expect(result).toHaveProperty('achievementScore');
    expect(result).toHaveProperty('ownershipScore');
    expect(result).toHaveProperty('overallScore');
    expect(result).toHaveProperty('evaluatedAt');
  });

  it('overallScore is a number in [0, 100]', async () => {
    mockSemantic.mockResolvedValue({ value: 80, explanation: '', evidence: [] });

    const resume = makeResume({
      skills: { technical: ['TypeScript', 'Node.js', 'PostgreSQL'], soft: [], other: [] },
      experience: [
        {
          company: 'Corp',
          title: 'Lead',
          location: null,
          startDate: '2020-01',
          endDate: '2024-01',
          isCurrent: false,
          description: 'Improved performance by 30%. Led team of 5 engineers.',
          achievements: [],
          technologiesUsed: [],
        },
      ],
    });

    const result = await runScoringEngine(resume, makeJob());
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
  });

  it('sets candidateId from resume.id', async () => {
    const resume = makeResume({ id: 'cand-xyz' });
    const result = await runScoringEngine(resume, makeJob());
    expect(result.candidateId).toBe('cand-xyz');
  });

  it('sets jobId from jd.id', async () => {
    const job = makeJob({ id: 'job-xyz' });
    const result = await runScoringEngine(makeResume(), job);
    expect(result.jobId).toBe('job-xyz');
  });

  it('calls computeSemanticSimilarityScore exactly once', async () => {
    await runScoringEngine(makeResume(), makeJob());
    expect(mockSemantic).toHaveBeenCalledTimes(1);
  });

  it('evaluatedAt is a valid ISO date string', async () => {
    const result = await runScoringEngine(makeResume(), makeJob());
    expect(() => new Date(result.evaluatedAt)).not.toThrow();
    expect(new Date(result.evaluatedAt).toISOString()).toBe(result.evaluatedAt);
  });

  it('exactMatchScore is low when resume skills do not match JD', async () => {
    mockSemantic.mockResolvedValue({ value: 5, explanation: '', evidence: [] });
    const resume = makeResume({
      skills: { technical: ['COBOL', 'FORTRAN'], soft: [], other: [] },
      // override experience to remove TypeScript/Node.js from technologiesUsed
      experience: [
        {
          company: 'OldCo',
          title: 'COBOL Dev',
          location: null,
          startDate: '2015-01',
          endDate: '2020-01',
          isCurrent: false,
          description: 'Maintained mainframe systems.',
          achievements: [],
          technologiesUsed: ['COBOL'],
        },
      ],
      projects: [],
    });
    const job = makeJob({
      requirements: {
        mustHave: ['TypeScript', 'Node.js', 'React'],
        niceToHave: [],
        contextualPhrases: [],
      },
    });
    const result = await runScoringEngine(resume, job);
    expect(result.exactMatchScore.value).toBeLessThan(30);
  });

  it('overall score higher when all dimensions return high values', async () => {
    mockSemantic.mockResolvedValue({ value: 90, explanation: '', evidence: [] });
    const goodResume = makeResume({
      skills: { technical: ['TypeScript', 'Node.js', 'PostgreSQL', 'Redis'], soft: [], other: [] },
      experience: [
        {
          company: 'TechCo',
          title: 'Principal Engineer',
          location: null,
          startDate: '2018-01',
          endDate: '2024-01',
          isCurrent: false,
          description:
            'Owned and architected entire platform. Reduced costs by 50%. Built team of 10.',
          achievements: ['Reduced costs by 50%', 'Built team of 10'],
          technologiesUsed: ['TypeScript', 'Node.js'],
        },
      ],
    });
    const result = await runScoringEngine(goodResume, makeJob());
    expect(result.overallScore).toBeGreaterThan(50);
  });
});
