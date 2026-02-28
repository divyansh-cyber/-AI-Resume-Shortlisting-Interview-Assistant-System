/**
 * Seed script — inserts two sample job descriptions for local development
 * and testing without needing to call the API manually.
 *
 * Run:  npm run db:seed
 */
import { getPostgresPool } from './postgres';
import { jobRepository } from './repositories';
import { logger } from '../utils/logger';

const SEED_JOBS = [
  {
    title: 'Senior Backend Engineer',
    company: 'TechCorp',
    location: 'Remote',
    employmentType: 'full-time' as const,
    minExperienceYears: 5,
    requirements: {
      mustHave: [
        'Node.js', 'TypeScript', 'PostgreSQL', 'REST APIs', 'Docker',
      ],
      niceToHave: [
        'Kafka', 'Redis', 'Kubernetes', 'AWS', 'GraphQL',
      ],
      contextualPhrases: [
        'lead architecture decisions', 'own features end-to-end',
        'mentor junior engineers', 'high-traffic distributed systems',
      ],
    },
    responsibilities: [
      'Design and build scalable backend services handling 10k+ RPS',
      'Lead architecture decisions for new product features',
      'Collaborate with frontend and data teams on API contracts',
      'Participate in on-call rotations and incident response',
    ],
    rawText: `We are looking for a Senior Backend Engineer with 5+ years of experience.
You must have strong Node.js and TypeScript skills, and deep expertise in PostgreSQL.
Experience with Kafka or similar message brokers is a big plus.
You will lead architecture decisions and own features end-to-end in a high-traffic distributed system.
Nice to have: Redis, Kubernetes, AWS, GraphQL.`,
  },
  {
    title: 'Full-Stack Engineer',
    company: 'StartupXYZ',
    location: 'New York, NY',
    employmentType: 'full-time' as const,
    minExperienceYears: 3,
    requirements: {
      mustHave: [
        'React', 'TypeScript', 'Node.js', 'REST APIs', 'Git',
      ],
      niceToHave: [
        'Next.js', 'PostgreSQL', 'AWS', 'Tailwind CSS', 'Testing (Jest/Cypress)',
      ],
      contextualPhrases: [
        'build features independently', 'cross-functional team',
        'fast-paced startup environment', 'user-facing product',
      ],
    },
    responsibilities: [
      'Build and maintain full-stack features across React frontend and Node.js backend',
      'Collaborate with designers to implement pixel-perfect UI',
      'Write tests and maintain CI/CD pipelines',
      'Participate in code reviews and technical planning',
    ],
    rawText: `We are seeking a Full-Stack Engineer with at least 3 years of experience.
Must have: React, TypeScript, Node.js, REST APIs.
You should be comfortable building features independently in a fast-paced startup environment.
Nice to have: Next.js, PostgreSQL, AWS, Tailwind CSS, Jest/Cypress testing.`,
  },
];

async function seed(): Promise<void> {
  logger.info('Starting seed…');

  for (const job of SEED_JOBS) {
    const created = await jobRepository.create(job);
    logger.info(`Created job: "${created.title}" (id: ${created.id})`);
  }

  logger.info('Seed complete.');
}

const pool = getPostgresPool();

seed()
  .catch((err) => {
    logger.error('Seed failed', { err });
    process.exit(1);
  })
  .finally(() => void pool.end());
