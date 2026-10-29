-- J3: durable, private and immutable SQL proposals for the LangGraph candidate.
-- FILE ONLY. Explicit migration approval and a tested rollback are required
-- before applying on DEMO or any other database. No financial SQL execution.
-- Requires the previously approved tenant-identity-shadow-runs migration.
BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_agent_candidate_sql_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_run_id uuid NOT NULL UNIQUE REFERENCES public.ai_agent_runs(id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    organization_id uuid REFERENCES public.ai_agent_organizations(id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    requested_by uuid NOT NULL REFERENCES public.ai_agent_users(id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    langgraph_run_id text NOT NULL,
    sql_text text NOT NULL,
    sql_sha256 char(64) NOT NULL,
    question_sha256 char(64) NOT NULL,
    context_version text NOT NULL,
    response_fingerprint char(64) NOT NULL,
    provider_key text NOT NULL,
    model_key text NOT NULL,
    config_version text NOT NULL,
    binding_sha256 char(64) NOT NULL,
    review_status text NOT NULL DEFAULT 'pending'
      CHECK (review_status IN ('pending', 'approved', 'rejected')),
    decided_by uuid REFERENCES public.ai_agent_users(id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT candidate_sql_text_size CHECK (octet_length(sql_text) BETWEEN 1 AND 262144),
    CONSTRAINT candidate_sql_digest CHECK (
      sql_sha256 ~ '^[0-9a-f]{64}$'
      AND question_sha256 ~ '^[0-9a-f]{64}$'
      AND response_fingerprint ~ '^[0-9a-f]{64}$'
      AND binding_sha256 ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT candidate_identity_nonblank CHECK (
      length(btrim(langgraph_run_id)) BETWEEN 1 AND 128
      AND length(btrim(context_version)) BETWEEN 1 AND 128
      AND length(btrim(provider_key)) BETWEEN 1 AND 128
      AND length(btrim(model_key)) BETWEEN 1 AND 128
      AND length(btrim(config_version)) BETWEEN 1 AND 128
    ),
    CONSTRAINT candidate_review_decision_consistent CHECK (
      (review_status = 'pending' AND decided_at IS NULL AND decided_by IS NULL)
      OR
      (review_status <> 'pending' AND decided_at IS NOT NULL AND decided_by IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_candidate_reviews_org_created
  ON public.ai_agent_candidate_sql_reviews(organization_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_candidate_reviews_owner_created
  ON public.ai_agent_candidate_sql_reviews(requested_by, created_at DESC, id DESC);

-- Database-level invariant: the only legal update is ONE pending->decided
-- transition, with immutable SQL/identity/context/model/hash. Changing SQL
-- requires generating a NEW agent_run_id and new proposal + human review.
CREATE OR REPLACE FUNCTION public.ai_agent_candidate_review_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog
AS $candidate_guard$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'candidate_review_delete_forbidden';
  END IF;
  IF (
      NEW.id, NEW.agent_run_id, NEW.organization_id, NEW.requested_by,
      NEW.langgraph_run_id, NEW.sql_text, NEW.sql_sha256,
      NEW.question_sha256, NEW.context_version, NEW.response_fingerprint,
      NEW.provider_key, NEW.model_key, NEW.config_version,
      NEW.binding_sha256, NEW.created_at
  ) IS DISTINCT FROM (
      OLD.id, OLD.agent_run_id, OLD.organization_id, OLD.requested_by,
      OLD.langgraph_run_id, OLD.sql_text, OLD.sql_sha256,
      OLD.question_sha256, OLD.context_version, OLD.response_fingerprint,
      OLD.provider_key, OLD.model_key, OLD.config_version,
      OLD.binding_sha256, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'candidate_review_identity_immutable';
  END IF;
  IF OLD.review_status <> 'pending'
     OR NEW.review_status NOT IN ('approved', 'rejected')
     OR NEW.decided_by IS NULL OR NEW.decided_at IS NULL THEN
    RAISE EXCEPTION 'candidate_review_invalid_transition';
  END IF;
  RETURN NEW;
END;
$candidate_guard$;

REVOKE ALL ON FUNCTION public.ai_agent_candidate_review_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS tr_candidate_review_guard
  ON public.ai_agent_candidate_sql_reviews;
CREATE TRIGGER tr_candidate_review_guard
  BEFORE UPDATE OR DELETE ON public.ai_agent_candidate_sql_reviews
  FOR EACH ROW EXECUTE FUNCTION public.ai_agent_candidate_review_guard();

-- Deny direct browser access even when the Supabase project exposes public
-- and legacy default privileges grant all new tables to Data API roles.
ALTER TABLE public.ai_agent_candidate_sql_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_agent_candidate_sql_reviews FROM PUBLIC;

DO $revoke_candidate_api_roles$
DECLARE
  api_role text;
BEGIN
  FOR api_role IN
    SELECT rolname FROM pg_catalog.pg_roles
    WHERE rolname IN ('anon', 'authenticated', 'service_role')
  LOOP
    EXECUTE format(
      'REVOKE ALL ON TABLE public.ai_agent_candidate_sql_reviews FROM %I',
      api_role
    );
  END LOOP;
END
$revoke_candidate_api_roles$;

-- No permissive RLS policy. Server-side PostgreSQL owner accesses this table
-- only through authenticated Next.js routes and tenant-bounded SQL predicates.
-- Explicitly no migration backfill, no default tenant, no approval, no execution.
COMMIT;
