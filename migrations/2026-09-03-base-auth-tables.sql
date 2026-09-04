-- Base auth tables for DEMO bootstrap.
-- Apply before historical migrations that reference public.ai_agent_users.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.ai_agent_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  name text NOT NULL,
  email text NOT NULL,
  user_profile text NOT NULL,

  is_active boolean NOT NULL DEFAULT true,

  password_hash text NOT NULL,
  failed_login_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  last_login_at timestamptz,
  last_logout_at timestamptz,

  CONSTRAINT ai_agent_users_email_not_empty
    CHECK (length(trim(email)) > 0),

  CONSTRAINT ai_agent_users_name_not_empty
    CHECK (length(trim(name)) > 0),

  CONSTRAINT ai_agent_users_failed_login_attempts_non_negative
    CHECK (failed_login_attempts >= 0),

  CONSTRAINT ai_agent_users_user_profile_allowed
    CHECK (
      user_profile IN (
        'admin',
        'diretoria',
        'financeiro',
        'auditoria',
        'comercial'
      )
    )
);

CREATE UNIQUE INDEX idx_ai_agent_users_email_unique
  ON public.ai_agent_users (lower(email));

CREATE INDEX idx_ai_agent_users_profile
  ON public.ai_agent_users (user_profile);

CREATE INDEX idx_ai_agent_users_active
  ON public.ai_agent_users (is_active);

CREATE TABLE public.ai_agent_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id uuid NOT NULL REFERENCES public.ai_agent_users(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  session_token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,

  ip_address text,
  user_agent text,

  CONSTRAINT ai_agent_sessions_token_hash_not_empty
    CHECK (length(trim(session_token_hash)) > 0)
);

CREATE UNIQUE INDEX idx_ai_agent_sessions_token_hash_unique
  ON public.ai_agent_sessions (session_token_hash);

CREATE INDEX idx_ai_agent_sessions_user_id
  ON public.ai_agent_sessions (user_id);

CREATE INDEX idx_ai_agent_sessions_active
  ON public.ai_agent_sessions (user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE public.ai_agent_auth_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  created_at timestamptz NOT NULL DEFAULT now(),

  user_id uuid REFERENCES public.ai_agent_users(id)
    ON UPDATE RESTRICT
    ON DELETE SET NULL,

  email text NOT NULL,
  event_type text NOT NULL,
  success boolean NOT NULL DEFAULT true,

  ip_address text,
  user_agent text,

  reason text,

  CONSTRAINT ai_agent_auth_events_email_not_empty
    CHECK (length(trim(email)) > 0),

  CONSTRAINT ai_agent_auth_events_event_type_not_empty
    CHECK (length(trim(event_type)) > 0)
);

CREATE INDEX idx_ai_agent_auth_events_user_created_at
  ON public.ai_agent_auth_events (user_id, created_at DESC);

CREATE INDEX idx_ai_agent_auth_events_email_created_at
  ON public.ai_agent_auth_events (lower(email), created_at DESC);

CREATE INDEX idx_ai_agent_auth_events_event_type
  ON public.ai_agent_auth_events (event_type);
