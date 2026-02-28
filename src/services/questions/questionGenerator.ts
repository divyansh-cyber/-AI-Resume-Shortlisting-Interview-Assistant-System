import { v4 as uuidv4 } from 'uuid';
import {
  ParsedResume,
  JobDescription,
  ScoreCard,
  TierClassification,
  VerificationResult,
  InterviewQuestion,
} from '../../domain';
import { chatCompletion } from '../parser/geminiClient';
import { logger } from '../../utils/logger';
import { ValidationError } from '../../utils/errors';

/** Full output of the question generation step. */
export interface GeneratedContent {
  interviewQuestions: InterviewQuestion[];
  executiveSummary: string;
}

const SYSTEM_PROMPT = `You are an expert technical recruiter and interview designer. Given a candidate's resume analysis, job description, and scoring breakdown, your job is to:

1. Write a concise executive summary for the recruiter (3-5 sentences).
2. Generate targeted interview questions that maximise signal for THIS specific candidate and role.

Question design rules:
- "gap" questions: probe skills in the JD that the candidate is missing or has low evidence of. These are the most valuable questions.
- "technical" questions: verify claimed skills with a concrete scenario or problem.
- "achievement" questions: ask for quantifiable details behind any achievement bullet.
- "ownership" questions: distinguish leading from contributing (especially for senior roles).
- "behavioral" questions: past behaviour predicts future behaviour — use STAR format prompts.
- Never ask generic questions like "Tell me about yourself" or "What are your strengths?".
- Tailor every question to specific evidence (or gaps) from THIS resume.
- followUps should be 2-3 short probing questions that dig deeper.

Return ONLY a valid JSON object with this exact schema — no markdown, no preamble:
{
  "executiveSummary": string,
  "questions": [
    {
      "dimension": "technical" | "behavioral" | "ownership" | "achievement" | "gap",
      "question": string,
      "rationale": string,
      "followUps": string[],
      "difficulty": "easy" | "medium" | "hard"
    }
  ]
}`;

/**
 * Calls Gemini to generate targeted interview questions and an executive
 * summary for the given candidate ↔ job evaluation.
 *
 * The prompt is carefully constructed to include:
 *  • Job role + must-have / nice-to-have requirements
 *  • Candidate skill inventory and experience highlights
 *  • All four dimension scores with their explanations (so the model knows
 *    exactly where the gaps and strengths are)
 *  • Tier + tier rationale
 *  • Any verification flags (e.g. unconfirmed GitHub profile)
 *
 * Number of questions scales with tier:
 *   Tier A → 8 questions (full interview prep)
 *   Tier B → 6 questions (targeted screen)
 *   Tier C → 5 questions (focused gap probe)
 */
export async function generateQuestionsAndSummary(
  resume: ParsedResume,
  jd: JobDescription,
  scoreCard: ScoreCard,
  tier: TierClassification,
  verification: VerificationResult | null,
): Promise<GeneratedContent> {
  const questionCount = 5;

  const userPrompt = buildPrompt(resume, jd, scoreCard, tier, verification, questionCount);

  logger.info('Generating interview questions', {
    candidateId: resume.id,
    jobId: jd.id,
    tier: tier.tier,
    questionCount,
  });

  const responseText = await chatCompletion(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    { temperature: 0.4, maxTokens: 2048 },
  );

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    logger.error('Gemini returned invalid JSON for question generation', {
      preview: responseText.slice(0, 200),
    });
    throw new ValidationError('LLM returned malformed JSON during question generation');
  }

  return normaliseGeneratedContent(parsed);
}

/* ── Prompt builder ──────────────────────────────────────────────────────── */

