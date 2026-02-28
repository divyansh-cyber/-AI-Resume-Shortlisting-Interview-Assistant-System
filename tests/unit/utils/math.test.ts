import {
  clamp,
  round,
  cosineSimilarity,
  similarityToPercent,
  countQuantifiableAchievements,
  normaliseSkill,
  truncate,
} from '../../../src/utils/math';

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(50)).toBe(50);
  });
  it('clamps to minimum', () => {
    expect(clamp(-10)).toBe(0);
  });
  it('clamps to maximum', () => {
    expect(clamp(150)).toBe(100);
  });
  it('respects custom min/max', () => {
    expect(clamp(5, 10, 20)).toBe(10);
    expect(clamp(25, 10, 20)).toBe(20);
  });
});

describe('round', () => {
  it('rounds to 2 decimal places by default', () => {
    expect(round(3.14159)).toBe(3.14);
  });
  it('rounds to specified decimals', () => {
    expect(round(3.14159, 4)).toBe(3.1416);
  });
  it('handles integers', () => {
    expect(round(42)).toBe(42);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });

  it('throws when vector lengths differ', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow('Vector length mismatch');
  });

  it('returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });
});

describe('similarityToPercent', () => {
  it('converts 1.0 to 100', () => {
    expect(similarityToPercent(1.0)).toBe(100);
  });
  it('converts 0.0 to 50', () => {
    expect(similarityToPercent(0.0)).toBe(50);
  });
  it('converts -1.0 to 0', () => {
    expect(similarityToPercent(-1.0)).toBe(0);
  });
  it('clamps values outside [-1, 1]', () => {
    expect(similarityToPercent(2.0)).toBe(100);
    expect(similarityToPercent(-2.0)).toBe(0);
  });
});

describe('countQuantifiableAchievements', () => {
  it('counts percentage values', () => {
    const text = 'Increased revenue by 40% and reduced costs by 15%';
    expect(countQuantifiableAchievements(text)).toBeGreaterThanOrEqual(2);
  });

  it('counts multipliers', () => {
    const text = 'Improved performance 3x while reducing latency 2x';
    expect(countQuantifiableAchievements(text)).toBeGreaterThanOrEqual(2);
  });

  it('counts dollar amounts', () => {
    const text = 'Generated $2.5 million in new pipeline';
    expect(countQuantifiableAchievements(text)).toBeGreaterThanOrEqual(1);
  });

  it('returns 0 for plain text with no metrics', () => {
    const text = 'Worked on the backend team and helped with tasks';
    expect(countQuantifiableAchievements(text)).toBe(0);
  });

  it('counts action verbs', () => {
    const text = 'Led initiative and improved processes';
    expect(countQuantifiableAchievements(text)).toBeGreaterThanOrEqual(2);
  });
});

describe('normaliseSkill', () => {
  it('lowercases the skill', () => {
    expect(normaliseSkill('TypeScript')).toBe('typescript');
  });

  it('strips punctuation (keeps . + # in skill names)', () => {
    expect(normaliseSkill('Node.js')).toBe('node.js'); // dots preserved
    expect(normaliseSkill('C++')).toBe('c++');          // + preserved
    expect(normaliseSkill('React!')).toBe('react');      // ! stripped
  });

  it('handles already-normalised strings', () => {
    expect(normaliseSkill('postgresql')).toBe('postgresql');
  });
});

describe('truncate', () => {
  it('does not truncate short strings', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates long strings with ellipsis', () => {
    const result = truncate('a'.repeat(200), 100);
    expect(result).toHaveLength(100);
    expect(result.endsWith('...')).toBe(true);
  });
});
