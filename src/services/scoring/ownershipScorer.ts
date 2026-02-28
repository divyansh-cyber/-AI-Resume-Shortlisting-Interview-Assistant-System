import { ParsedResume, JobDescription, DimensionScore } from '../../domain';
import { clamp, round } from '../../utils/math';

/**
 * Ownership Score — distinguishes candidates who *led* work from those
 * who contributed as part of a team.
 *
 * This matters most for senior / lead roles where the JD's contextualPhrases
 * include things like "own features end-to-end" or "lead architecture decisions".
 *
 * Signal sources (additive):
 *  1. ownershipSignals already extracted by the resume parser from projects
 *  2. Leadership keywords in work experience descriptions
 *  3. Solo / founding signals ("built from scratch", "founded", "sole engineer")
 *  4. Seniority signals ("principal", "staff", "lead", "architect" in title)
 *  5. JD contextual phrase matches — if the JD specifically asks for ownership
 *     language and the candidate has it, boost the score
 *
 * The score is designed to be generous for genuine signals and punishing for
 * resumes with zero ownership language (score floor ≈ 5).
 */
export function computeOwnershipScore(
  resume: ParsedResume,
  jd: JobDescription,
): DimensionScore {
  const signals: string[] = [];
  let rawScore = 0;

  // 1. Project ownership signals (these were extracted verbatim by the parser)
  for (const project of resume.projects) {
    for (const signal of project.ownershipSignals) {
      signals.push(`[Project: ${project.name}] "${signal}"`);
      rawScore += 8;
    }
  }

  // 2. Leadership keywords in experience descriptions
  for (const exp of resume.experience) {
    const expSignals = findOwnershipSignals(exp.description, exp.company);
    signals.push(...expSignals.labels);
    rawScore += expSignals.score;

    // 3. Seniority in title
    const titleBonus = computeTitleBonus(exp.title);
    if (titleBonus > 0) {
      rawScore += titleBonus;
      signals.push(`[${exp.company}] Senior/Lead title: "${exp.title}"`);
    }
  }

  // 4. JD contextual phrase alignment — measures if the candidate's language
  //    actually matches what the JD is looking for
  const jdAlignmentBonus = computeJdAlignment(resume, jd);
  if (jdAlignmentBonus > 0) {
    rawScore += jdAlignmentBonus;
    signals.push(
      `Ownership language aligns with ${jdAlignmentBonus > 10 ? 'multiple' : 'some'} JD contextual phrases`,
    );
  }

  const value = round(clamp(normalise(rawScore)));

  const explanation = buildExplanation(value, signals, jd.requirements.contextualPhrases);

  return {
    value,
    explanation,
    evidence: signals.slice(0, 8),
  };
}

/* ── Signal tables ───────────────────────────────────────────────────────── */

const SOLO_SIGNALS = [
  'built from scratch', 'sole developer', 'sole engineer', 'founded',
  'single-handedly', 'independently built', 'independently developed',
  'solo project', 'created from scratch', '0 to 1',
];

const LEADERSHIP_SIGNALS = [
  { pattern: /\barchitect(ed|ing)?\b/i,             label: 'architected',        pts: 8 },
  { pattern: /\bled\s+(a\s+)?(team|project|effort)/i, label: 'led team/project', pts: 10 },
  { pattern: /\bmanaged\s+(a\s+)?(team|squad)\b/i,  label: 'managed team',       pts: 8 },
  { pattern: /\bowned\s+\w/i,                        label: 'owned [X]',          pts: 7 },
  { pattern: /\bdrove\b/i,                           label: 'drove [X]',          pts: 5 },
  { pattern: /\bspearheaded\b/i,                     label: 'spearheaded',        pts: 7 },
  { pattern: /\bpioneered\b/i,                       label: 'pioneered',          pts: 7 },
  { pattern: /\bdesigned\s+(the\s+)?arch/i,          label: 'designed architecture', pts: 9 },
  { pattern: /\bdefined\s+(the\s+)?(strategy|roadmap|direction)/i, label: 'defined strategy/roadmap', pts: 8 },
  { pattern: /\bmentored\b/i,                        label: 'mentored engineers', pts: 5 },
  { pattern: /\bestablished\b/i,                     label: 'established [X]',    pts: 4 },
  { pattern: /\bresponsible for\b/i,                 label: 'responsible for [X]',pts: 3 },
];

function findOwnershipSignals(
  text: string,
  company: string,
): { labels: string[]; score: number } {
  const labels: string[] = [];
  let score = 0;
  const lower = text.toLowerCase();

  // Solo / founding signals (high weight)
  for (const signal of SOLO_SIGNALS) {
    if (lower.includes(signal)) {
      labels.push(`[${company}] "${signal}"`);
      score += 12;
    }
  }

  // Leadership patterns
  for (const { pattern, label, pts } of LEADERSHIP_SIGNALS) {
    if (pattern.test(text)) {
      labels.push(`[${company}] ${label}`);
      score += pts;
    }
  }

  return { labels, score };
}

const SENIOR_TITLES = [
  'principal', 'staff', 'senior', 'lead', 'architect', 'head of',
  'director', 'vp ', 'chief', 'cto', 'founder', 'co-founder',
];

function computeTitleBonus(title: string): number {
  const lower = title.toLowerCase();
  let bonus = 0;
  for (const t of SENIOR_TITLES) {
    if (lower.includes(t)) bonus += 5;
  }
  return Math.min(bonus, 15); // cap at 15 pts from title
}

function computeJdAlignment(resume: ParsedResume, jd: JobDescription): number {
  if (jd.requirements.contextualPhrases.length === 0) return 0;

  // Combine all resume text that could contain ownership language
  const resumeText = [
    resume.summary ?? '',
    ...resume.experience.map((e) => e.description),
    ...resume.projects.map((p) => p.description + ' ' + p.ownershipSignals.join(' ')),
  ].join(' ').toLowerCase();

  let matched = 0;
  for (const phrase of jd.requirements.contextualPhrases) {
    const words = phrase.toLowerCase().split(/\s+/);
    // Require at least half the words in the phrase to appear in the resume text
    const wordMatches = words.filter((w) => w.length > 3 && resumeText.includes(w));
    if (wordMatches.length >= Math.ceil(words.length / 2)) matched++;
  }

  return (matched / jd.requirements.contextualPhrases.length) * 15; // up to 15 pts bonus
}

function normalise(raw: number): number {
  // Piecewise linear: 0→5, 30→50, 60→80, 100→100
  if (raw <= 0)  return 5;
  if (raw <= 30) return 5 + (raw / 30) * 45;
  if (raw <= 60) return 50 + ((raw - 30) / 30) * 30;
  return Math.min(100, 80 + ((raw - 60) / 40) * 20);
}

function buildExplanation(
  score: number,
  signals: string[],
  contextualPhrases: string[],
): string {
  if (signals.length === 0) {
    return `No ownership or leadership signals detected. Resume appears to describe tasks rather than impact or ownership. ${contextualPhrases.length > 0 ? 'The JD explicitly asks for ownership ("' + contextualPhrases[0] + '") — probe this in interview.' : ''}`;
  }

  const tier =
    score >= 80 ? 'Strong ownership profile' :
    score >= 60 ? 'Good ownership signals' :
    score >= 40 ? 'Some ownership evidence' :
    'Weak ownership signals';

  return `${tier} (score: ${score}/100). Found ${signals.length} leadership/ownership indicator(s). ${score < 60 && contextualPhrases.length > 0 ? 'JD requires senior ownership — recommend probing with behavioral questions.' : ''}`;
}
