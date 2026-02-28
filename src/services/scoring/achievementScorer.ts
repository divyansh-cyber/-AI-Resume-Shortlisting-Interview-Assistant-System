import { ParsedResume, DimensionScore } from '../../domain';
import { clamp, round, countQuantifiableAchievements } from '../../utils/math';

/**
 * Achievement Score — measures quantifiable impact.
 *
 * Strong candidates don't just list responsibilities; they articulate
 * *outcomes*.  This scorer rewards evidence of measurable impact.
 *
 * Signals tracked (each adds to a raw score):
 *  • Quantifiable achievements already extracted by the resume parser
 *  • Numbers + % patterns in experience descriptions
 *  • Strong action verbs (designed, launched, reduced, saved, etc.)
 *  • Named external outcomes (awards, patents, publications, open-source)
 *
 * Normalisation: raw signal count is mapped onto [0, 100] using a sigmoid-
 * like curve so the score doesn't just reward verbosity.
 * A résumé with 10+ strong signals scores ~90; one with 0 scores ~5.
 */
export function computeAchievementScore(resume: ParsedResume): DimensionScore {
  const signals: string[] = [];
  let rawScore = 0;

  // 1. Pre-extracted achievements from parser
  for (const exp of resume.experience) {
    for (const achievement of exp.achievements) {
      signals.push(`[${exp.company}] ${achievement}`);
      rawScore += 10; // each explicit achievement bullet is high-value
    }

    // 2. Scan description for quantifiable patterns
    const quantCount = countQuantifiableAchievements(exp.description);
    rawScore += quantCount * 5;
    if (quantCount > 0) {
      signals.push(
        `${quantCount} quantifiable metric(s) found in ${exp.company} (${exp.title}) description`,
      );
    }

    // 3. Strong action verbs in description
    const verbMatches = findActionVerbs(exp.description);
    if (verbMatches.length > 0) {
      rawScore += verbMatches.length * 2;
      signals.push(`Action verbs at ${exp.company}: ${verbMatches.join(', ')}`);
    }
  }

  // 4. Project achievements
  for (const project of resume.projects) {
    const quantCount = countQuantifiableAchievements(project.description);
    if (quantCount > 0) {
      rawScore += quantCount * 4;
      signals.push(`${quantCount} metric(s) in project "${project.name}"`);
    }
  }

  // 5. Certifications add modest signal
  rawScore += resume.certifications.length * 3;

  // Map raw score onto [0, 100] — 100 raw pts → ~95 scaled
  const value = round(clamp(normaliseSigmoid(rawScore)));

  const explanation = buildExplanation(value, resume.experience.length, signals);

  return {
    value,
    explanation,
    evidence: signals.slice(0, 8), // top 8 for readability in the UI
  };
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

const STRONG_ACTION_VERBS = [
  'launched', 'shipped', 'reduced', 'increased', 'improved', 'saved',
  'generated', 'grew', 'built', 'designed', 'architected', 'automated',
  'migrated', 'optimised', 'optimized', 'deployed', 'delivered', 'led',
  'founded', 'created', 'developed', 'implemented', 'established',
  'transformed', 'restructured', 'pioneered', 'spearheaded', 'drove',
];

function findActionVerbs(text: string): string[] {
  const lower = text.toLowerCase();
  return STRONG_ACTION_VERBS.filter((v) => lower.includes(v));
}

/**
 * Sigmoid-inspired normalisation.
 * rawScore of 0  → ~5
 * rawScore of 50 → ~65
 * rawScore of 100 → ~93
 */
function normaliseSigmoid(raw: number): number {
  // Logistic: 100 / (1 + e^(-0.05 * (x - 40)))
  return 100 / (1 + Math.exp(-0.05 * (raw - 40)));
}

function buildExplanation(
  score: number,
  roleCount: number,
  signals: string[],
): string {
  if (signals.length === 0) {
    return `No quantifiable achievements or strong action verbs were found across ${roleCount} role(s). Descriptions appear responsibility-focused rather than impact-focused.`;
  }
  const tier =
    score >= 80 ? 'Strong' :
    score >= 60 ? 'Good' :
    score >= 40 ? 'Moderate' :
    'Limited';

  return `${tier} evidence of measurable impact across ${roleCount} role(s). Found ${signals.length} achievement signal(s). ${score >= 70 ? 'Candidate demonstrates clear outcome-oriented thinking.' : 'Consider probing for specific metrics in the interview.'}`;
}
