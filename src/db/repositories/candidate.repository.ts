import { v4 as uuidv4 } from 'uuid';
import { PoolClient } from 'pg';
import { query, withTransaction } from '../postgres';
import { ParsedResume } from '../../domain';
import { NotFoundError } from '../../utils/errors';

/* ── Row shapes ─────────────────────────────────────────────────────────── */
interface CandidateRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
  created_at: string;
  updated_at: string;
}

interface ResumeRow {
  id: string;
  candidate_id: string;
  parsed_data: Omit<ParsedResume, 'id' | 'rawText' | 'parsedAt'>;
  raw_text: string;
  original_filename: string | null;
  parsed_at: string;
  created_at: string;
  updated_at: string;
}

export interface CandidateRecord {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  createdAt: string;
}

function rowToCandidate(row: CandidateRow): CandidateRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    location: row.location,
    linkedinUrl: row.linkedin_url,
    githubUrl: row.github_url,
    portfolioUrl: row.portfolio_url,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function rowToResume(row: ResumeRow): ParsedResume {
  return {
    id: row.id,
    ...(row.parsed_data as Omit<ParsedResume, 'id' | 'rawText' | 'parsedAt'>),
    rawText: row.raw_text,
    parsedAt: new Date(row.parsed_at).toISOString(),
  };
}

/* ── Repository ─────────────────────────────────────────────────────────── */
export const candidateRepository = {
  /**
   * Upsert candidate by email (if present) or always insert.
   * Returns the candidate id.
   */
  async upsert(data: ParsedResume): Promise<string> {
    if (data.email) {
      const existing = await query<{ id: string }>(
        'SELECT id FROM candidates WHERE email = $1',
        [data.email],
      );
      if (existing.rows.length > 0) return existing.rows[0].id;
    }

    const id = uuidv4();
    await query(
      `INSERT INTO candidates (id, name, email, phone, location, linkedin_url, github_url, portfolio_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, data.candidateName, data.email, data.phone, data.location,
       data.linkedinUrl, data.githubUrl, data.portfolioUrl],
    );
    return id;
  },

  async findById(id: string): Promise<CandidateRecord> {
    const result = await query<CandidateRow>('SELECT * FROM candidates WHERE id = $1', [id]);
    if (result.rows.length === 0) throw new NotFoundError('Candidate', id);
    return rowToCandidate(result.rows[0]);
  },
};

export const resumeRepository = {
  /**
   * Creates candidate + resume in a single transaction.
   * Returns both ids.
   */
  async create(
    parsed: ParsedResume,
    originalFilename?: string,
  ): Promise<{ candidateId: string; resumeId: string }> {
    return withTransaction(async (client: PoolClient) => {
      // Upsert candidate
      let candidateId: string;
      if (parsed.email) {
        const existing = await client.query<{ id: string }>(
          'SELECT id FROM candidates WHERE email = $1',
          [parsed.email],
        );
        if (existing.rows.length > 0) {
          candidateId = existing.rows[0].id;
        } else {
          candidateId = uuidv4();
          await client.query(
            `INSERT INTO candidates (id, name, email, phone, location, linkedin_url, github_url, portfolio_url)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [candidateId, parsed.candidateName, parsed.email, parsed.phone,
             parsed.location, parsed.linkedinUrl, parsed.githubUrl, parsed.portfolioUrl],
          );
        }
      } else {
        candidateId = uuidv4();
        await client.query(
          `INSERT INTO candidates (id, name, email, phone, location, linkedin_url, github_url, portfolio_url)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [candidateId, parsed.candidateName, null, parsed.phone,
           parsed.location, parsed.linkedinUrl, parsed.githubUrl, parsed.portfolioUrl],
        );
      }

      // Create resume
      const resumeId = uuidv4();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, rawText, parsedAt, ...parsedData } = parsed;

      await client.query(
        `INSERT INTO resumes (id, candidate_id, parsed_data, raw_text, original_filename, parsed_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [resumeId, candidateId, JSON.stringify(parsedData), rawText,
         originalFilename ?? null, parsedAt],
      );

      return { candidateId, resumeId };
    });
  },

  async findById(id: string): Promise<ParsedResume> {
    const result = await query<ResumeRow>('SELECT * FROM resumes WHERE id = $1', [id]);
    if (result.rows.length === 0) throw new NotFoundError('Resume', id);
    return rowToResume(result.rows[0]);
  },

  async findByCandidate(candidateId: string): Promise<ParsedResume[]> {
    const result = await query<ResumeRow>(
      'SELECT * FROM resumes WHERE candidate_id = $1 ORDER BY created_at DESC',
      [candidateId],
    );
    return result.rows.map(rowToResume);
  },
};
