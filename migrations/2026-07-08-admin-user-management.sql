CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.ai_agent_users
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS disabled_by uuid REFERENCES public.ai_agent_users(id),
  ADD COLUMN IF NOT EXISTS last_admin_action_at timestamptz;

CREATE TABLE IF NOT EXISTS public.ai_agent_admin_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  created_at timestamptz NOT NULL DEFAULT now(),

  request_id text,

  actor_user_id uuid REFERENCES public.ai_agent_users(id),
  actor_email text,
  actor_profile text,

  target_user_id uuid REFERENCES public.ai_agent_users(id),
  target_email text,

  action text NOT NULL,
  success boolean NOT NULL DEFAULT true,

  before_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_data jsonb NOT NULL DEFAULT '{}'::jsonb,

  ip_address text,
  user_agent text,

  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.ai_agent_admin_audit_events
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS actor_email text,
  ADD COLUMN IF NOT EXISTS actor_profile text,
  ADD COLUMN IF NOT EXISTS target_email text,
  ADD COLUMN IF NOT EXISTS success boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS before_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS after_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reason text;

CREATE INDEX IF NOT EXISTS idx_ai_agent_admin_audit_created_at
  ON public.ai_agent_admin_audit_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_agent_admin_audit_target_created_at
  ON public.ai_agent_admin_audit_events (target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_agent_admin_audit_actor_created_at
  ON public.ai_agent_admin_audit_events (actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_agent_admin_audit_action
  ON public.ai_agent_admin_audit_events (action);