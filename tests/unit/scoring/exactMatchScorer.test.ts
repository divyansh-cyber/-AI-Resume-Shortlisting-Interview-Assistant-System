import { computeExactMatchScore } from '../../../src/services/scoring/exactMatchScorer';
import { ParsedResume, JobDescription } from '../../../src/domain';

/* ── Fixtures ────────────────────────────────────────────────────────────── */

function makeResume(overrides: Partial<ParsedResume> = {}): ParsedResume {
  return {
    id: 'resume-1',
    candidateName: 'Jane Dev',
    email: 'jane@example.com',
    phone: null,
    location: null,
    linkedinUrl: null,
    githubUrl: null,
    portfolioUrl: null,
    summary: null,
    skills: { technical: ['TypeScript', 'Node.js', 'PostgreSQL'], soft: [], other: [] },
    experience: [
      {
        company: 'Acme',
        title: 'Engineer',
        location: null,
        startDate: '2020-01',
        endDate: null,
        isCurrent: true,
        description: 'Built backend services.',
        achievements: [],
        technologiesUsed: ['Docker', 'Redis'],
      },
    ],
    education: [],
    projects: [
      {
        name: 'MyApp',
        description: 'A side project',
        technologiesUsed: ['React'],
        ownershipSignals: [],
        url: null,
      },
    ],
    certifications: [],
    rawText: '',
    parsedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeJD(mustHave: string[], niceToHave: string[] = []): JobDescription {
  return {
    id: 'job-1',
    title: 'Senior Engineer',
    company: 'TechCorp',
    location: null,
    employmentType: 'full-time',
    minExperienceYears: 3,
    requirements: { mustHave, niceToHave, contextualPhrases: [] },
    responsibilities: [],
    rawText: '',
    parsedAt: new Date().toISOString(),
  };
}

/* ── Tests ───────────────────────────────────────────────────────────────── */

describe('computeExactMatchScore', () => {
  it('returns 100 when no mustHave skills are specified', () => {
    const score = computeExactMatchScore(makeResume(), makeJD([]));
    expect(score.value).toBe(100);
    expect(score.explanation).toContain('No required skills');
  });

  it('returns 100 when all mustHave skills are matched', () => {
    const score = computeExactMatchScore(
      makeResume(),
      makeJD(['TypeScript', 'Node.js', 'PostgreSQL']),
    );
    expect(score.value).toBe(100);
    expect(score.explanation).toContain('Matched all 3');
  });

  it('returns partial score when some skills are missing', () => {
    const score = computeExactMatchScore(
      makeResume(),
      makeJD(['TypeScript', 'Node.js', 'Kubernetes']),
    );
    // 2/3 matched = 66.67
    expect(score.value).toBeCloseTo(66.67, 0);
    expect(score.explanation).toContain('Missing');
    expect(score.explanation).toContain('Kubernetes');
  });

  it('returns 0 when no skills match', () => {
    const score = computeExactMatchScore(
      makeResume(),
      makeJD(['Java', 'Spring Boot', 'Oracle']),
    );
    expect(score.value).toBe(0);
  });

  it('matches skills from experience technologiesUsed', () => {
    const score = computeExactMatchScore(makeResume(), makeJD(['Docker', 'Redis']));
    expect(score.value).toBe(100);
  });

  it('matches skills from projects technologiesUsed', () => {
    const score = computeExactMatchScore(makeResume(), makeJD(['React']));
    expect(score.value).toBe(100);
  });

  it('is case-insensitive via normalisation', () => {
    // normaliseSkill lowercases; 'Node.js' → 'node.js', so JD must use same form
    const score = computeExactMatchScore(
      makeResume(),
      makeJD(['typescript', 'node.js', 'postgresql']),
    );
    expect(score.value).toBe(100);
  });

  it('uses alias matching — postgres matches postgresql', () => {
    const resume = makeResume({
      skills: { technical: ['Postgres'], soft: [], other: [] },
    });
    const score = computeExactMatchScore(resume, makeJD(['PostgreSQL']));
    expect(score.value).toBe(100);
  });

  it('uses alias matching — k8s matches kubernetes', () => {
    const resume = makeResume({
      skills: { technical: ['k8s'], soft: [], other: [] },
    });
    const score = computeExactMatchScore(resume, makeJD(['Kubernetes']));
    expect(score.value).toBe(100);
  });

  it('includes matched skills in evidence array', () => {
    const score = computeExactMatchScore(
      makeResume(),
      makeJD(['TypeScript', 'Node.js']),
    );
    expect(score.evidence).toContain('✓ TypeScript');
    expect(score.evidence).toContain('✓ Node.js');
  });

  it('value is always in [0, 100]', () => {
    const score = computeExactMatchScore(makeResume(), makeJD(['X', 'Y', 'Z', 'A', 'B']));
    expect(score.value).toBeGreaterThanOrEqual(0);
    expect(score.value).toBeLessThanOrEqual(100);
  });
});
