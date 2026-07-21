-- ============================================================
-- MIGRAÇÃO — RASTREABILIDADE BENCHMARK → TEST
-- Agente SQL Financeiro DuckLake v2.2.31
--
-- Executada em produção em 21/07/2026.
-- Alteração aditiva e idempotente.
-- Afeta somente public.ai_ducklake_benchmark_runs.
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE public.ai_ducklake_benchmark_runs
    ADD COLUMN IF NOT EXISTS benchmark_run_id uuid,
    ADD COLUMN IF NOT EXISTS agent_run_id text,
    ADD COLUMN IF NOT EXISTS request_id text,
    ADD COLUMN IF NOT EXISTS environment text,
    ADD COLUMN IF NOT EXISTS source text,
    ADD COLUMN IF NOT EXISTS origin_workflow_name text,
    ADD COLUMN IF NOT EXISTS origin_workflow_version text,
    ADD COLUMN IF NOT EXISTS processing_workflow_name text,
    ADD COLUMN IF NOT EXISTS processing_workflow_version text,
    ADD COLUMN IF NOT EXISTS traceability_status text,
    ADD COLUMN IF NOT EXISTS traceability_warnings jsonb
        NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS run_context jsonb
        NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.ai_ducklake_benchmark_runs
SET benchmark_run_id = run_id
WHERE benchmark_run_id IS NULL;

CREATE INDEX IF NOT EXISTS
    idx_ai_ducklake_benchmark_runs_benchmark_run_id
ON public.ai_ducklake_benchmark_runs (benchmark_run_id);

CREATE INDEX IF NOT EXISTS
    idx_ai_ducklake_benchmark_runs_agent_run_id
ON public.ai_ducklake_benchmark_runs (agent_run_id);

CREATE INDEX IF NOT EXISTS
    idx_ai_ducklake_benchmark_runs_request_id
ON public.ai_ducklake_benchmark_runs (request_id);

CREATE INDEX IF NOT EXISTS
    idx_ai_ducklake_benchmark_runs_benchmark_trace
ON public.ai_ducklake_benchmark_runs (
    benchmark_id,
    benchmark_run_id,
    agent_run_id
);

COMMIT;