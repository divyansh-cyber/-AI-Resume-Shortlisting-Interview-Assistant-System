import { computeOwnershipScore } from '../../../src/services/scoring/ownershipScorer';
import { ParsedResume, JobDescription } from '../../../src/domain';

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

function makeJD(contextualPhrases: string[] = []): JobDescription {
  return {
    id: 'job-1',
    title: 'Engineer',
    company: null,
    location: null,
    employmentType: null,
    minExperienceYears: null,
    requirements: { mustHave: [], niceToHave: [], contextualPhrases },
    responsibilities: [],
    rawText: '',
    parsedAt: new Date().toISOString(),
  };
}

describe('computeOwnershipScore', () => {
  it('returns a low score for resume with no ownership signals', () => {
    const score = computeOwnershipScore(makeResume(), makeJD());
    expect(score.value).toBeLessThan(20);
    expect(score.explanation).toContain('No ownership');
  });

  it('detects ownership signals in project ownershipSignals', () => {
    const resume = makeResume({
      projects: [
        {
          name: 'MyProject',
          description: 'A project',
          technologiesUsed: [],
          ownershipSignals: ['built from scratch', 'sole developer'],
          url: null,
        },
      ],
    });
    const score = computeOwnershipScore(resume, makeJD());
    expect(score.value).toBeGreaterThan(20);
    expect(score.evidence.some((e) => e.includes('built from scratch'))).toBe(true);
  });

  it('detects "architected" in experience descriptions', () => {
    const resume = makeResume({
      experience: [
        {
          company: 'Acme',
          title: 'Engineer',
          location: null,
          startDate: '2020-01',
          endDate: null,
          isCurrent: true,
          description: 'Architected the entire data pipeline from scratch.',
          achievements: [],
          technologiesUsed: [],
        },
      ],
    });
    const score = computeOwnershipScore(resume, makeJD());
    expect(score.value).toBeGreaterThan(10);
  });

  it('detects "led team" signal', () => {
    const resume = makeResume({
      experience: [
        {
          company: 'BigCorp',
          title: 'Senior Engineer',
          location: null,
          startDate: '2019-01',
          endDate: null,
          isCurrent: true,
          description: 'Led a team of 8 engineers to deliver core platform.',
          achievements: [],
          technologiesUsed: [],
        },
      ],
    });
    const score = computeOwnershipScore(resume, makeJD());
    expect(score.value).toBeGreaterThan(25);
  });

  it('awards title bonus for senior roles', () => {
    const seniorResume = makeResume({
      experience: [
        {
          company: 'Corp',
          title: 'Principal Engineer',
          location: null,
          startDate: '2018-01',
          endDate: null,
          isCurrent: true,
          description: 'Worked on backend services.',
          achievements: [],
          technologiesUsed: [],
        },
      ],
    });
    const juniorResume = makeResume({
      experience: [
        {
          company: 'Corp',
          title: 'Junior Developer',
          location: null,
          startDate: '2022-01',
          endDate: null,
          isCurrent: true,
          description: 'Worked on backend services.',
          achievements: [],
          technologiesUsed: [],
        },
      ],
    });
    expect(computeOwnershipScore(seniorResume, makeJD()).value).toBeGreaterThan(
      computeOwnershipScore(juniorResume, makeJD()).value,
    );
  });

  it('boosts score when JD contextual phrases align with resume language', () => {
    const resume = makeResume({
      experience: [
        {
          company: 'Corp',
          title: 'Lead',
          location: null,
          startDate: '2020-01',
          endDate: null,
          isCurrent: true,
          description: 'Owned features end-to-end and drove architecture decisions.',
          achievements: [],
          technologiesUsed: [],
        },
      ],
    });
    const jdWithPhrases = makeJD(['own features end-to-end', 'lead architecture decisions']);
    const jdNoPhrases = makeJD([]);
    expect(computeOwnershipScore(resume, jdWithPhrases).value).toBeGreaterThanOrEqual(
      computeOwnershipScore(resume, jdNoPhrases).value,
    );
  });

  it('value is always in [0, 100]', () => {
    const resume = makeResume({
      projects: Array.from({ length: 10 }, (_, i) => ({
        name: `Project ${i}`,
        description: 'Led and architected',
        technologiesUsed: [],
        ownershipSignals: ['built from scratch', 'sole developer', 'founded', 'architected'],
        url: null,
      })),
    });
    const score = computeOwnershipScore(resume, makeJD());
    expect(score.value).toBeLessThanOrEqual(100);
    expect(score.value).toBeGreaterThanOrEqual(0);
  });
});
