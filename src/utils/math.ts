/**
 * Clamps a numeric value to [0, 100].
 */
export function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Rounds a number to a fixed number of decimal places.
 */
export function round(value: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Computes cosine similarity between two embedding vectors.
 * Returns a value in [-1, 1]; identical vectors → 1.0
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Normalises a cosine similarity value ([-1,1]) to a percentage [0, 100].
 */
export function similarityToPercent(similarity: number): number {
  return clamp(((similarity + 1) / 2) * 100);
}

/**
 * Extracts quantifiable achievements from text (e.g. "increased revenue by 40%").
 * Returns the count of distinct numeric achievements found.
 */
export function countQuantifiableAchievements(text: string): number {
  // Pattern: number + optional % or x/X + context keyword
  const patterns = [
    /\d+\s*%/g, // percentage values
    /\d+x\b/gi, // multipliers (3x, 5X)
    /\$\s*\d[\d,.]*/g, // dollar amounts
    /\b\d+\s*(million|billion|thousand|k)\b/gi, // large numbers
    /increased|decreased|reduced|improved|grew|saved|generated|drove|delivered|led/gi,
  ];
  const matches = new Set<string>();
  for (const pattern of patterns) {
    const found = text.match(pattern) ?? [];
    found.forEach((m) => matches.add(m.toLowerCase().trim()));
  }
  return matches.size;
}

/**
 * Sleeps for a given number of milliseconds (useful for rate-limited retries).
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Truncates a string for display, appending "..." if needed.
 */
export function truncate(str: string, maxLength = 100): string {
  return str.length <= maxLength ? str : `${str.slice(0, maxLength - 3)}...`;
}

/**
 * Normalises a skill string for comparison (lowercase, strip punctuation).
 */
export function normaliseSkill(skill: string): string {
  return skill.toLowerCase().replace(/[^a-z0-9+#.]/g, '').trim();
}
