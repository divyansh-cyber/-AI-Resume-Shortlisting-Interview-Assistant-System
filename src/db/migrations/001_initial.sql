-- ============================================================
-- Migration 001 — Initial schema
-- ============================================================
-- Conventions:
--   • UUID primary keys (gen_random_uuid()) — no sequential id leakage
--   • JSONB for semi-structured data (parsed resume, scores, etc.)
--   • created_at / updated_at on every table; updated_at auto-maintained
--     by the trigger defined at the bottom of this file
--   • All FKs have ON DELETE CASCADE unless noted
-- ============================================================

-- Enable the pgcrypto extension for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Trigger function: keep updated_at in sync ────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Table: jobs ───────────────────────────────────────────────────────────────
-- Stores structured job descriptions submitted via the API.
CREATE TABLE IF NOT EXISTS jobs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT        NOT NULL,
  company       TEXT,
  location      TEXT,
  employment_type TEXT CHECK (employment_type IN ('full-time','part-time','contract','internship')),
  min_experience_years INT CHECK (min_experience_years >= 0),
  -- Structured requirements extracted by the LLM
  requirements  JSONB       NOT NULL DEFAULT '{"mustHave":[],"niceToHave":[],"contextualPhrases":[]}'::jsonb,
  responsibilities JSONB    NOT NULL DEFAULT '[]'::jsonb,
  raw_text      TEXT        NOT NULL,
  parsed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_jobs_title ON jobs USING GIN (to_tsvector('english', title));

-- ── Table: candidates ────────────────────────────────────────────────────────
-- One row per unique candidate (identified by email when available).
CREATE TABLE IF NOT EXISTS candidates (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT,
  email         TEXT,
  phone         TEXT,
  location      TEXT,
  linkedin_url  TEXT,
  github_url    TEXT,
  portfolio_url TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_candidates_updated_at
  BEFORE UPDATE ON candidates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_email
  ON candidates (email) WHERE email IS NOT NULL;

-- ── Table: resumes ────────────────────────────────────────────────────────────
-- Stores the parsed output for each submitted resume file.
-- A candidate may have multiple resumes over time.
CREATE TABLE IF NOT EXISTS resumes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id    UUID        NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
  -- Full structured parse result
  parsed_data     JSONB       NOT NULL,
  raw_text        TEXT        NOT NULL,
  original_filename TEXT,
  parsed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_resumes_updated_at
  BEFORE UPDATE ON resumes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_resumes_candidate ON resumes (candidate_id);

-- ── Table: evaluations ───────────────────────────────────────────────────────
-- The central result table — one row per (resume, job) evaluation run.
CREATE TABLE IF NOT EXISTS evaluations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id      UUID        NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
  resume_id         UUID        NOT NULL REFERENCES resumes (id) ON DELETE CASCADE,
  job_id            UUID        NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,

  status            TEXT        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','parsing','scoring','verifying','generating','completed','failed')),

  -- Scoring
  score_card        JSONB,      -- ScoreCard (null until scoring completes)
  overall_score     NUMERIC(5,2) CHECK (overall_score BETWEEN 0 AND 100),

  -- Tier
  tier              CHAR(1)     CHECK (tier IN ('A','B','C')),
  tier_rationale    TEXT,

  -- Interview questions
  interview_questions JSONB     NOT NULL DEFAULT '[]'::jsonb,

  -- Verification
  verification_result JSONB,

  -- LLM-generated summary for recruiters
  executive_summary TEXT,

  -- Error capture
  error_message     TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_evaluations_updated_at
  BEFORE UPDATE ON evaluations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_evaluations_candidate  ON evaluations (candidate_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_job        ON evaluations (job_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_status     ON evaluations (status);
CREATE INDEX IF NOT EXISTS idx_evaluations_tier       ON evaluations (tier);

-- Composite: common query — "all completed evals for a job, sorted by score"
CREATE INDEX IF NOT EXISTS idx_evaluations_job_score
  ON evaluations (job_id, overall_score DESC)
  WHERE status = 'completed';
