/**
 * Parsed, structured representation of a Job Description.
 *
 * Both raw text and structured fields are stored so the scoring engine
 * can use exact-match lookup (structured) as well as semantic match (raw).
 */
export interface JobDescription {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  employmentType: 'full-time' | 'part-time' | 'contract' | 'internship' | null;

  /** Minimum years of experience stated in the JD */
  minExperienceYears: number | null;

  requirements: JDRequirements;
  responsibilities: string[];

  /** Free-text description (kept for embedding-based semantic comparison) */
  rawText: string;

  parsedAt: string;
}

export interface JDRequirements {
  /**
   * Skills that are flagged as "required" or "must-have".
   * Used for exact-match scoring.
   */
  mustHave: string[];
  /**
   * Skills flagged as "nice-to-have" or "preferred".
   * Used for weighted similarity scoring.
   */
  niceToHave: string[];
  /**
   * Contextual phrases that describe the work environment,
   * used for ownership / culture-fit scoring.
   */
  contextualPhrases: string[];
}
