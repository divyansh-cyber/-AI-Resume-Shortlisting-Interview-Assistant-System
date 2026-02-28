/**
 * Parsed, structured representation of a resume.
 *
 * The raw PDF text is extracted first, then an LLM call transforms it
 * into this schema.  All fields are optional because resumes are unstructured
 * and we can't guarantee a field will be present.
 */
export interface ParsedResume {
  /** Unique id assigned at parse time */
  id: string;
  candidateName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  summary: string | null;

  skills: SkillGroup;
  experience: WorkExperience[];
  education: Education[];
  projects: Project[];
  certifications: Certification[];

  /** Raw extracted text (kept for audit / re-parsing) */
  rawText: string;

  /** ISO-8601 timestamp of when parsing occurred */
  parsedAt: string;
}

export interface SkillGroup {
  /** Hard skills explicitly listed by the candidate (e.g. "TypeScript", "Kafka") */
  technical: string[];
  /** Management, communication, etc. */
  soft: string[];
  /** Any skill that doesn't clearly fall into technical or soft */
  other: string[];
}

export interface WorkExperience {
  company: string;
  title: string;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  /** Bullet points / responsibilities as free text */
  description: string;
  /** Achievements with quantifiable impact extracted from description */
  achievements: string[];
  /** Technologies / tools explicitly mentioned in this role */
  technologiesUsed: string[];
}

export interface Education {
  institution: string;
  degree: string | null;
  field: string | null;
  graduationYear: number | null;
  gpa: number | null;
}

export interface Project {
  name: string;
  description: string;
  technologiesUsed: string[];
  /** Ownership signals: "led", "architected", "built alone", "drove", etc. */
  ownershipSignals: string[];
  /** URL to repo or live demo */
  url: string | null;
}

export interface Certification {
  name: string;
  issuer: string | null;
  year: number | null;
}