function buildPrompt(
  resume: ParsedResume,
  jd: JobDescription,
  sc: ScoreCard,
  tier: TierClassification,
  verification: VerificationResult | null,
  questionCount: number,
): string {
  const sections: string[] = [];

  // ── Role context ────────────────────────────────────────────────────────
  sections.push(`## Job: ${jd.title}${jd.company ? ` at ${jd.company}` : ''}
Must-have skills: ${jd.requirements.mustHave.join(', ') || 'none specified'}
Nice-to-have skills: ${jd.requirements.niceToHave.join(', ') || 'none specified'}
Min experience: ${jd.minExperienceYears != null ? `${jd.minExperienceYears} years` : 'not specified'}
Context: ${jd.requirements.contextualPhrases.join('; ') || 'none'}`);

  // ── Candidate snapshot ──────────────────────────────────────────────────
  const expSummary = resume.experience
    .slice(0, 4)
    .map((e) => `  • ${e.title} @ ${e.company} (${e.startDate ?? '?'} – ${e.endDate ?? 'Present'}): ${e.description.slice(0, 150)}`)
    .join('\n');

  const skills = [
    ...resume.skills.technical,
    ...resume.skills.soft,
  ].slice(0, 20).join(', ');

  const achievements = resume.experience
    .flatMap((e) => e.achievements)
    .slice(0, 5)
    .map((a) => `  • ${a}`)
    .join('\n');

  sections.push(`## Candidate: ${resume.candidateName ?? 'Unknown'}
Technical skills: ${skills || 'none listed'}

Recent experience:
${expSummary || '  (none)'}

${achievements ? `Key achievements:\n${achievements}` : 'No quantifiable achievements extracted.'}`);

  // ── Scoring breakdown ───────────────────────────────────────────────────
  sections.push(`## Scoring breakdown (Tier ${tier.tier}, overall ${sc.overallScore}/100)
- Exact skill match:     ${sc.exactMatchScore.value}/100 — ${sc.exactMatchScore.explanation}
- Semantic similarity:   ${sc.semanticSimilarityScore.value}/100 — ${sc.semanticSimilarityScore.explanation}
- Achievement evidence:  ${sc.achievementScore.value}/100 — ${sc.achievementScore.explanation}
- Ownership signals:     ${sc.ownershipScore.value}/100 — ${sc.ownershipScore.explanation}

Tier rationale: ${tier.rationale}`);

  // ── Verification signals ────────────────────────────────────────────────
  if (verification) {
    const ghFlags = verification.github?.flags ?? [];
    const flagStr = ghFlags.length > 0
      ? ghFlags.map((f) => `[${f.severity.toUpperCase()}] ${f.message}`).join('; ')
      : 'none';
    const corroborated = verification.github?.corroboratedSkills ?? [];

    sections.push(`## Verification signals
GitHub confidence: ${verification.github?.confidenceScore ?? 'N/A'}/100
Corroborated skills: ${corroborated.join(', ') || 'none'}
Flags: ${flagStr}`);
  }

  // ── Instruction ─────────────────────────────────────────────────────────
  sections.push(`## Task
Generate exactly ${questionCount} interview questions for this candidate.
Prioritise "gap" questions for missing must-have skills.
Include at least one "achievement" and one "ownership" question unless the role doesn't require them.
Make every question specific — reference actual technologies, companies, or achievements from THIS resume.`);

  return sections.join('\n\n');
}

/* ── Response normaliser ─────────────────────────────────────────────────── */

function normaliseGeneratedContent(raw: Record<string, unknown>): GeneratedContent {
  const executiveSummary =
    typeof raw.executiveSummary === 'string' && raw.executiveSummary.trim()
      ? raw.executiveSummary.trim()
      : 'No executive summary was generated.';

  const questionsRaw = Array.isArray(raw.questions) ? raw.questions : [];

  const VALID_DIMENSIONS = new Set(['technical', 'behavioral', 'ownership', 'achievement', 'gap']);
  const VALID_DIFFICULTIES = new Set(['easy', 'medium', 'hard']);

  const interviewQuestions: InterviewQuestion[] = questionsRaw
    .filter((q): q is Record<string, unknown> => typeof q === 'object' && q !== null)
    .map((q) => ({
      id: uuidv4(),
      dimension: VALID_DIMENSIONS.has(q.dimension as string)
        ? (q.dimension as InterviewQuestion['dimension'])
        : 'technical',
      question: typeof q.question === 'string' ? q.question.trim() : 'Question not available.',
      rationale: typeof q.rationale === 'string' ? q.rationale.trim() : '',
      followUps: Array.isArray(q.followUps)
        ? (q.followUps as unknown[]).filter((f): f is string => typeof f === 'string').map((f) => f.trim())
        : [],
      difficulty: VALID_DIFFICULTIES.has(q.difficulty as string)
        ? (q.difficulty as InterviewQuestion['difficulty'])
        : 'medium',
    }));

  return { interviewQuestions, executiveSummary };
}
