/**
 * The four-dimensional score produced by the Scoring Engine for one
 * candidate ↔ job pair.
 *
 * All score values are in the range [0, 100].
 *
 * Design note: keeping scores and explanations together means consumers
 * never get a number without context — enforces explainability at the type level.
 */
export interface ScoreCard {
  candidateId: string;
  jobId: string;

  /**
   * Percentage of JD "must-have" skills that appear verbatim (after
   * normalisation) in the candidate's skills / experience.
   *
   * Formula: (matched_required_skills / total_required_skills) * 100
   */
  exactMatchScore: DimensionScore;

  /**
   * Semantic closeness of candidate skills to JD requirements, capturing
   * conceptual equivalents (e.g. AWS Kinesis → Kafka, RabbitMQ → SQS).
   *
   * Driven by cosine similarity on OpenAI embeddings.
   */
  semanticSimilarityScore: DimensionScore;

  /**
   * Measures quantifiable impact: numbers, percentages, revenue figures,
   * and strong action verbs in the candidate's experience bullets.
   */
  achievementScore: DimensionScore;

  /**
   * Signals whether the candidate has *led* work vs. contributed as part of
   * a team.  Anchored on ownership language: "architected", "led", "drove",
   * "founded", "built from scratch", etc.
   */
  ownershipScore: DimensionScore;

  /**
   * Weighted composite:
   *   exactMatch * 0.35 + semanticSimilarity * 0.30 + achievement * 0.20 + ownership * 0.15
   */
  overallScore: number;

  /** ISO-8601 */
  evaluatedAt: string;
}

export interface DimensionScore {
  /** 0 – 100 */
  value: number;
  /**
   * Human-readable "why" for this dimension.
   * e.g. "Matched 7/10 required skills. Missing: Kubernetes, Terraform."
   */
  explanation: string;
  /** Supporting evidence pulled from the resume */
  evidence: string[];
}

/**
 * Weights used when computing overallScore.
 * Exported so they can be overridden in tests or future config.
 */
export const SCORE_WEIGHTS = {
  exactMatch: 0.35,
  semanticSimilarity: 0.30,
  achievement: 0.20,
  ownership: 0.15,
} as const;
