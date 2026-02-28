import { ParsedResume, JobDescription, DimensionScore } from '../../domain';
import { normaliseSkill, clamp, round } from '../../utils/math';

/**
 * Exact Match Score — the simplest and most deterministic dimension.
 *
 * Algorithm:
 *   1. Collect all skills from the resume (skills block + technologiesUsed
 *      from every experience role + projects).
 *   2. Normalise both sets (lowercase, strip punctuation).
 *   3. Score = (matched mustHave skills) / (total mustHave skills) * 100
 *
 * Why only mustHave?  niceToHave skills feed into the semantic similarity
 * dimension with weighted contribution instead, avoiding double-counting.
 */
export function computeExactMatchScore(
  resume: ParsedResume,
  jd: JobDescription,
): DimensionScore {
  const mustHave = jd.requirements.mustHave;

  if (mustHave.length === 0) {
    return {
      value: 100,
      explanation: 'No required skills were specified in the job description.',
      evidence: [],
    };
  }

  // Build a normalised set of every skill the candidate has
  const candidateSkills = new Set<string>([
    ...resume.skills.technical,
    ...resume.skills.soft,
    ...resume.skills.other,
    ...resume.experience.flatMap((e) => e.technologiesUsed),
    ...resume.projects.flatMap((p) => p.technologiesUsed),
  ].map(normaliseSkill));

  const matched: string[] = [];
  const missing: string[] = [];

  for (const skill of mustHave) {
    const norm = normaliseSkill(skill);
    // Also try alias matching (e.g. "postgres" matches "postgresql")
    if (candidateSkills.has(norm) || hasAliasMatch(norm, candidateSkills)) {
      matched.push(skill);
    } else {
      missing.push(skill);
    }
  }

  const value = round(clamp((matched.length / mustHave.length) * 100));

  const explanation =
    matched.length === mustHave.length
      ? `Matched all ${mustHave.length} required skills.`
      : `Matched ${matched.length}/${mustHave.length} required skills. Missing: ${missing.join(', ')}.`;

  return {
    value,
    explanation,
    evidence: matched.map((s) => `✓ ${s}`),
  };
}

/**
 * Common technology aliases — when a JD says "Postgres" but the resume says
 * "PostgreSQL", or vice versa, they should match.
 */
const ALIASES: Record<string, string[]> = {
  postgresql:   ['postgres', 'pg'],
  javascript:   ['js'],
  typescript:   ['ts'],
  nodejs:       ['node', 'nodejs'],
  reactjs:      ['react'],
  vuejs:        ['vue'],
  kubernetes:   ['k8s'],
  elasticsearch: ['elastic', 'es'],
  mongodb:      ['mongo'],
  graphql:      ['gql'],
  amazonaws:    ['aws'],
  googlecloud:  ['gcp'],
  microsoftazure: ['azure'],
  rabbitmq:       ['rabbit'],
  'apache kafka': ['kafka'],
};

function hasAliasMatch(normSkill: string, candidateSkills: Set<string>): boolean {
  // Check if normSkill's aliases exist in candidate
  const aliases = ALIASES[normSkill] ?? [];
  if (aliases.some((a) => candidateSkills.has(a))) return true;

  // Check reverse: if normSkill is an alias for something the candidate has
  for (const [canonical, aliasList] of Object.entries(ALIASES)) {
    if (aliasList.includes(normSkill) && candidateSkills.has(canonical)) return true;
    if (aliasList.includes(normSkill) && aliasList.some((a) => candidateSkills.has(a))) return true;
  }

  return false;
}
