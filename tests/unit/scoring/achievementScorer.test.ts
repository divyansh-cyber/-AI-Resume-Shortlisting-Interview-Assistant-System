import { computeAchievementScore } from '../../../src/services/scoring/achievementScorer';
import { ParsedResume } from '../../../src/domain';

function makeResume(overrides: Partial<ParsedResume> = {}): ParsedResume {
  return {
    id: 'resume-1',
    candidateName: 'Jane Dev',
    email: null,
    phone: null,
    location: null,
    linkedinUrl: null,
    githubUrl: null,
    portfolioUrl: null,
    summary: null,
    skills: { technical: [], soft: [], other: [] },
    experience: [],
    education: [],
    projects: [],
    certifications: [],
    rawText: '',
    parsedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('computeAchievementScore', () => {
  it('returns a low score for resume with no achievements', () => {
    const score = computeAchievementScore(makeResume());
    expect(score.value).toBeLessThan(20);
    expect(score.explanation).toContain('No quantifiable');
  });

  it('scores higher when experience has explicit achievements', () => {
    const resume = makeResume({
      experience: [
        {
          company: 'Acme',
          title: 'Engineer',
          location: null,
          startDate: '2020-01',
          endDate: null,
          isCurrent: true,
          description: 'Built system.',
          achievements: [
            'Increased throughput by 40%',
            'Reduced infrastructure cost by $200k annually',
            'Led migration saving 3x engineering time',
          ],
          technologiesUsed: [],
        },
      ],
    });
    const score = computeAchievementScore(resume);
    expect(score.value).toBeGreaterThan(35);
    expect(score.evidence.length).toBeGreaterThan(0);
  });

  it('detects quantifiable metrics in descriptions', () => {
    const resume = makeResume({
      experience: [
        {
          company: 'Corp',
          title: 'Dev',
          location: null,
          startDate: '2021-01',
          endDate: null,
          isCurrent: true,
          description: 'Improved API latency by 60%, saving $50k per year. System handles 10k RPS.',
          achievements: [],
          technologiesUsed: [],
        },
      ],
    });
    const score = computeAchievementScore(resume);
    expect(score.value).toBeGreaterThan(30);
  });

  it('detects strong action verbs', () => {
    const resume = makeResume({
      experience: [
        {
          company: 'StartupXYZ',
          title: 'Lead',
          location: null,
          startDate: '2022-01',
          endDate: null,
          isCurrent: true,
          description: 'Launched new payment product. Architected microservices. Automated deployment pipeline. Migrated legacy monolith.',
          achievements: [],
          technologiesUsed: [],
        },
      ],
    });
    const score = computeAchievementScore(resume);
    expect(score.value).toBeGreaterThan(10);
    expect(score.evidence.some((e) => e.includes('Action verbs'))).toBe(true);
  });

  it('awards points for certifications', () => {
    const withCerts = computeAchievementScore(
      makeResume({
        certifications: [
          { name: 'AWS Solutions Architect', issuer: 'Amazon', year: 2023 },
          { name: 'CKA', issuer: 'CNCF', year: 2023 },
        ],
      }),
    );
    const withoutCerts = computeAchievementScore(makeResume());
    expect(withCerts.value).toBeGreaterThan(withoutCerts.value);
  });

  it('value is always in [0, 100]', () => {
    // Extremely high-achiever resume
    const resume = makeResume({
      experience: Array.from({ length: 10 }, (_, i) => ({
        company: `Company${i}`,
        title: 'Senior Engineer',
        location: null,
        startDate: '2015-01',
        endDate: null,
        isCurrent: i === 0,
        description: 'Increased revenue 5x. Reduced costs by 80%. Saved $10M. Led 20-person team. Launched 5 products.',
        achievements: [
          'Grew ARR from $1M to $50M',
          'Reduced churn by 40%',
          'Hired and mentored 15 engineers',
        ],
        technologiesUsed: [],
      })),
    });
    const score = computeAchievementScore(resume);
    expect(score.value).toBeLessThanOrEqual(100);
    expect(score.value).toBeGreaterThanOrEqual(0);
  });
});
