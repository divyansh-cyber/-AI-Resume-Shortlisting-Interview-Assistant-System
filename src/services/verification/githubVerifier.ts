import { Octokit } from '@octokit/rest';
import { config } from '../../config';
import { GitHubVerification, VerificationFlag } from '../../domain';
import { cacheGet, cacheSet, CacheKeys } from '../../db/redis';
import { logger } from '../../utils/logger';
import { clamp, round } from '../../utils/math';

let _octokit: Octokit | null = null;

function getOctokit(): Octokit {
  if (!_octokit) {
    _octokit = new Octokit({
      auth: config.github.token || undefined,
      userAgent: 'ai-resume-shortlisting/1.0',
    });
  }
  return _octokit;
}

/**
 * Extracts a GitHub username from a profile URL or raw string.
 * Handles:
 *   https://github.com/username
 *   http://github.com/username/
 *   github.com/username
 *   @username
 *   username
 */
export function extractGitHubUsername(raw: string): string | null {
  if (!raw || !raw.trim()) return null;
  const cleaned = raw.trim();

  // URL patterns
  const urlMatch = cleaned.match(/github\.com\/([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?)/i);
  if (urlMatch) return urlMatch[1].toLowerCase();

  // @handle or plain username
  const handleMatch = cleaned.match(/^@?([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?)$/);
  if (handleMatch) return handleMatch[1].toLowerCase();

  return null;
}

/**
 * Fetches and analyses a candidate's GitHub profile to produce a
 * `GitHubVerification` object.
 *
 * Data collected:
 *  • Account age, public repo count, total stars + forks, follower count
 *  • Activity level based on most recent push event
 *  • Languages detected across public repos (top 10 by occurrence)
 *  • Skills from the resume that are corroborated by the GitHub profile
 *  • Confidence score + flags
 *
 * Redis caching: full result cached for REDIS_CACHE_TTL seconds so
 * repeated evaluations for the same candidate don't hammer the API.
 *
 * Rate limits: unauthenticated = 60 req/hr, authenticated = 5000 req/hr.
 * Set GITHUB_TOKEN in .env to avoid hitting limits in production.
 */
export async function verifyGitHubProfile(
  rawGithubUrl: string,
  claimedSkills: string[],
): Promise<GitHubVerification> {
  const username = extractGitHubUsername(rawGithubUrl);

  if (!username) {
    return buildNotFoundResult(rawGithubUrl, 'Could not parse username from URL', claimedSkills);
  }

  // Check cache first
  const cacheKey = CacheKeys.githubProfile(username);
  const cached = await cacheGet<GitHubVerification>(cacheKey);
  if (cached) {
    logger.debug('GitHub verification cache hit', { username });
    return cached;
  }

  const octokit = getOctokit();

  try {
    // ── 1. Fetch user profile ────────────────────────────────────────────────
    const { data: user } = await octokit.users.getByUsername({ username });

    const accountCreatedAt = new Date(user.created_at);
    const accountAgeMonths = monthsBetween(accountCreatedAt, new Date());

    // ── 2. Fetch public repos (up to 100) ────────────────────────────────────
    const repos = await fetchAllRepos(username, octokit);

    const publicRepoCount = repos.length;
    const totalStars = repos.reduce((sum, r) => sum + (r.stargazers_count ?? 0), 0);
    const totalForks  = repos.reduce((sum, r) => sum + (r.forks_count ?? 0), 0);

    // ── 3. Detect languages ──────────────────────────────────────────────────
    const detectedLanguages = extractTopLanguages(repos, 10);

    // ── 4. Activity level ────────────────────────────────────────────────────
    const activityLevel = computeActivityLevel(repos);

    // ── 5. Corroborate claimed skills ────────────────────────────────────────
    const corroboratedSkills = corroborateSkills(claimedSkills, detectedLanguages, repos);

    // ── 6. Build flags ───────────────────────────────────────────────────────
    const flags = buildFlags(user, repos, accountAgeMonths, activityLevel, claimedSkills, corroboratedSkills);

    // ── 7. Confidence score ──────────────────────────────────────────────────
    const confidenceScore = computeConfidenceScore({
      profileExists: true,
      accountAgeMonths,
      publicRepoCount,
      totalStars,
      activityLevel,
      corroboratedCount: corroboratedSkills.length,
      claimedCount: claimedSkills.length,
      flags,
    });

    const result: GitHubVerification = {
      username,
      profileUrl: `https://github.com/${username}`,
      profileExists: true,
      accountAgeMonths,
      publicRepoCount,
      totalStars,
      totalForks,
      followerCount: user.followers,
      activityLevel,
      detectedLanguages,
      corroboratedSkills,
      confidenceScore,
      flags,
    };

    await cacheSet(cacheKey, result);

    logger.info('GitHub verification complete', {
      username,
      publicRepos: publicRepoCount,
      stars: totalStars,
      confidence: confidenceScore,
    });

    return result;
  } catch (err: unknown) {
    // 404 = profile doesn't exist
    if (isOctokitNotFound(err)) {
      logger.info('GitHub profile not found', { username });
      const result = buildNotFoundResult(rawGithubUrl, 'Profile does not exist on GitHub', claimedSkills, username);
      await cacheSet(cacheKey, result);
      return result;
    }

    // 403 = rate limited
    if (isOctokitRateLimit(err)) {
      logger.warn('GitHub API rate limit hit', { username });
      return buildErrorResult(rawGithubUrl, username, 'GitHub API rate limit reached — verification skipped');
    }

    logger.error('GitHub verification failed unexpectedly', { username, err });
    return buildErrorResult(rawGithubUrl, username, 'Unexpected error during GitHub verification');
  }
}

/* ── Repo fetching ───────────────────────────────────────────────────────── */

interface RepoBasic {
  name: string;
  language: string | null;
  stargazers_count?: number;
  forks_count?: number;
  topics?: string[];
  pushed_at: string | null;
  description: string | null;
  fork: boolean;
}

async function fetchAllRepos(username: string, octokit: Octokit): Promise<RepoBasic[]> {
  const repos: RepoBasic[] = [];
  let page = 1;

  // Fetch up to 3 pages (300 repos) to keep API cost low
  while (page <= 3) {
    const { data } = await octokit.repos.listForUser({
      username,
      per_page: 100,
      page,
      sort: 'updated',
      type: 'owner',
    });
    repos.push(...(data as RepoBasic[]));
    if (data.length < 100) break;
    page++;
  }

  return repos;
}

/* ── Language extraction ─────────────────────────────────────────────────── */

function extractTopLanguages(repos: RepoBasic[], topN: number): string[] {
  const langCount: Record<string, number> = {};

  for (const repo of repos) {
    if (repo.language) {
      langCount[repo.language] = (langCount[repo.language] ?? 0) + 1;
    }
    // Also count topics (e.g. "nodejs", "typescript")
    for (const topic of repo.topics ?? []) {
      langCount[topic] = (langCount[topic] ?? 0) + 0.5;
    }
  }

  return Object.entries(langCount)
    .sort(([, a], [, b]) => b - a)
    .slice(0, topN)
    .map(([lang]) => lang);
}

/* ── Activity level ──────────────────────────────────────────────────────── */

function computeActivityLevel(
  repos: RepoBasic[],
): GitHubVerification['activityLevel'] {
  if (repos.length === 0) return 'inactive';

  const now = new Date();
  const mostRecentPush = repos
    .map((r) => r.pushed_at ? new Date(r.pushed_at) : null)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  if (!mostRecentPush) return 'unknown';

  const monthsAgo = monthsBetween(mostRecentPush, now);
  if (monthsAgo <= 3)  return 'active';
  if (monthsAgo <= 12) return 'moderate';
  return 'inactive';
}

/* ── Skill corroboration ─────────────────────────────────────────────────── */

/**
 * Checks which of the candidate's claimed skills are corroborated
 * by the GitHub profile (languages, repo topics, README keywords via description).
 */
function corroborateSkills(
  claimed: string[],
  detectedLanguages: string[],
  repos: RepoBasic[],
): string[] {
  const profileText = [
    ...detectedLanguages,
    ...repos.flatMap((r) => r.topics ?? []),
    ...repos.map((r) => r.description ?? ''),
    ...repos.map((r) => r.name),
  ].join(' ').toLowerCase();

  return claimed.filter((skill) => {
    const norm = skill.toLowerCase().replace(/[^a-z0-9]/g, '');
    return profileText.includes(norm);
  });
}

/* ── Flags ───────────────────────────────────────────────────────────────── */

function buildFlags(
  user: { public_repos: number; created_at: string },
  repos: RepoBasic[],
  accountAgeMonths: number,
  activityLevel: GitHubVerification['activityLevel'],
  claimed: string[],
  corroborated: string[],
): VerificationFlag[] {
  const flags: VerificationFlag[] = [];

  if (accountAgeMonths < 3) {
    flags.push({
      severity: 'warning',
      code: 'ACCOUNT_TOO_NEW',
      message: `GitHub account is only ${accountAgeMonths} month(s) old — may have been created recently.`,
    });
  }

  if (user.public_repos === 0) {
    flags.push({
      severity: 'warning',
      code: 'NO_PUBLIC_REPOS',
      message: 'No public repositories found. Cannot verify technical claims from code.',
    });
  }

  if (activityLevel === 'inactive') {
    flags.push({
      severity: 'info',
      code: 'INACTIVE_ACCOUNT',
      message: 'No repository activity in the past 12 months.',
    });
  }

  const allForked = repos.length > 0 && repos.every((r) => r.fork);
  if (allForked) {
    flags.push({
      severity: 'warning',
      code: 'ALL_REPOS_FORKED',
      message: 'All public repositories are forks — no original code visible.',
    });
  }

  if (claimed.length > 0) {
    const corrobRate = corroborated.length / claimed.length;
    if (corrobRate < 0.2 && claimed.length >= 5) {
      flags.push({
        severity: 'warning',
        code: 'LOW_SKILL_CORROBORATION',
        message: `Only ${corroborated.length}/${claimed.length} claimed skills were found in the GitHub profile.`,
      });
    }
  }

  return flags;
}

/* ── Confidence score ────────────────────────────────────────────────────── */

interface ConfidenceParams {
  profileExists: boolean;
  accountAgeMonths: number;
  publicRepoCount: number;
  totalStars: number;
  activityLevel: GitHubVerification['activityLevel'];
  corroboratedCount: number;
  claimedCount: number;
  flags: VerificationFlag[];
}

function computeConfidenceScore(p: ConfidenceParams): number {
  let score = 0;

  // Base: profile exists (40 pts)
  if (!p.profileExists) return 0;
  score += 40;

  // Account age (up to 15 pts)
  score += Math.min(15, p.accountAgeMonths / 12 * 10);

  // Public repos (up to 15 pts)
  score += Math.min(15, (p.publicRepoCount / 20) * 15);

  // Stars signal real usage (up to 10 pts)
  score += Math.min(10, Math.log10(p.totalStars + 1) * 5);

  // Activity level (up to 15 pts)
  const activityPts: Record<string, number> = { active: 15, moderate: 10, inactive: 3, unknown: 0 };
  score += activityPts[p.activityLevel] ?? 0;

  // Skill corroboration (up to 15 pts)
  if (p.claimedCount > 0) {
    score += (p.corroboratedCount / p.claimedCount) * 15;
  }

  // Deduct for critical/warnings
  const criticalFlags  = p.flags.filter((f) => f.severity === 'critical').length;
  const warningFlags   = p.flags.filter((f) => f.severity === 'warning').length;
  score -= criticalFlags * 15 + warningFlags * 5;

  return round(clamp(score));
}

/* ── Utility helpers ─────────────────────────────────────────────────────── */

function monthsBetween(from: Date, to: Date): number {
  return Math.floor(
    (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24 * 30),
  );
}

function buildNotFoundResult(
  rawUrl: string,
  flagMessage: string,
  _claimedSkills: string[],
  username?: string,
): GitHubVerification {
  return {
    username: username ?? rawUrl,
    profileUrl: rawUrl,
    profileExists: false,
    accountAgeMonths: null,
    publicRepoCount: null,
    totalStars: null,
    totalForks: null,
    followerCount: null,
    activityLevel: 'unknown',
    detectedLanguages: [],
    corroboratedSkills: [],
    confidenceScore: 0,
    flags: [{
      severity: 'critical',
      code: 'PROFILE_NOT_FOUND',
      message: flagMessage,
    }],
  };
}

function buildErrorResult(
  rawUrl: string,
  username: string,
  message: string,
): GitHubVerification {
  return {
    username,
    profileUrl: rawUrl,
    profileExists: false,
    accountAgeMonths: null,
    publicRepoCount: null,
    totalStars: null,
    totalForks: null,
    followerCount: null,
    activityLevel: 'unknown',
    detectedLanguages: [],
    corroboratedSkills: [],
    confidenceScore: 0,
    flags: [{
      severity: 'warning',
      code: 'VERIFICATION_ERROR',
      message,
    }],
  };
}

function isOctokitNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    (err as { status: number }).status === 404
  );
}

function isOctokitRateLimit(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    (err as { status: number }).status === 403
  );
}
