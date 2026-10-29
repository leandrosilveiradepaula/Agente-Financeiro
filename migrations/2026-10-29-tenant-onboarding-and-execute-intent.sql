-- Platform-only tenant onboarding + Execute Approved intent gate.
-- No client-specific context, no membership backfill, no financial SQL.
-- This file does not activate a workflow or authorize real execution.
BEGIN;

ALTER TABLE public.ai_agent_organizations
  ADD COLUMN IF NOT EXISTS display_name text;

DO $tenant_name_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.ai_agent_organizations'::regclass
      AND conname = 'ai_agent_organization_display_name'
  ) THEN
    ALTER TABLE public.ai_agent_organizations
      ADD CONSTRAINT ai_agent_organization_display_name
      CHECK (
        display_name IS NULL OR
        (length(btrim(display_name)) BETWEEN 3 AND 120
         AND display_name = btrim(display_name))
      );
  END IF;
END
$tenant_name_constraint$;

-- Historical tenant rows are never rewritten or automatically named.
-- New tenants receive a human-supplied name from a gated operator action.

CREATE TABLE IF NOT EXISTS public.ai_agent_candidate_execution_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL UNIQUE
    REFERENCES public.ai_agent_candidate_sql_reviews(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  organization_id uuid NOT NULL
    REFERENCES public.ai_agent_organizations(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  requested_by uuid NOT NULL
    REFERENCES public.ai_agent_users(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  binding_sha256 char(64) NOT NULL,
  sql_sha256 char(64) NOT NULL,
  state text NOT NULL DEFAULT 'pending_authorization'
    CHECK (state = 'pending_authorization'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT execution_request_digest_format CHECK (
    binding_sha256 ~ '^[0-9a-f]{64}$'
    AND sql_sha256 ~ '^[0-9a-f]{64}$'
  )
);

CREATE INDEX IF NOT EXISTS idx_candidate_execution_org_created
  ON public.ai_agent_candidate_execution_requests
  (organization_id, created_at DESC, id DESC);

-- A request for Execute Approved is not execution authorization.
-- The request may only be CREATED from a separately human-approved and
-- still-unmodified proposal; any update, delete, replay or repair
-- invalidates the next stage and never silently schedules SQL.
CREATE OR REPLACE FUNCTION public.ai_agent_candidate_execution_request_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $guard$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'candidate_execution_request_immutable';
  END IF;
  IF NEW.state <> 'pending_authorization'
    OR NOT EXISTS (
      SELECT 1
      FROM public.ai_agent_candidate_sql_reviews r
      JOIN public.ai_agent_runs run ON run.id = r.agent_run_id
      JOIN public.ai_agent_user_organizations member
        ON member.organization_id = NEW.organization_id
       AND member.user_id = NEW.requested_by
      JOIN public.ai_agent_organizations org
        ON org.id = member.organization_id
      JOIN public.ai_agent_users actor ON actor.id = member.user_id
      WHERE r.id = NEW.review_id
        AND r.organization_id = NEW.organization_id
        AND r.review_status = 'approved'
        AND r.decided_by IS NOT NULL
        AND r.decided_by <> r.requested_by
        AND r.decided_at IS NOT NULL
        AND r.binding_sha256 = NEW.binding_sha256
        AND r.sql_sha256 = NEW.sql_sha256
        AND run.organization_id = r.organization_id
        AND run.user_id = r.requested_by
        AND run.source = 'candidate_langgraph_generate_only'
        AND run.execution_status = 'generated'
        AND run.sql_generated = r.sql_text
        AND member.is_active AND org.is_active AND actor.is_active
    )
  THEN
    RAISE EXCEPTION 'candidate_execution_request_unqualified';
  END IF;
  RETURN NEW;
END;
$guard$;

REVOKE ALL ON FUNCTION public.ai_agent_candidate_execution_request_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS tr_candidate_execution_request_guard
  ON public.ai_agent_candidate_execution_requests;
CREATE TRIGGER tr_candidate_execution_request_guard
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.ai_agent_candidate_execution_requests
  FOR EACH ROW EXECUTE FUNCTION public.ai_agent_candidate_execution_request_guard();

ALTER TABLE public.ai_agent_candidate_execution_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_agent_candidate_execution_requests FROM PUBLIC;

DO $revoke_api$
DECLARE api_role text;
BEGIN
  FOR api_role IN
    SELECT rolname FROM pg_catalog.pg_roles
    WHERE rolname IN ('anon','authenticated','service_role')
  LOOP
    EXECUTE format(
      'REVOKE ALL ON TABLE public.ai_agent_candidate_execution_requests FROM %I',
      api_role
    );
  END LOOP;
END
$revoke_api$;

-- No RLS allow policies: this is a server-owned audit/intent queue.
-- Migration does not create any tenant, member, executor, approval or run.
COMMIT;
