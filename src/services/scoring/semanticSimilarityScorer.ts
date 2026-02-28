import { ParsedResume, JobDescription, DimensionScore } from '../../domain';
import { createEmbedding } from '../parser/geminiClient';
import { cacheGet, cacheSet, CacheKeys } from '../../db/redis';
import { cosineSimilarity, similarityToPercent, round } from '../../utils/math';
import { logger } from '../../utils/logger';

/**
 * Semantic Similarity Score — the key differentiator of this system.
 *
 * This dimension recognises that a developer with "AWS Kinesis" experience
 * is highly relevant to a "Kafka" role even though no exact string matches.
 *
 * Algorithm:
 *   1. Build a "candidate skill text" from all technical skills + technologies
 *      used across roles and projects.
 *   2. Build a "JD requirement text" from mustHave + niceToHave skills.
 *   3. Get Gemini embeddings for both (cached in Redis to avoid repeat costs).
 *   4. Cosine similarity → normalised to [0, 100].
 *   5. Apply a niceToHave bonus: for each niceToHave skill present (exact or alias),
 *      add a small bonus up to 10 pts to reward breadth.
 *
 * Caching strategy: embeddings are deterministic for a given text, so we
 * cache them for REDIS_CACHE_TTL seconds (default 24h) keyed on a hash of
 * the text.  This makes bulk re-scoring of many candidates against the same
 * JD very cheap — the JD embedding is computed once.
 */
