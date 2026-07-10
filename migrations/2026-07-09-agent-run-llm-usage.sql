ALTER TABLE public.ai_agent_runs
  ADD COLUMN IF NOT EXISTS llm_provider text,
  ADD COLUMN IF NOT EXISTS llm_model text,
  ADD COLUMN IF NOT EXISTS llm_prompt_tokens integer,
  ADD COLUMN IF NOT EXISTS llm_completion_tokens integer,
  ADD COLUMN IF NOT EXISTS llm_total_tokens integer,
  ADD COLUMN IF NOT EXISTS llm_usage_source text,
  ADD COLUMN IF NOT EXISTS sql_cache_hit boolean,
  ADD COLUMN IF NOT EXISTS sql_cache_source_run_id uuid REFERENCES public.ai_agent_runs(id),
  ADD COLUMN IF NOT EXISTS sql_cache_saved_prompt_tokens integer,
  ADD COLUMN IF NOT EXISTS sql_cache_saved_completion_tokens integer,
  ADD COLUMN IF NOT EXISTS sql_cache_saved_total_tokens integer,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd numeric,
  ADD COLUMN IF NOT EXISTS estimated_savings_usd numeric;

CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_sql_cache_hit
  ON public.ai_agent_runs (sql_cache_hit);

CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_sql_cache_source_run_id
  ON public.ai_agent_runs (sql_cache_source_run_id);
