/**
 * Result of verifying a candidate's public social / code profiles.
 *
 * Verification is intentionally lightweight and advisory — it surfaces
 * signals, not verdicts.  A low verification score should trigger follow-up
 * questions, not automatic rejection.
 */
export interface VerificationResult {
  candidateId: string;

  github: GitHubVerification | null;
  linkedin: LinkedInVerification | null;

  /**
   * Aggregate authenticity confidence: 0 (unverifiable) → 100 (strong signals).
   * Computed as a weighted average of available sub-scores.
   */
  overallConfidence: number;

  verifiedAt: string;
}

export interface GitHubVerification {
  username: string;
  profileUrl: string;

  /** Whether the profile actually exists */
  profileExists: boolean;

  accountAgeMonths: number | null;
  publicRepoCount: number | null;
  totalStars: number | null;
  totalForks: number | null;
  followerCount: number | null;

  /**
   * How recently the account showed activity.
   * "active" = commit/PR/issue in last 90 days
   * "moderate" = activity in last 12 months
   * "inactive" = nothing in 12+ months
   */
  activityLevel: 'active' | 'moderate' | 'inactive' | 'unknown';

  /**
   * Languages detected across public repos,
   * compared to the languages claimed on the resume.
   */
  detectedLanguages: string[];

  /**
   * Subset of claimed skills that appear in the GitHub profile
   * (repo languages, repo topics, README keywords).
   */
  corroboratedSkills: string[];

  /** 0–100 confidence that the GitHub profile belongs to this candidate */
  confidenceScore: number;

  flags: VerificationFlag[];
}

export interface LinkedInVerification {
  profileUrl: string;
  /** Whether the URL resolves to a real LinkedIn profile */
  profileExists: boolean;
  /**
   * LinkedIn blocks deep scraping, so we do limited checks only.
   * Future: integrate LinkedIn API or a compliant data provider.
   */
  note: string;
  confidenceScore: number;
  flags: VerificationFlag[];
}

export interface VerificationFlag {
  severity: 'info' | 'warning' | 'critical';
  code: string;
  message: string;
}
