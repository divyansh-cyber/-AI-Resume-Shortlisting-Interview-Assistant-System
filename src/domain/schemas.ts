import { z } from 'zod';

// ─── Resume Schemas ─────────────────────────────────────────────────────────

export const SkillGroupSchema = z.object({
  technical: z.array(z.string()),
  soft: z.array(z.string()),
  other: z.array(z.string()),
});

export const WorkExperienceSchema = z.object({
  company: z.string(),
  title: z.string(),
  location: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  isCurrent: z.boolean(),
  description: z.string(),
  achievements: z.array(z.string()),
  technologiesUsed: z.array(z.string()),
});

export const EducationSchema = z.object({
  institution: z.string(),
  degree: z.string().nullable(),
  field: z.string().nullable(),
  graduationYear: z.number().int().min(1950).max(2100).nullable(),
  gpa: z.number().min(0).max(10).nullable(),
});

export const ProjectSchema = z.object({
  name: z.string(),
  description: z.string(),
  technologiesUsed: z.array(z.string()),
  ownershipSignals: z.array(z.string()),
  url: z.string().url().nullable(),
});

export const CertificationSchema = z.object({
  name: z.string(),
  issuer: z.string().nullable(),
  year: z.number().int().min(1990).max(2100).nullable(),
});

export const ParsedResumeSchema = z.object({
  id: z.string().uuid(),
  candidateName: z.string().nullable(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  linkedinUrl: z.string().url().nullable(),
  githubUrl: z.string().url().nullable(),
  portfolioUrl: z.string().url().nullable(),
  summary: z.string().nullable(),
  skills: SkillGroupSchema,
  experience: z.array(WorkExperienceSchema),
  education: z.array(EducationSchema),
  projects: z.array(ProjectSchema),
  certifications: z.array(CertificationSchema),
  rawText: z.string(),
  parsedAt: z.string().datetime(),
});

// ─── Job Description Schemas ─────────────────────────────────────────────────

export const JDRequirementsSchema = z.object({
  mustHave: z.array(z.string()),
  niceToHave: z.array(z.string()),
  contextualPhrases: z.array(z.string()),
});

export const JobDescriptionSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  company: z.string().nullable(),
  location: z.string().nullable(),
  employmentType: z
    .enum(['full-time', 'part-time', 'contract', 'internship'])
    .nullable(),
  minExperienceYears: z.number().int().min(0).nullable(),
  requirements: JDRequirementsSchema,
  responsibilities: z.array(z.string()),
  rawText: z.string().min(1),
  parsedAt: z.string().datetime(),
});

// ─── API Request Schemas ──────────────────────────────────────────────────────

/**
 * Body for POST /evaluations — submit a new evaluation request.
 * The resume is provided as a multipart file upload (handled separately).
 */
export const CreateEvaluationBodySchema = z.object({
  jobId: z.string().uuid({ message: 'jobId must be a valid UUID' }),
  /**
   * Optional: if true, skip verification (faster, for testing or bulk runs)
   */
  skipVerification: z.boolean().default(false),
});

/**
 * Body for POST /jobs — create a new job description from raw text.
 */
export const CreateJobBodySchema = z.object({
  title: z.string().min(1).max(200),
  company: z.string().max(200).optional(),
  rawText: z.string().min(50, 'Job description must be at least 50 characters'),
});

// ─── Inferred TypeScript types from schemas (used where Zod types are needed) ─

export type CreateEvaluationBody = z.infer<typeof CreateEvaluationBodySchema>;
export type CreateJobBody = z.infer<typeof CreateJobBodySchema>;
