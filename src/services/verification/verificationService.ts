import { ParsedResume, VerificationResult } from '../../domain';
import { verifyGitHubProfile } from './githubVerifier';
import { verifyLinkedInProfile } from './linkedinVerifier';
import { round, clamp } from '../../utils/math';
import { logger } from '../../utils/logger';

/**
 * Verification Service — orchestrates GitHub + LinkedIn verification
 * and aggregates the results into a single `VerificationResult`.
 *
 * Design principles:
 *  • Verification is non-blocking: if a sub-check fails, the overall
 *    result is still returned with partial data + flags.
 *  • GitHub and LinkedIn probes run in parallel (Promise.allSettled)
 *    so a slow/failed network call for one doesn't delay the other.
 *  • `overallConfidence` is a weighted average:
 *      GitHub (weight 0.7) — much more signal than LinkedIn
 *      LinkedIn (weight 0.3) — limited due to scraping restrictions
 *    When a profile URL is missing, that dimension contributes 0.
 */

export interface RunVerificationOptions {
  /** If true, neither GitHub nor LinkedIn checks are skipped */
  skipVerification?: boolean;
}

export async function runVerification(
  resume: ParsedResume,
  opts: RunVerificationOptions = {},
): Promise<VerificationResult> {
  if (opts.skipVerification) {
    logger.info('Verification skipped (skipVerification=true)', { candidateId: resume.id });
    return buildSkippedResult(resume.id);
  }

  logger.info('Starting verification', {
    candidateId: resume.id,
    hasGithub: !!resume.githubUrl,
    hasLinkedin: !!resume.linkedinUrl,
  });

  const claimedSkills = [
    ...resume.skills.technical,
    ...resume.experience.flatMap((e) => e.technologiesUsed),
    ...resume.projects.flatMap((p) => p.technologiesUsed),
  ];

  // Run both probes in parallel; never let one failure abort the other
  const [githubSettled, linkedinSettled] = await Promise.allSettled([
    resume.githubUrl
      ? verifyGitHubProfile(resume.githubUrl, claimedSkills)
      : Promise.resolve(null),
    resume.linkedinUrl
      ? verifyLinkedInProfile(resume.linkedinUrl)
      : Promise.resolve(null),
  ]);

  const github = githubSettled.status === 'fulfilled' ? githubSettled.value : null;
  const linkedin = linkedinSettled.status === 'fulfilled' ? linkedinSettled.value : null;

  if (githubSettled.status === 'rejected') {
    logger.error('GitHub verification threw unexpectedly', { err: githubSettled.reason });
  }
  if (linkedinSettled.status === 'rejected') {
    logger.error('LinkedIn verification threw unexpectedly', { err: linkedinSettled.reason });
  }

  // Compute weighted overall confidence
  const overallConfidence = computeOverallConfidence(
    github?.confidenceScore ?? null,
    linkedin?.confidenceScore ?? null,
  );

  const result: VerificationResult = {
    candidateId: resume.id,
    github,
    linkedin,
    overallConfidence,
    verifiedAt: new Date().toISOString(),
  };

  logger.info('Verification complete', {
    candidateId: resume.id,
    githubConfidence: github?.confidenceScore,
    linkedinConfidence: linkedin?.confidenceScore,
    overallConfidence,
  });

  return result;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/**
 * Weighted average of available sub-scores.
 * Missing checks (null) are excluded from the average rather than
 * counting as 0 — a candidate without a GitHub URL shouldn't be
 * penalised for not having one.
 */
function computeOverallConfidence(
  githubScore: number | null,
  linkedinScore: number | null,
): number {
  const WEIGHTS = { github: 0.7, linkedin: 0.3 };

  let weightedSum = 0;
  let totalWeight = 0;

  if (githubScore !== null) {
    weightedSum += githubScore * WEIGHTS.github;
    totalWeight += WEIGHTS.github;
  }

  if (linkedinScore !== null) {
    weightedSum += linkedinScore * WEIGHTS.linkedin;
    totalWeight += WEIGHTS.linkedin;
  }

  if (totalWeight === 0) return 0;

  return round(clamp(weightedSum / totalWeight));
}

function buildSkippedResult(candidateId: string): VerificationResult {
  return {
    candidateId,
    github: null,
    linkedin: null,
    overallConfidence: 0,
    verifiedAt: new Date().toISOString(),
  };
}
