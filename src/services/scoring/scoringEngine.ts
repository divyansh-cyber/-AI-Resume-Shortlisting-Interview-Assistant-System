import { ParsedResume, JobDescription, ScoreCard, SCORE_WEIGHTS } from '../../domain';
import { computeExactMatchScore } from './exactMatchScorer';
import { computeSemanticSimilarityScore } from './semanticSimilarityScorer';
import { computeAchievementScore } from './achievementScorer';
import { computeOwnershipScore } from './ownershipScorer';
import { round } from '../../utils/math';
import { logger } from '../../utils/logger';

/**
 * Scoring Engine — orchestrates all four scoring dimensions and computes
 * the weighted overall score.
 *
 * Weight rationale (SCORE_WEIGHTS):
 *  • Exact Match (0.35)       — most objective signal; high weight
 *  • Semantic Similarity (0.30) — captures conceptual equivalents; second highest
 *  • Achievement (0.20)       — differentiates candidates with same skills
 *  • Ownership (0.15)         — especially important for senior roles
 *
 * The semantic and achievement computations are run in parallel (Promise.all)
 * since the semantic scorer makes an async embedding call that dominates latency.
 */
export async function runScoringEngine(
  resume: ParsedResume,
  jd: JobDescription,
): Promise<ScoreCard> {
  logger.info('Running scoring engine', {
    candidateId: resume.id,
    jobId: jd.id,
    candidate: resume.candidateName,
  });

  const startTime = Date.now();

  // Exact match and ownership are synchronous; semantic is async (embeddings).
  // Run async work in parallel to minimise total latency.
  const [exactMatch, semanticSimilarity] = await Promise.all([
    Promise.resolve(computeExactMatchScore(resume, jd)),
    computeSemanticSimilarityScore(resume, jd),
  ]);

  const achievement = computeAchievementScore(resume);
  const ownership = computeOwnershipScore(resume, jd);

  // Weighted composite score
  const overallScore = round(
    exactMatch.value       * SCORE_WEIGHTS.exactMatch +
    semanticSimilarity.value * SCORE_WEIGHTS.semanticSimilarity +
    achievement.value      * SCORE_WEIGHTS.achievement +
    ownership.value        * SCORE_WEIGHTS.ownership,
  );

  const elapsed = Date.now() - startTime;

  logger.info('Scoring complete', {
    candidateId: resume.id,
    jobId: jd.id,
    exactMatch: exactMatch.value,
    semantic: semanticSimilarity.value,
    achievement: achievement.value,
    ownership: ownership.value,
    overall: overallScore,
    elapsedMs: elapsed,
  });

  return {
    candidateId: resume.id,
    jobId: jd.id,
    exactMatchScore: exactMatch,
    semanticSimilarityScore: semanticSimilarity,
    achievementScore: achievement,
    ownershipScore: ownership,
    overallScore,
    evaluatedAt: new Date().toISOString(),
  };
}
