CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.ai_agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  request_id text,
  run_id text,

  user_id uuid REFERENCES public.ai_agent_users(id),
  user_email text,
  user_name text,
  user_profile text,
  auth_source text,

  pergunta text NOT NULL,
  pergunta_normalizada text,

  detected_intent text,
  intent_confidence numeric,

  sql_generated text,
  sql_executed text,

  validation_status text,
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,

  execution_status text NOT NULL DEFAULT 'pending',
  execution_error text,

  row_count integer,
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  data_preview jsonb NOT NULL DEFAULT '[]'::jsonb,

  execution_time_ms integer,
  total_time_ms integer,

  source text NOT NULL DEFAULT 'interface',
  executor_mode text,
  executor_version text,

  n8n_status_code integer,
  watson_status_code integer,

  ip_address text,
  user_agent text,

  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_created_at
  ON public.ai_agent_runs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_user_created_at
  ON public.ai_agent_runs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_status
  ON public.ai_agent_runs (execution_status);

CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_intent
  ON public.ai_agent_runs (detected_intent);

CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_request_id
  ON public.ai_agent_runs (request_id);

CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_run_id
  ON public.ai_agent_runs (run_id);
