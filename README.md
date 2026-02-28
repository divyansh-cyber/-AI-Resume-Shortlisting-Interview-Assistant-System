# AI Resume Shortlisting & Interview Assistant System

A production-ready TypeScript/Node.js API that automates the end-to-end candidate evaluation pipeline: parse job descriptions and resumes with a large language model, score candidates across four dimensions, verify GitHub and LinkedIn profiles, classify candidates into tiers, and generate personalised interview questions — all in a single async REST workflow.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Environment Variables](#environment-variables)
  - [Running with Docker Compose](#running-with-docker-compose)
  - [Running Locally (without Docker)](#running-locally-without-docker)
- [API Reference](#api-reference)
  - [Health Check](#health-check)
  - [Jobs](#jobs)
  - [Evaluations](#evaluations)
- [Scoring Engine](#scoring-engine)
- [Tier Classification](#tier-classification)
- [Verification Engine](#verification-engine)
- [Interview Question Generator](#interview-question-generator)
- [Testing](#testing)
- [Commit History](#commit-history)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                          REST API (Express)                          │
│   POST /api/jobs          POST /api/evaluations                      │
│   GET  /api/jobs/:id      GET  /api/evaluations/:id                  │
└───────────────┬──────────────────────┬───────────────────────────────┘
                │                      │ 202 Accepted (async)
                ▼                      ▼
        ┌──────────────┐     ┌─────────────────────────┐
        │ Job Parser   │     │  Evaluation Pipeline     │
        │ (Gemini LLM) │     │                          │
        └──────┬───────┘     │  1. PDF Extraction       │
               │             │  2. Resume Parsing (LLM) │
               ▼             │  3. Scoring Engine       │
        ┌──────────────┐     │  4. Verification Engine  │
        │  PostgreSQL  │◄────│  5. Tier Classification  │
        │  (job + eval │     │  6. Question Generation  │
        │   + resume)  │     └─────────────────────────┘
        └──────────────┘
               ▲
        ┌──────────────┐
        │    Redis     │  ← embedding cache, GitHub API cache
        └──────────────┘
```

The evaluation endpoint returns **202 Accepted** immediately with an `evaluationId`. The six-stage pipeline runs asynchronously in the background; the client polls `GET /api/evaluations/:id` to check `status` (`pending → scoring → verifying → generating → complete | failed`).

---

## Technology Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js ≥ 18, TypeScript 5.3 |
| HTTP Framework | Express 4 + `express-async-errors` |
| LLM | Google Gemini 1.5 Pro (chat) + `text-embedding-004` (embeddings) |
| Database | PostgreSQL 16 via `pg` pool |
| Cache | Redis 7 via `ioredis` |
| PDF Parsing | `pdf-parse` |
| Schema Validation | Zod |
| GitHub API | `@octokit/rest` |
| File Upload | `multer` |
| Security | `helmet`, `cors`, `express-rate-limit` |
| Logging | `winston` |
| Testing | Jest + `ts-jest` + `supertest` |
| Containerisation | Docker + Docker Compose |

---

## Project Structure

```
src/
├── index.ts                  # Entry point, graceful shutdown
├── config/
│   └── index.ts              # Zod-validated environment config
├── api/
│   ├── app.ts                # Express app factory
│   ├── controllers/
│   │   ├── jobs.controller.ts
│   │   └── evaluations.controller.ts
│   ├── middleware/
│   │   ├── errorHandler.ts   # ZodError → 400, AppError → correct status
│   │   ├── upload.ts         # multer — PDF only, 5 MB limit
│   │   └── validate.ts       # Zod request body/param validation
│   └── routes/
│       ├── jobs.routes.ts
│       └── evaluations.routes.ts
├── db/
│   ├── postgres.ts           # pg Pool singleton
│   ├── redis.ts              # ioredis singleton
│   ├── migrate.ts            # schema migration runner
│   ├── seed.ts               # development seed data
│   ├── migrations/
│   │   └── 001_initial.sql   # full schema DDL
│   └── repositories/
│       ├── job.repository.ts
│       ├── candidate.repository.ts
│       └── evaluation.repository.ts
├── domain/                   # Pure TypeScript interfaces (no runtime code)
│   ├── resume.ts
│   ├── job.ts
│   ├── score.ts
│   ├── verification.ts
│   ├── evaluation.ts
│   └── schemas.ts             # Zod schemas mirroring domain interfaces
├── services/
│   ├── parser/               # PDF text extraction + Gemini structured output
│   │   ├── geminiClient.ts
│   │   ├── pdfExtractor.ts
│   │   ├── resumeParser.ts
│   │   └── jobParser.ts
│   ├── scoring/              # 4-dimensional scoring engine
│   │   ├── exactMatchScorer.ts
│   │   ├── semanticSimilarityScorer.ts
│   │   ├── achievementScorer.ts
│   │   ├── ownershipScorer.ts
│   │   └── scoringEngine.ts
│   ├── verification/         # GitHub + LinkedIn profile corroboration
│   │   ├── githubVerifier.ts
│   │   ├── linkedinVerifier.ts
│   │   └── verificationService.ts
│   └── questions/            # Tier classifier + Gemini question generator
│       ├── tierClassifier.ts
│       └── questionGenerator.ts
└── utils/
    ├── errors.ts             # AppError hierarchy (400/404/429/502/500)
    ├── logger.ts             # winston logger
    ├── math.ts               # clamp, cosine similarity, normalise, etc.
    └── retry.ts              # exponential back-off helper

tests/
├── setup.ts                  # Jest global env setup
├── unit/
│   ├── utils/math.test.ts
│   └── scoring/
│       ├── exactMatchScorer.test.ts
│       ├── achievementScorer.test.ts
│       ├── ownershipScorer.test.ts
│       └── scoringEngine.test.ts
│   └── questions/
│       └── tierClassifier.test.ts
└── integration/
    ├── jobs.test.ts
    └── evaluations.test.ts
```

---

## Getting Started

### Prerequisites

- **Docker & Docker Compose** (recommended) _or_ Node.js ≥ 18, PostgreSQL 16, Redis 7
- A **Google AI API key** with access to Gemini 1.5 Pro — [get one free](https://aistudio.google.com/app/apikey)
- (Optional) A **GitHub personal access token** for higher API rate limits

### Environment Variables

Copy `.env.example` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | ✅ | Google AI Studio API key |
| `GEMINI_CHAT_MODEL` | ✅ | e.g. `gemini-1.5-pro` |
| `GEMINI_EMBEDDING_MODEL` | ✅ | e.g. `text-embedding-004` |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Redis connection string |
| `PORT` | — | HTTP port (default `3000`) |
| `NODE_ENV` | — | `development` / `production` / `test` |
| `GITHUB_TOKEN` | — | GitHub PAT (raises rate limit to 5 000 req/h) |
| `RATE_LIMIT_WINDOW_MS` | — | Rate limit window in ms (default `60000`) |
| `RATE_LIMIT_MAX_REQUESTS` | — | Max requests per window (default `100`) |

### Running with Docker Compose

```bash
# 1. Clone and enter the repository
git clone https://github.com/divyansh-cyber/-AI-Resume-Shortlisting-Interview-Assistant-System.git
cd -AI-Resume-Shortlisting-Interview-Assistant-System

# 2. Configure environment
cp .env.example .env
#    → edit .env and set at minimum GEMINI_API_KEY, GEMINI_CHAT_MODEL, GEMINI_EMBEDDING_MODEL

# 3. Start all services (API + PostgreSQL + Redis)
docker compose up --build

# 4. The API is now available at http://localhost:3000
```

The Compose file runs `npm run migrate` inside the API container before starting the server, so the schema is always up to date.

### Running Locally (without Docker)

```bash
# Install dependencies
npm install

# Start PostgreSQL and Redis separately, then:
export DATABASE_URL="postgresql://user:pass@localhost:5432/jane_health"
export REDIS_URL="redis://localhost:6379"

# Run database migrations
npm run migrate

# Start in development mode (hot-reload)
npm run dev

# Build and start in production mode
npm run build
npm start
```

---

## API Reference

All endpoints are prefixed with `/api`. The API is rate-limited to **100 requests per minute** per IP.

### Health Check

```
GET /health
```

**Response 200**
```json
{ "status": "ok", "timestamp": "2026-02-28T10:00:00.000Z" }
```

---

### Jobs

#### Create a Job Description

```
POST /api/jobs
Content-Type: application/json
```

**Request Body**
```json
{
  "title": "Senior Backend Engineer",
  "company": "Acme Corp",
  "rawText": "We are looking for a Senior Backend Engineer with 4+ years of experience in TypeScript, Node.js, and PostgreSQL..."
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | string | ✅ | max 200 chars |
| `company` | string | — | max 200 chars |
| `rawText` | string | ✅ | min 50 chars; full JD text sent to Gemini |

**Response 201**
```json
{
  "jobId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "title": "Senior Backend Engineer",
  "company": "Acme Corp",
  "mustHaveCount": 5,
  "niceToHaveCount": 3,
  "createdAt": "2026-02-28T10:00:00.000Z"
}
```

#### List Jobs

```
GET /api/jobs?limit=50&offset=0
```

**Response 200**
```json
{
  "data": [
    {
      "id": "3fa85f64...",
      "title": "Senior Backend Engineer",
      "company": "Acme Corp",
      "mustHaveCount": 5,
      "parsedAt": "2026-02-28T10:00:00.000Z"
    }
  ],
  "meta": { "total": 12, "limit": 50, "offset": 0 }
}
```

#### Get a Job

```
GET /api/jobs/:id
```

**Response 200** — full `JobDescription` object including `requirements.mustHave`, `requirements.niceToHave`, `responsibilities`, etc.

**Response 404** — job not found.

---

### Evaluations

#### Submit a Resume for Evaluation

```
POST /api/evaluations
Content-Type: multipart/form-data
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `resume` | file (PDF) | ✅ | max 5 MB |
| `jobId` | string (UUID) | ✅ | must reference an existing job |
| `skipVerification` | `"true"` / `"false"` | — | skip GitHub/LinkedIn check (default `false`) |

**Response 202**
```json
{
  "evaluationId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "status": "pending",
  "message": "Evaluation started. Poll GET /api/evaluations/:id for progress."
}
```

The pipeline runs asynchronously. Poll the status endpoint to track progress.

#### Get Evaluation Status / Result

```
GET /api/evaluations/:id
```

**Response 200 — while processing**
```json
{
  "id": "7c9e6679...",
  "status": "scoring",
  "candidateId": "...",
  "jobId": "...",
  "createdAt": "2026-02-28T10:00:01.000Z",
  "updatedAt": "2026-02-28T10:00:04.000Z"
}
```

**Response 200 — complete**
```json
{
  "id": "7c9e6679...",
  "status": "complete",
  "candidateId": "...",
  "jobId": "...",
  "scoreCard": {
    "overallScore": 78.5,
    "exactMatchScore":        { "value": 85, "explanation": "...", "evidence": ["✓ TypeScript", "✓ Node.js"] },
    "semanticSimilarityScore":{ "value": 80, "explanation": "...", "evidence": [] },
    "achievementScore":       { "value": 65, "explanation": "...", "evidence": ["3 quantifiable metrics"] },
    "ownershipScore":         { "value": 72, "explanation": "...", "evidence": ["led", "architected"] }
  },
  "tierClassification": {
    "tier": "B",
    "rationale": "Tier B — technical screen recommended. Overall: 78/100 ...",
    "thresholds": { "tierA": 75, "tierB": 50 }
  },
  "verificationResult": {
    "githubVerified": true,
    "linkedinVerified": false,
    "confidenceScore": 70,
    "details": { ... }
  },
  "interviewQuestions": [
    {
      "question": "Walk me through the largest system you've owned end-to-end. What architectural decisions would you revisit?",
      "rationale": "Tests system design ownership.",
      "difficulty": "hard",
      "category": "system-design"
    }
  ],
  "executiveSummary": "Strong TypeScript/Node.js background with 5 years of experience...",
  "createdAt": "...",
  "updatedAt": "..."
}
```

`status` lifecycle: `pending → scoring → verifying → generating → complete | failed`

#### List Evaluations for a Job

```
GET /api/jobs/:jobId/evaluations?limit=50&offset=0&tier=A
```

Optional `tier` filter: `A`, `B`, or `C`.

**Response 200**
```json
{
  "data": [ { "id": "...", "status": "complete", "overallScore": 78.5, "tier": "B", ... } ],
  "meta": {
    "total": 42,
    "tierBreakdown": { "A": 8, "B": 21, "C": 13 },
    "limit": 50,
    "offset": 0
  }
}
```

---

## Scoring Engine

Each resume is evaluated across **four dimensions** that are combined into a weighted overall score:

| Dimension | Weight | Description |
|---|---|---|
| **Exact Match** | 35% | Keyword-level overlap between resume skills and JD `mustHave` list. Includes an alias table (`pg = postgres = postgresql`, `k8s = kubernetes`, `tf = terraform`, etc.). |
| **Semantic Similarity** | 30% | Cosine similarity between Gemini `text-embedding-004` embeddings of the resume raw text and JD raw text. Cached in Redis per content hash. |
| **Achievement** | 20% | Sigmoid-scaled detection of quantifiable achievements (%, $, ×), strong action verbs (launched, architected, drove), and explicit certifications. |
| **Ownership** | 15% | Detects individual contributor signals (led, owned, built alone, responsible for) in work experience descriptions and project ownership fields. |

```
overallScore = (exactMatch × 0.35) + (semantic × 0.30)
             + (achievement × 0.20) + (ownership × 0.15)
```

All dimension scores and the overall score are clamped to **[0, 100]**.

---

## Tier Classification

Candidates are placed into one of three tiers based on their overall score and the configurable thresholds (defaults shown):

| Tier | Score Range | Action |
|---|---|---|
| **A** | ≥ 75 | Fast-track to technical interview |
| **B** | 50 – 74 | Technical phone screen recommended |
| **C** | < 50 | Recruiter review — likely not a match |

Thresholds can be overridden per call. The classifier also generates a natural-language rationale that highlights which dimensions pulled the score up or down.

---

## Verification Engine

Profile verification is **advisory** — it adjusts confidence, not the score. It runs as a parallel `Promise.allSettled` so a failing GitHub API call cannot block the evaluation.

**GitHub** (70% of confidence weight):
- Verifies the account exists and is active
- Checks repo count, total stars, recent commit activity
- Detects languages used and cross-references them against resume skills
- Caches results in Redis for 1 hour
- Handles 404 (user not found) and 403 (rate limit) gracefully

**LinkedIn** (30% of confidence weight):
- Performs an HTTP HEAD probe on the LinkedIn profile URL
- Returns `verified: true` if the profile is publicly reachable
- Advisory only — LinkedIn does not allow scraping

---

## Interview Question Generator

After scoring and verification, Gemini 1.5 Pro generates personalised interview questions tailored to:

- The candidate's **tier** (A → 8 questions, B → 6 questions, C → 5 questions)
- **Gaps** identified in the scoring phase
- **Ownership signals** detected — senior candidates get system-design and leadership questions
- **Unverified claims** flagged by the verification engine

A brief **executive summary** is also generated (2–3 sentences) for fast recruiter triage.

---

## Testing

```bash
# Run all tests
npm test

# Run with coverage report
npm run test:coverage

# Run only unit tests
npx jest --testPathPattern="tests/unit"

# Run only integration tests
npx jest --testPathPattern="tests/integration"
```

**Test suite overview:**

| Suite | File | Tests |
|---|---|---|
| Math utilities | `unit/utils/math.test.ts` | 18 |
| Exact match scorer | `unit/scoring/exactMatchScorer.test.ts` | 10 |
| Achievement scorer | `unit/scoring/achievementScorer.test.ts` | 6 |
| Ownership scorer | `unit/scoring/ownershipScorer.test.ts` | 7 |
| Scoring engine | `unit/scoring/scoringEngine.test.ts` | 8 |
| Tier classifier | `unit/questions/tierClassifier.test.ts` | 12 |
| Jobs API | `integration/jobs.test.ts` | 11 |
| Evaluations API | `integration/evaluations.test.ts` | 9 |
| **Total** | | **93** |

Integration tests mock all database and LLM dependencies via `jest.mock`, so no live services are required to run the suite.

---

## Commit History

The project was built in **10 atomic stages**:

| Stage | Commit Message | Description |
|---|---|---|
| 1 | `chore: init project scaffold` | package.json, tsconfig, Docker, configs, utils |
| 2 | `feat: define domain models and data contracts` | TypeScript interfaces + Zod schemas |
| 3 | `feat: database layer — PostgreSQL schema + Redis client` | pg pool, ioredis, migrations, repositories |
| 4 | `feat: parser service — PDF extraction + Gemini LLM structured output` | pdf-parse, Gemini client, resume/job parsers |
| 5 | `feat: scoring engine — 4-dimensional multi-modal scoring` | exactMatch, semantic, achievement, ownership scorers + orchestrator |
| 6 | `feat: verification engine — GitHub + LinkedIn profile corroboration` | Octokit-based GitHub verifier, LinkedIn probe, parallel runner |
| 7 | `feat: tier classifier + Gemini interview question generator` | deterministic tier logic, LLM question generation |
| 8 | `feat: REST API layer — jobs + evaluations endpoints with async pipeline` | Express app, middleware, controllers, routes |
| 9 | `test: unit + integration test suite (93 tests passing)` | Jest + ts-jest + supertest, all mocked |
| 10 | `docs: README and project documentation` | This file |

---

## License

MIT
