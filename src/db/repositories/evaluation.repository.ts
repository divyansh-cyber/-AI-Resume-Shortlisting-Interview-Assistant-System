import { v4 as uuidv4 } from 'uuid';
import { query } from '../postgres';
import { EvaluationResult, EvaluationStatus, ScoreCard, TierClassification,
         VerificationResult, InterviewQuestion } from '../../domain';
import { NotFoundError } from '../../utils/errors';

/* ── Row shape ──────────────────────────────────────────────────────────── */
interface EvaluationRow {
  id: string;
  candidate_id: string;
  resume_id: string;
  job_id: string;
  status: EvaluationStatus;
  score_card: ScoreCard | null;
  overall_score: string | null;
  tier: string | null;
  tier_rationale: string | null;
  interview_questions: InterviewQuestion[];
  verification_result: VerificationResult | null;
  executive_summary: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

function rowToEvaluation(row: EvaluationRow): EvaluationResult {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    jobId: row.job_id,
    scoreCard: row.score_card!,
    tierClassification: {
      tier: (row.tier as 'A' | 'B' | 'C') ?? 'C',
      rationale: row.tier_rationale ?? '',
      thresholds: { tierA: 75, tierB: 50 },
    },
    verificationResult: row.verification_result,
    interviewQuestions: row.interview_questions ?? [],
    executiveSummary: row.executive_summary ?? '',
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/* ── Repository ─────────────────────────────────────────────────────────── */
export const evaluationRepository = {
  /** Create a new evaluation record in "pending" state. */
  async create(data: {
    candidateId: string;
    resumeId: string;
    jobId: string;
  }): Promise<EvaluationResult> {
    const id = uuidv4();
    const result = await query<EvaluationRow>(
      `INSERT INTO evaluations (id, candidate_id, resume_id, job_id, status)
       VALUES ($1,$2,$3,$4,'pending')
       RETURNING *`,
      [id, data.candidateId, data.resumeId, data.jobId],
    );
    return rowToEvaluation(result.rows[0]);
  },

  async findById(id: string): Promise<EvaluationResult> {
    const result = await query<EvaluationRow>(
      'SELECT * FROM evaluations WHERE id = $1',
      [id],
    );
    if (result.rows.length === 0) throw new NotFoundError('Evaluation', id);
    return rowToEvaluation(result.rows[0]);
  },

  async findByJob(
    jobId: string,
    opts: { limit?: number; offset?: number; tier?: string } = {},
  ): Promise<EvaluationResult[]> {
    const { limit = 50, offset = 0, tier } = opts;
    const result = tier
      ? await query<EvaluationRow>(
          `SELECT * FROM evaluations
           WHERE job_id = $1 AND status = 'completed' AND tier = $2
           ORDER BY overall_score DESC LIMIT $3 OFFSET $4`,
          [jobId, tier, limit, offset],
        )
      : await query<EvaluationRow>(
          `SELECT * FROM evaluations
           WHERE job_id = $1 AND status = 'completed'
           ORDER BY overall_score DESC LIMIT $2 OFFSET $3`,
          [jobId, limit, offset],
        );
    return result.rows.map(rowToEvaluation);
  },

  /** Update the status (and optionally an error message). */
  async updateStatus(
    id: string,
    status: EvaluationStatus,
    errorMessage?: string,
  ): Promise<void> {
    await query(
      `UPDATE evaluations SET status = $1, error_message = $2 WHERE id = $3`,
      [status, errorMessage ?? null, id],
    );
  },

  /** Persist the completed scoring results. */
  async updateScoring(
    id: string,
    scoreCard: ScoreCard,
    tier: TierClassification,
  ): Promise<void> {
    await query(
      `UPDATE evaluations
       SET score_card = $1, overall_score = $2, tier = $3, tier_rationale = $4,
           status = 'scoring'
       WHERE id = $5`,
      [JSON.stringify(scoreCard), scoreCard.overallScore, tier.tier, tier.rationale, id],
    );
  },

  /** Persist verification results. */
  async updateVerification(id: string, result: VerificationResult): Promise<void> {
    await query(
      `UPDATE evaluations SET verification_result = $1, status = 'verifying' WHERE id = $2`,
      [JSON.stringify(result), id],
    );
  },

  /** Persist interview questions + executive summary and mark completed. */
  async updateQuestionsAndComplete(
    id: string,
    questions: InterviewQuestion[],
    executiveSummary: string,
  ): Promise<void> {
    await query(
      `UPDATE evaluations
       SET interview_questions = $1, executive_summary = $2, status = 'completed'
       WHERE id = $3`,
      [JSON.stringify(questions), executiveSummary, id],
    );
  },

  async countByJob(jobId: string): Promise<Record<'A' | 'B' | 'C' | 'total', number>> {
    const result = await query<{ tier: string | null; count: string }>(
      `SELECT tier, COUNT(*) as count
       FROM evaluations
       WHERE job_id = $1 AND status = 'completed'
       GROUP BY tier`,
      [jobId],
    );

    const counts = { A: 0, B: 0, C: 0, total: 0 };
    for (const row of result.rows) {
      const n = parseInt(row.count, 10);
      if (row.tier === 'A') counts.A = n;
      else if (row.tier === 'B') counts.B = n;
      else if (row.tier === 'C') counts.C = n;
      counts.total += n;
    }
    return counts;
  },
};
