import { v4 as uuidv4 } from 'uuid';
import { query } from '../postgres';
import { JobDescription } from '../../domain';
import { NotFoundError } from '../../utils/errors';

/* ── Row shape from PostgreSQL ── */
interface JobRow {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  employment_type: string | null;
  min_experience_years: number | null;
  requirements: JobDescription['requirements'];
  responsibilities: string[];
  raw_text: string;
  parsed_at: string;
  created_at: string;
  updated_at: string;
}

function rowToJob(row: JobRow): JobDescription {
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    location: row.location,
    employmentType: (row.employment_type as JobDescription['employmentType']) ?? null,
    minExperienceYears: row.min_experience_years,
    requirements: row.requirements,
    responsibilities: row.responsibilities as string[],
    rawText: row.raw_text,
    parsedAt: new Date(row.parsed_at).toISOString(),
  };
}

export const jobRepository = {
  async create(data: Omit<JobDescription, 'id' | 'parsedAt'>): Promise<JobDescription> {
    const id = uuidv4();
    const now = new Date().toISOString();

    const result = await query<JobRow>(
      `INSERT INTO jobs (id, title, company, location, employment_type, min_experience_years,
         requirements, responsibilities, raw_text, parsed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        id,
        data.title,
        data.company,
        data.location,
        data.employmentType,
        data.minExperienceYears,
        JSON.stringify(data.requirements),
        JSON.stringify(data.responsibilities),
        data.rawText,
        now,
      ],
    );

    return rowToJob(result.rows[0]);
  },

  async findById(id: string): Promise<JobDescription> {
    const result = await query<JobRow>('SELECT * FROM jobs WHERE id = $1', [id]);
    if (result.rows.length === 0) throw new NotFoundError('Job', id);
    return rowToJob(result.rows[0]);
  },

  async findAll(limit = 50, offset = 0): Promise<JobDescription[]> {
    const result = await query<JobRow>(
      'SELECT * FROM jobs ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset],
    );
    return result.rows.map(rowToJob);
  },

  async count(): Promise<number> {
    const result = await query<{ count: string }>('SELECT COUNT(*) FROM jobs');
    return parseInt(result.rows[0].count, 10);
  },
};
