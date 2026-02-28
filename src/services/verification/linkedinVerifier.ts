import axios from 'axios';
import { LinkedInVerification, VerificationFlag } from '../../domain';
import { logger } from '../../utils/logger';

const LINKEDIN_REQUEST_TIMEOUT_MS = 8_000;

/**
 * LinkedIn Verification — intentionally lightweight.
 *
 * LinkedIn actively blocks scraping and has no public API for profile data.
 * This module does the only thing that's reliably possible without violating
 * LinkedIn's ToS: an HTTP HEAD request to verify the URL resolves to a
 * real LinkedIn profile (vs. a 404 or redirect to the login wall for
 * non-existent profiles).
 *
 * What we check:
 *  1. URL is a valid linkedin.com/in/... URL
 *  2. The URL returns a non-404 HTTP status (200, 301, 302 are all positive)
 *  3. It does NOT redirect to /404 or /login (absent profile signals)
 *
 * Note: LinkedIn serves 999 status codes for bot UA strings. We use a
 * browser-like User-Agent and a short timeout to minimise false negatives.
 * Despite best efforts this check will occasionally produce false results.
 * Always treat it as advisory, not definitive.
 */
export async function verifyLinkedInProfile(
  rawUrl: string,
): Promise<LinkedInVerification> {
  const profileUrl = normaliseLinkedInUrl(rawUrl);

  if (!profileUrl) {
    return {
      profileUrl: rawUrl,
      profileExists: false,
      note: 'URL does not appear to be a valid LinkedIn profile URL (expected /in/username format).',
      confidenceScore: 0,
      flags: [{
        severity: 'warning',
        code: 'INVALID_LINKEDIN_URL',
        message: `"${rawUrl}" is not a recognisable LinkedIn profile URL.`,
      }],
    };
  }

  try {
    const response = await axios.head(profileUrl, {
      timeout: LINKEDIN_REQUEST_TIMEOUT_MS,
      maxRedirects: 5,
      validateStatus: () => true, // don't throw on any status
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    const effectiveUrl: string = (response.request as { res?: { responseUrl?: string } })?.res?.responseUrl ?? profileUrl;
    const status: number = response.status;

    logger.debug('LinkedIn probe result', { profileUrl, status, effectiveUrl });

    const isAbsent = isAbsentIndicator(status, effectiveUrl);

    if (isAbsent) {
      return {
        profileUrl,
        profileExists: false,
        note: `LinkedIn returned status ${status}. Profile may not exist or may be private.`,
        confidenceScore: 10,
        flags: [{
          severity: 'warning',
          code: 'LINKEDIN_PROFILE_NOT_ACCESSIBLE',
          message: `LinkedIn probe returned ${status}. Could not confirm profile exists.`,
        }],
      };
    }

    // Status 200/301/302 and not redirected to absence page = likely exists
    const flags: VerificationFlag[] = generateLinkedInFlags(status, effectiveUrl, profileUrl);
    const confidenceScore = flags.some((f) => f.severity !== 'info') ? 40 : 70;

    return {
      profileUrl,
      profileExists: true,
      note: 'LinkedIn URL resolves successfully. Deep profile data is not available without LinkedIn API access.',
      confidenceScore,
      flags,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.warn('LinkedIn probe failed', { profileUrl, message });

    return {
      profileUrl,
      profileExists: false,
      note: `LinkedIn probe failed: ${message}. This may be a network issue, not an absent profile.`,
      confidenceScore: 0,
      flags: [{
        severity: 'info',
        code: 'LINKEDIN_PROBE_FAILED',
        message: `Could not reach LinkedIn (${message}). Treat result as inconclusive.`,
      }],
    };
  }
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/**
 * Normalises a raw string to a full https://www.linkedin.com/in/... URL.
 * Returns null if it cannot be converted.
 */
function normaliseLinkedInUrl(raw: string): string | null {
  if (!raw?.trim()) return null;
  const cleaned = raw.trim();

  // Already a full URL
  const urlMatch = cleaned.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/i);
  if (urlMatch) {
    return `https://www.linkedin.com/in/${urlMatch[1]}`;
  }

  return null;
}

/**
 * Returns true if the HTTP response indicates the profile is absent.
 */
function isAbsentIndicator(status: number, effectiveUrl: string): boolean {
  if (status === 404) return true;
  // LinkedIn redirects non-existent profiles to /404 or loginwall
  if (effectiveUrl.includes('/404') || effectiveUrl.includes('/login')) return true;
  // Cloudflare / LinkedIn bot block
  if (status === 999 || status === 503 || status === 429) return false; // inconclusive, not absent
  return false;
}

/**
 * Generates advisory flags from the HTTP response.
 */
function generateLinkedInFlags(
  status: number,
  effectiveUrl: string,
  originalUrl: string,
): VerificationFlag[] {
  const flags: VerificationFlag[] = [];

  if (status === 999) {
    flags.push({
      severity: 'info',
      code: 'LINKEDIN_BOT_BLOCK',
      message: 'LinkedIn returned 999 (bot detection). Profile likely exists but cannot be confirmed programmatically.',
    });
  }

  if (effectiveUrl !== originalUrl && !effectiveUrl.includes('/404') && !effectiveUrl.includes('/login')) {
    flags.push({
      severity: 'info',
      code: 'LINKEDIN_URL_REDIRECTED',
      message: `URL redirected to ${effectiveUrl} — profile may have been renamed.`,
    });
  }

  return flags;
}