export async function computeSemanticSimilarityScore(
  resume: ParsedResume,
  jd: JobDescription,
): Promise<DimensionScore> {
  const candidateText = buildCandidateSkillText(resume);
  const jdText = buildJdRequirementText(jd);

  const [candidateEmbedding, jdEmbedding] = await Promise.all([
    getOrCreateEmbedding(candidateText, 'RETRIEVAL_DOCUMENT'),
    getOrCreateEmbedding(jdText, 'RETRIEVAL_DOCUMENT'),
  ]);

  const similarity = cosineSimilarity(candidateEmbedding, jdEmbedding);
  let baseScore = similarityToPercent(similarity);

  // niceToHave bonus (up to +10 pts)
  const niceToHaveBonus = computeNiceToHaveBonus(resume, jd);
  const value = round(Math.min(100, baseScore + niceToHaveBonus));

  logger.debug('Semantic similarity computed', {
    candidateId: resume.id,
    jobId: jd.id,
    rawSimilarity: round(similarity, 4),
    baseScore: round(baseScore),
    bonus: round(niceToHaveBonus),
    finalScore: value,
  });

  // Surface the most conceptually similar JD skills for explainability
  const notableMatches = findSemanticallySimilarSkills(resume, jd);

  const explanation = buildExplanation(value, notableMatches, jd.requirements.niceToHave);

  return {
    value,
    explanation,
    evidence: notableMatches.map(({ resumeSkill, jdSkill }) =>
      `"${resumeSkill}" is semantically related to JD requirement "${jdSkill}"`,
    ),
  };
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function buildCandidateSkillText(resume: ParsedResume): string {
  const parts: string[] = [
    ...resume.skills.technical,
    ...resume.experience.flatMap((e) => [
      ...e.technologiesUsed,
      e.title,
    ]),
    ...resume.projects.flatMap((p) => p.technologiesUsed),
    ...resume.certifications.map((c) => c.name),
  ];
  return [...new Set(parts)].join(', ');
}

function buildJdRequirementText(jd: JobDescription): string {
  return [
    ...jd.requirements.mustHave,
    ...jd.requirements.niceToHave,
  ].join(', ');
}

async function getOrCreateEmbedding(
  text: string,
  taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY',
): Promise<number[]> {
  const cacheKey = CacheKeys.embedding(text);

  const cached = await cacheGet<number[]>(cacheKey);
  if (cached) {
    logger.debug('Embedding cache hit', { key: cacheKey.slice(0, 20) });
    return cached;
  }

  const embedding = await createEmbedding(text, taskType);
  await cacheSet(cacheKey, embedding);
  return embedding;
}

/**
 * For each JD mustHave/niceToHave skill, find the closest skill in the
 * candidate's profile using simple keyword overlap (not embedding-based,
 * to avoid N*M embedding calls).  This is the "explainability" layer.
 *
 * Heuristic: a pair is "semantically similar" if:
 *   - they share a root (e.g. "Kafka" ~ "Event Streaming")
 *   - they belong to the known substitution groups below
 */
interface SkillPair { resumeSkill: string; jdSkill: string }

const SEMANTIC_GROUPS: string[][] = [
  ['kafka', 'rabbitmq', 'sqs', 'kinesis', 'pubsub', 'eventbridge', 'activemq', 'nats', 'pulsar'],
  ['postgresql', 'mysql', 'mariadb', 'aurora', 'sql', 'rds', 'cockroachdb'],
  ['mongodb', 'dynamodb', 'firestore', 'couchdb', 'cosmosdb', 'documentdb'],
  ['redis', 'memcached', 'elasticache', 'valkey'],
  ['aws', 'gcp', 'azure', 'cloud', 'digitalocean'],
  ['kubernetes', 'k8s', 'openshift', 'ecs', 'gke', 'aks'],
  ['docker', 'containerd', 'podman'],
  ['react', 'vue', 'angular', 'svelte', 'nextjs', 'nuxtjs'],
  ['nodejs', 'deno', 'bun', 'express', 'fastify', 'koa', 'nestjs'],
  ['python', 'django', 'flask', 'fastapi'],
  ['java', 'springboot', 'quarkus', 'micronaut'],
  ['elasticsearch', 'opensearch', 'solr', 'typesense'],
  ['graphql', 'grpc', 'restapi', 'trpc'],
  ['terraform', 'pulumi', 'cloudformation', 'cdk'],
  ['prometheus', 'grafana', 'datadog', 'newrelic', 'cloudwatch'],
];

function findSemanticallySimilarSkills(resume: ParsedResume, jd: JobDescription): SkillPair[] {
  const candidateSkills = [
    ...resume.skills.technical,
    ...resume.experience.flatMap((e) => e.technologiesUsed),
    ...resume.projects.flatMap((p) => p.technologiesUsed),
  ].map((s) => s.toLowerCase().replace(/[^a-z0-9]/g, ''));

  const jdSkills = [
    ...jd.requirements.mustHave,
    ...jd.requirements.niceToHave,
  ];

  const pairs: SkillPair[] = [];

  for (const jdSkill of jdSkills) {
    const normJd = jdSkill.toLowerCase().replace(/[^a-z0-9]/g, '');
    const group = SEMANTIC_GROUPS.find((g) => g.includes(normJd));
    if (!group) continue;

    for (const cSkill of candidateSkills) {
      if (cSkill === normJd) continue; // skip exact matches (handled by exactMatch scorer)
      if (group.includes(cSkill)) {
        pairs.push({ resumeSkill: cSkill, jdSkill });
        break;
      }
    }
  }

  return pairs.slice(0, 5); // top 5 for explainability
}

function computeNiceToHaveBonus(resume: ParsedResume, jd: JobDescription): number {
  if (jd.requirements.niceToHave.length === 0) return 0;

  const candidateSkills = new Set([
    ...resume.skills.technical,
    ...resume.experience.flatMap((e) => e.technologiesUsed),
    ...resume.projects.flatMap((p) => p.technologiesUsed),
  ].map((s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')));

  let matched = 0;
  for (const skill of jd.requirements.niceToHave) {
    const norm = skill.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (candidateSkills.has(norm)) matched++;
  }

  return (matched / jd.requirements.niceToHave.length) * 10;
}

function buildExplanation(
  score: number,
  notableMatches: SkillPair[],
  _niceToHave: string[],
): string {
  const tier =
    score >= 80 ? 'Strong semantic alignment' :
    score >= 60 ? 'Moderate semantic alignment' :
    score >= 40 ? 'Partial semantic alignment' :
    'Low semantic alignment';

  let explanation = `${tier} with the job requirements (score: ${score}/100).`;

  if (notableMatches.length > 0) {
    const pairs = notableMatches
      .map(({ resumeSkill, jdSkill }) => `"${resumeSkill}" ↔ "${jdSkill}"`)
      .join(', ');
    explanation += ` Conceptual matches found: ${pairs}.`;
  }

  return explanation;
}
