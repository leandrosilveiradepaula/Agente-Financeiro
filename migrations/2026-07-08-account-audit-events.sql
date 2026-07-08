CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.ai_agent_account_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES public.ai_agent_users(id),
  user_email text,
  user_profile text,
  action text NOT NULL,
  success boolean NOT NULL DEFAULT true,
  ip_address text,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_account_audit_user_created_at
  ON public.ai_agent_account_audit_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_agent_account_audit_action
  ON public.ai_agent_account_audit_events (action);
