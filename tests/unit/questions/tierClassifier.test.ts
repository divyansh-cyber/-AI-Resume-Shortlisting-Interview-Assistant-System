import { classifyTier } from '../../../src/services/questions/tierClassifier';
import { ScoreCard, DEFAULT_TIER_THRESHOLDS } from '../../../src/domain';

function makeScoreCard(overallScore: number, overrides: Partial<ScoreCard> = {}): ScoreCard {
  const dim = (v: number) => ({ value: v, explanation: `Score: ${v}`, evidence: [] });
  return {
    candidateId: 'cand-1',
    jobId: 'job-1',
    exactMatchScore: dim(overallScore),
    semanticSimilarityScore: dim(overallScore),
    achievementScore: dim(overallScore),
    ownershipScore: dim(overallScore),
    overallScore,
    evaluatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('classifyTier', () => {
  describe('Tier A', () => {
    it('assigns Tier A when score >= tierA threshold', () => {
      const result = classifyTier(makeScoreCard(75));
      expect(result.tier).toBe('A');
    });

    it('assigns Tier A for score well above threshold', () => {
      const result = classifyTier(makeScoreCard(95));
      expect(result.tier).toBe('A');
    });

    it('assigns Tier A exactly at threshold', () => {
      const result = classifyTier(makeScoreCard(DEFAULT_TIER_THRESHOLDS.tierA));
      expect(result.tier).toBe('A');
    });

    it('rationale mentions fast-track', () => {
      const result = classifyTier(makeScoreCard(80));
      expect(result.rationale.toLowerCase()).toContain('fast-track');
    });
  });

  describe('Tier B', () => {
    it('assigns Tier B for score in [tierB, tierA)', () => {
      const result = classifyTier(makeScoreCard(60));
      expect(result.tier).toBe('B');
    });

    it('assigns Tier B exactly at tierB threshold', () => {
      const result = classifyTier(makeScoreCard(DEFAULT_TIER_THRESHOLDS.tierB));
      expect(result.tier).toBe('B');
    });

    it('assigns Tier B just below tierA', () => {
      const result = classifyTier(makeScoreCard(DEFAULT_TIER_THRESHOLDS.tierA - 1));
      expect(result.tier).toBe('B');
    });

    it('rationale mentions technical screen', () => {
      const result = classifyTier(makeScoreCard(62));
      expect(result.rationale.toLowerCase()).toMatch(/tech(nical)?\s+screen/);
    });
  });

  describe('Tier C', () => {
    it('assigns Tier C for score below tierB threshold', () => {
      const result = classifyTier(makeScoreCard(30));
      expect(result.tier).toBe('C');
    });

    it('assigns Tier C for score of 0', () => {
      const result = classifyTier(makeScoreCard(0));
      expect(result.tier).toBe('C');
    });

    it('assigns Tier C just below tierB', () => {
      const result = classifyTier(makeScoreCard(DEFAULT_TIER_THRESHOLDS.tierB - 1));
      expect(result.tier).toBe('C');
    });

    it('rationale mentions recruiter review', () => {
      const result = classifyTier(makeScoreCard(20));
      expect(result.rationale.toLowerCase()).toContain('review');
    });
  });

  describe('custom thresholds', () => {
    it('respects custom thresholds', () => {
      const custom = { tierA: 90, tierB: 70 };
      expect(classifyTier(makeScoreCard(85), custom).tier).toBe('B');
      expect(classifyTier(makeScoreCard(95), custom).tier).toBe('A');
      expect(classifyTier(makeScoreCard(60), custom).tier).toBe('C');
    });
  });

  describe('rationale content', () => {
    it('includes the overall score', () => {
      const result = classifyTier(makeScoreCard(78));
      expect(result.rationale).toContain('78');
    });

    it('includes thresholds reference in returned object', () => {
      const result = classifyTier(makeScoreCard(78));
      expect(result.thresholds).toEqual(DEFAULT_TIER_THRESHOLDS);
    });

    it('identifies weak dimensions in Tier B rationale', () => {
      const sc = makeScoreCard(60);
      sc.ownershipScore = { value: 20, explanation: 'Low', evidence: [] };
      sc.achievementScore = { value: 15, explanation: 'Low', evidence: [] };
      const result = classifyTier(sc);
      expect(result.tier).toBe('B');
      expect(result.rationale).toMatch(/achievement|ownership/i);
    });
  });
});
