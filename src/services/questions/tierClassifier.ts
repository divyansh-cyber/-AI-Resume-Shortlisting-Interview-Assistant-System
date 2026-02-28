import { ScoreCard, TierClassification, DEFAULT_TIER_THRESHOLDS, TierThresholds } from '../../domain';
import { round } from '../../utils/math';

/**
 * Tier Classifier — deterministically assigns Tier A / B / C based on
 * the weighted overall score produced by the Scoring Engine.
 *
 * Tiers and their downstream actions:
 *   A (≥75)  → Fast-track: HR call + technical interview scheduled immediately
 *   B (50–74) → Tech Screen: async coding challenge or short technical screen
 *   C (<50)   → Needs Review: recruiter manual review before any action
 *
 * The rationale string is written for a recruiter — it references the actual
 * dimension scores so they understand *why* a candidate landed in a tier,
 * not just that they did.
 */
export function classifyTier(
  scoreCard: ScoreCard,
  thresholds: TierThresholds = DEFAULT_TIER_THRESHOLDS,
): TierClassification {
  const score = scoreCard.overallScore;

  const tier =
    score >= thresholds.tierA ? 'A' :
    score >= thresholds.tierB ? 'B' :
    'C';

  const rationale = buildRationale(tier, scoreCard, thresholds);

  return { tier, rationale, thresholds };
}

/* ── Rationale builder ───────────────────────────────────────────────────── */

function buildRationale(
  tier: 'A' | 'B' | 'C',
  sc: ScoreCard,
  thresholds: TierThresholds,
): string {
  const {
    exactMatchScore: em,
    semanticSimilarityScore: sem,
    achievementScore: ach,
    ownershipScore: own,
    overallScore,
  } = sc;

  const scoreBreakdown =
    `Overall: ${round(overallScore)}/100 ` +
    `(Skills match: ${round(em.value)}, Semantic: ${round(sem.value)}, ` +
    `Achievements: ${round(ach.value)}, Ownership: ${round(own.value)})`;

  // Identify standout strengths and weaknesses
  const dimensions = [
    { name: 'skills match',   value: em.value  },
    { name: 'semantic fit',   value: sem.value  },
    { name: 'achievement',    value: ach.value  },
    { name: 'ownership',      value: own.value  },
  ];

  const strengths  = dimensions.filter((d) => d.value >= 70).map((d) => d.name);
  const weaknesses = dimensions.filter((d) => d.value < 40).map((d) => d.name);

  if (tier === 'A') {
    const strengthStr = strengths.length > 0
      ? ` Strong in: ${strengths.join(', ')}.`
      : '';
    return (
      `Tier A — Fast-track candidate. ${scoreBreakdown}.${strengthStr} ` +
      `Score exceeds the ${thresholds.tierA}-point threshold for immediate interview scheduling.`
    );
  }

  if (tier === 'B') {
    const weakStr = weaknesses.length > 0
      ? ` Areas to probe: ${weaknesses.join(', ')}.`
      : '';
    return (
      `Tier B — Technical screen recommended. ${scoreBreakdown}.${weakStr} ` +
      `Score is above the ${thresholds.tierB}-point baseline but below the fast-track threshold of ${thresholds.tierA}.`
    );
  }

  // Tier C
  const weakStr = weaknesses.length > 0
    ? ` Key gaps: ${weaknesses.join(', ')}.`
    : '';
  return (
    `Tier C — Requires recruiter review. ${scoreBreakdown}.${weakStr} ` +
    `Score did not reach the ${thresholds.tierB}-point threshold for automated screening advancement.`
  );
}
