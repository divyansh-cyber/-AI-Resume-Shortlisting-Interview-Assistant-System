# AI Resume Shortlisting & Interview Assistant System
Demo link :  https://drive.google.com/file/d/1hC9xrfCGd-qvvEGQth5ou5rXUkqE24l-/view?usp=drivesdk

A production-ready TypeScript/Node.js API that automates the end-to-end candidate evaluation pipeline: parse job descriptions and resumes with a large language model, score candidates across four dimensions, verify GitHub and LinkedIn profiles, classify candidates into tiers, and generate personalised interview questions — all in a single async REST workflow.

---

## Table of Contents

- [System Architecture](#system-architecture)
- [Data Strategy](#data-strategy)
- [AI Strategy](#ai-strategy)
- [Scalability](#scalability)
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

---

## System Architecture

### Component Interaction Diagram

```
 ┌──────────────────────────────────────────────────────────────────────────┐
 │                           REST API  (Express)                            │
 │  POST /api/jobs              POST /api/evaluations                        │
 │  GET  /api/jobs/:id          GET  /api/evaluations/:id                    │
 └────────────┬─────────────────────────────┬─────────────────────────────-─┘
              │ synchronous                 │ 202 Accepted — async
              ▼                             ▼
 ┌────────────────────┐       ┌─────────────────────────────────────────────┐
 │    Parser Service  │       │             Evaluation Pipeline              │
 │                    │       │                                              │
 │  pdf-parse         │       │  Stage 1 ── PDF Extractor                   │
 │      │             │       │               (pdf-parse → raw text)         │
 │      ▼             │       │                    │                         │
 │  Gemini 1.5 Pro    │       │  Stage 2 ── Resume Parser                   │
 │  (JSON mode)       │       │               (Gemini LLM → ParsedResume)   │
 │      │             │       │                    │                         │
 │      ▼             │       │  Stage 3 ── Scoring Engine  ◄───── Redis    │
 │  JobDescription    │       │  ┌─────────────────────────────────────┐    │
 │  (structured)      │       │  │  ExactMatch  Semantic  Achiev  Own  │    │
 └────────┬───────────┘       │  │  Scorer      Scorer    Scorer  Scor │    │
          │                   │  │               ▲                      │    │
          ▼                   │  │          Embedding API               │    │
 ┌────────────────────┐       │  │          (text-embedding-004)        │    │
 │     PostgreSQL     │       │  └─────────────────────────────────────┘    │
 │                    │◄──────│                    │                         │
 │  jobs              │       │  Stage 4 ── Verification Engine             │
 │  candidates        │       │  ┌──────────────────────────────────┐       │
 │  resumes           │       │  │  GitHub Verifier  LinkedIn Probe │       │
 │  evaluations       │       │  │  (Octokit + Redis cache)         │       │
 └────────────────────┘       │  └──────────────────────────────────┘       │
          ▲                   │                    │                         │
 ┌────────────────────┐       │  Stage 5 ── Tier Classifier                 │
 │       Redis        │       │               (deterministic, no LLM)       │
 │                    │       │                    │                         │
 │  embeddings cache  │       │  Stage 6 ── Question Generator              │
 │  GitHub API cache  │       │               (Gemini 1.5 Pro, temp 0.4)    │
 └────────────────────┘       └─────────────────────────────────────────────┘
```

### How the Four Core Services Interact

**Parser Service → Scoring Engine**
The Parser Service converts unstructured text (PDF or raw JD string) into two strongly-typed domain objects — `ParsedResume` and `JobDescription` — that serve as the shared contract between all downstream services. The Scoring Engine consumes both objects without touching raw text.

**Scoring Engine → Tier Classifier**
The Scoring Engine produces a `ScoreCard` containing four `DimensionScore` objects and a weighted `overallScore`. The Tier Classifier is a pure, deterministic function that reads only `overallScore` from the `ScoreCard` and outputs a `TierClassification`. No LLM is involved at this stage.

**Scoring Engine + Verification Engine → Question Generator**
The Question Generator receives the full `ScoreCard`, `TierClassification`, and `VerificationResult` from the previous two stages. It uses the scoring gaps and unverified claims as context in the Gemini prompt, so generated questions are specific to that candidate's weaknesses.

**Verification Engine (parallel)**
The Verification Engine runs as `Promise.allSettled([githubVerify, linkedinProbe])` — both checks run concurrently and neither can fail the other. A failed GitHub API call (rate limit, network error) is caught and returns a graceful `{ verified: false, reason: '...' }` without blocking the pipeline.

**Async Pipeline with Status Tracking**
When `POST /api/evaluations` is called the API immediately responds `202 Accepted` with an `evaluationId` and spawns the pipeline in the background. Each stage calls `evaluationRepository.updateStatus()` so clients can observe the transition: `pending → scoring → verifying → generating → complete | failed`.

---

## Data Strategy

### Unstructured PDF → Structured JSON

Converting raw PDF files to structured, queryable data happens in two sequential steps:

**Step 1 — Text Extraction (`pdf-parse`)**

The uploaded PDF binary is passed to `pdf-parse` which strips formatting and returns plain UTF-8 text. No OCR is involved — `pdf-parse` works on text-layer PDFs (covers the vast majority of modern resumes). The raw text is stored in the database as-is for audit and re-parsing purposes.

**Step 2 — LLM Structured Extraction (Gemini 1.5 Pro, JSON mode)**

The raw text is sent to Gemini 1.5 Pro with a system prompt that instructs it to return a strict JSON object matching the `ParsedResume` schema. The Gemini API is called with `responseMimeType: "application/json"` which enables JSON mode — the model is constrained to emit valid JSON and never produces prose outside the JSON envelope.

The system prompt includes:
- The exact TypeScript interface as a comment (field names, types, and descriptions)
- Instructions to set fields to `null` when information is absent rather than hallucinating
- A worked example input/output pair for few-shot grounding

The returned JSON is then validated with a Zod schema before being persisted. If validation fails the evaluation is marked `failed` with a descriptive error — raw Gemini output is never stored directly.

**Why this approach is robust:**
- Zod validation catches any schema drift between the prompt and the codebase at runtime
- `null` fields are legal — the system degrades gracefully for incomplete resumes (no phone, no GitHub)
- Raw text is retained so re-parsing with an improved prompt never requires re-uploading the file

```
PDF binary
    │
    ▼  pdf-parse
Raw UTF-8 text  ──► stored as resume.rawText
    │
    ▼  Gemini 1.5 Pro (JSON mode) + Zod validation
ParsedResume {                    ┐
  skills: { technical, soft }    │
  experience: WorkExperience[]   │  ← validated, typed, persisted
  education: Education[]         │
  achievements: string[]         │
  githubUrl, linkedinUrl         ┘
}
```

### Job Description Strategy

Job descriptions follow the same two-step process (raw text → Gemini → Zod → `JobDescription`). The JD is stored once and reused for every candidate evaluation against that job. Parsed fields include:
- `requirements.mustHave` — hard-required skills (used by ExactMatch Scorer)
- `requirements.niceToHave` — bonus skills
- `requirements.contextualPhrases` — seniority/leadership signals (used by Ownership Scorer)
- `responsibilities` — free-text list (used by Semantic Scorer)

---

## AI Strategy

### LLM: Google Gemini 1.5 Pro

Gemini 1.5 Pro is used for all generative tasks:

| Task | Why Gemini 1.5 Pro |
|---|---|
| Resume + JD parsing | 1M-token context window handles any resume length; JSON mode guarantees structured output |
| Interview question generation | Strong instruction-following with `temperature: 0.4` for controlled creativity |
| Prompt injection defence | System prompt injected as a user+model turn pair (Gemini 1.5 does not have a native system role), preventing role-confusion attacks |

### Embedding Model: `text-embedding-004`

Google's `text-embedding-004` is used for the Semantic Similarity dimension:
- **Task type `RETRIEVAL_DOCUMENT`** for the resume text (indexed side)
- **Task type `RETRIEVAL_QUERY`** for the JD text (query side)
- Embeddings are **1536-dimensional** vectors; cosine similarity is computed in-process with a simple dot-product loop (no vector DB needed at this scale)

### Semantic Similarity: Handling Kafka → RabbitMQ and Similar Equivalences

Pure embedding-based similarity alone can conflate unrelated technologies. The system uses a **two-layer approach**:

**Layer 1 — Alias Table (ExactMatch Scorer)**

A hand-curated alias map normalises technology synonyms before keyword matching:
```
postgres  → postgresql
pg        → postgresql
k8s       → kubernetes
tf        → terraform
ap kafka  → kafka
```
This ensures `postgres` in a resume matches `postgresql` in the JD with 100% confidence.

**Layer 2 — Semantic Groups (SemanticSimilarity Scorer)**

A `SEMANTIC_GROUPS` map clusters functionally equivalent technologies:
```typescript
'message-queue': ['kafka', 'rabbitmq', 'kinesis', 'sqs', 'pubsub', 'nats'],
'relational-db': ['postgresql', 'mysql', 'mssql', 'oracle'],
'container-orch': ['kubernetes', 'k8s', 'ecs', 'nomad'],
```
When the embedding similarity between a resume skill and a JD skill falls below a threshold but both appear in the same semantic group, a partial credit score is awarded. This means a candidate with **RabbitMQ** experience gets a meaningful (not zero) score against a JD that asks for **Kafka**, reflecting genuine transferability.

**Why embeddings + groups beats embeddings alone:**
- Raw embeddings can score `Redis` and `Kafka` similarly (both are infrastructure), creating false positives
- The semantic group acts as a guard: only technologies in the same functional cluster receive partial credit
- The exact-match layer handles the unambiguous cases (alias normalisation), leaving the embedding layer to handle true conceptual distance

### Safety Settings

All Gemini calls use `BLOCK_NONE` safety thresholds for all four harm categories. This is intentional — resume text may contain benign content that triggers false positives in safety filters (e.g. describing security research, military experience, medical terminology).

---

## Scalability

### Current Architecture Capacity

The current single-instance deployment can comfortably process ~200–500 evaluations/hour because each evaluation makes 3–5 Gemini API calls (PDF parse + resume parse + embedding + question generation) and the bottleneck is Gemini API throughput, not the application server.

To reach **10,000+ resumes per day** (~420/hour peak) the following changes are required:

### 1. Decouple the Pipeline with a Job Queue

Replace the in-process background `Promise` with a durable job queue:

```
POST /api/evaluations
    │
    ▼  enqueue job
┌──────────────┐     ┌─────────────────────────────────────────────┐
│  API server  │────►│  Queue  (BullMQ / Redis Streams / SQS)       │
│  (thin layer)│     └───────────────────┬─────────────────────────┘
└──────────────┘                         │  N workers pull jobs
                                         ▼
                        ┌────────────────────────────┐
                        │  Worker pool (N instances)  │
                        │  run evaluation pipeline    │
                        └────────────────────────────┘
```

**BullMQ** (backed by Redis) is the recommended choice — it supports retry-with-backoff, dead-letter queues, job prioritisation, and rate limiting per queue, all of which are needed to stay within Gemini API quotas.

### 2. Horizontal Worker Scaling

Workers are stateless (all state lives in PostgreSQL + Redis) so they can be scaled horizontally behind a Kubernetes `Deployment`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: evaluation-worker
spec:
  replicas: 10          # tune based on Gemini quota
  template:
    spec:
      containers:
        - name: worker
          image: jane-health-api
          command: ["node", "dist/worker.js"]  # separate entry point
```

At 10 workers × 3 evaluations/min each = **1,800 evaluations/hour = 43,200/day**, well above the 10,000 target.

### 3. Database Scaling

| Concern | Solution |
|---|---|
| Write throughput | Connection pooling via `PgBouncer` in transaction mode |
| Read throughput | Read replicas for `GET /api/evaluations` and leaderboard queries |
| Storage growth | Partition `evaluations` table by `created_at` month; archive old partitions to S3 |
| Index strategy | `idx_evaluations_job_id_score` (covering index) for ranked listing queries |

### 4. Embedding Cache

Embedding generation is the most expensive per-call operation (latency + cost). The system already caches embeddings in Redis keyed by `sha256(text)`. At scale:
- Set Redis `maxmemory-policy: allkeys-lru` so the cache self-manages
- For resumes, embeddings are invalidated only when the source text changes (re-parse)
- For JDs, embeddings are computed once at creation and never recomputed

At 10,000 resumes/day with a ~30% cache hit rate (similar candidates applying to the same job), this eliminates ~3,000 Gemini embedding API calls/day.

### 5. Rate Limit Management

Gemini API has per-minute request and token quotas. At scale:
- The BullMQ queue is configured with a **rate limiter** (`max: N jobs per minute`) matching the Gemini quota
- Each worker uses the exponential back-off `retry` utility (`src/utils/retry.ts`) to handle `429` responses without crashing
- Quota upgrades can be requested from Google Cloud once usage is established

### 6. Scalability Summary

| Component | Current (single instance) | At 10K/day |
|---|---|---|
| API servers | 1 | 2–3 (load balanced) |
| Worker processes | in-process async | 10 worker pods (K8s) |
| Queue | none (in-process) | BullMQ on Redis |
| PostgreSQL | single instance | primary + 1 read replica |
| Redis | single instance | Redis Cluster or ElastiCache |
| Gemini API | shared quota | dedicated project quota |
| Estimated throughput | ~500/day | 40,000+/day |

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


