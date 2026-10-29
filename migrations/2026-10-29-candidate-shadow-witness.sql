-- G3: one auditable, validation-only Shadow witness for an already
-- human-approved SQL and an existing pending_authorization intent.
-- No SQL execution, no financial data access, no auto-approval or repair.
BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_agent_candidate_shadow_witnesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_request_id uuid NOT NULL UNIQUE
    REFERENCES public.ai_agent_candidate_execution_requests(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  organization_id uuid NOT NULL
    REFERENCES public.ai_agent_organizations(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES public.ai_agent_users(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  agent_run_id uuid NOT NULL REFERENCES public.ai_agent_runs(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  binding_sha256 char(64) NOT NULL CHECK(binding_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','success','rejected','unavailable')),
  langgraph_run_id text,
  response_fingerprint char(64),
  requires_reapproval boolean NOT NULL DEFAULT false,
  security_status text,
  contract_status text,
  preflight_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT candidate_witness_terminal_shape CHECK (
    (status='pending' AND completed_at IS NULL
      AND langgraph_run_id IS NULL AND response_fingerprint IS NULL
      AND security_status IS NULL AND contract_status IS NULL
      AND preflight_status IS NULL AND requires_reapproval=false)
    OR
    (status IN ('success','rejected') AND completed_at IS NOT NULL
      AND length(btrim(langgraph_run_id)) BETWEEN 1 AND 128
      AND response_fingerprint ~ '^[0-9a-f]{64}$'
      AND security_status IS NOT NULL AND contract_status IS NOT NULL
      AND preflight_status IS NOT NULL)
    OR
    (status='unavailable' AND completed_at IS NOT NULL
      AND langgraph_run_id IS NULL AND response_fingerprint IS NULL
      AND requires_reapproval=false)
  ),
  CONSTRAINT candidate_witness_success_gate CHECK (
    status<>'success' OR (
      requires_reapproval=false AND security_status='approved'
      AND contract_status='approved' AND preflight_status='approved'
    )
  )
);
CREATE INDEX IF NOT EXISTS idx_candidate_witness_org_created
ON public.ai_agent_candidate_shadow_witnesses(organization_id,created_at DESC,id DESC);

CREATE OR REPLACE FUNCTION public.ai_agent_shadow_witness_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $guard$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'candidate_witness_delete_forbidden';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'pending'
      OR NOT EXISTS (
        SELECT 1 FROM public.ai_agent_candidate_execution_requests req
        JOIN public.ai_agent_candidate_sql_reviews review ON review.id=req.review_id
        JOIN public.ai_agent_runs run ON run.id=review.agent_run_id
        JOIN public.ai_agent_user_organizations member
          ON member.organization_id=req.organization_id
         AND member.user_id=NEW.actor_id AND member.is_active
        JOIN public.ai_agent_organizations org ON org.id=req.organization_id
          AND org.is_active
        JOIN public.ai_agent_users actor ON actor.id=member.user_id
          AND actor.is_active
        WHERE req.id=NEW.execution_request_id
          AND req.organization_id=NEW.organization_id
          AND req.state='pending_authorization'
          AND req.binding_sha256=NEW.binding_sha256
          AND review.binding_sha256=NEW.binding_sha256
          AND review.sql_sha256=req.sql_sha256
          AND review.organization_id=req.organization_id
          AND review.review_status='approved'
          AND review.decided_by<>review.requested_by
          AND review.decided_at IS NOT NULL
          AND run.id=NEW.agent_run_id
          AND run.id=review.agent_run_id
          AND run.organization_id=review.organization_id
          AND run.user_id=review.requested_by
          AND run.sql_generated=review.sql_text
          AND run.source='candidate_langgraph_generate_only'
          AND run.execution_status='generated'
      )
    THEN
      RAISE EXCEPTION 'candidate_witness_unqualified';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id,NEW.execution_request_id,NEW.organization_id,NEW.actor_id,
      NEW.agent_run_id,NEW.binding_sha256,NEW.created_at) IS DISTINCT FROM
     (OLD.id,OLD.execution_request_id,OLD.organization_id,OLD.actor_id,
      OLD.agent_run_id,OLD.binding_sha256,OLD.created_at)
     OR OLD.status<>'pending' OR NEW.status='pending'
     OR NEW.completed_at IS NULL THEN
    RAISE EXCEPTION 'candidate_witness_invalid_transition';
  END IF;
  RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION public.ai_agent_shadow_witness_guard() FROM PUBLIC;
DO $revoke_fn$
DECLARE api_role text;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_catalog.pg_roles
    WHERE rolname IN ('anon','authenticated','service_role')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.ai_agent_shadow_witness_guard() FROM %I',api_role);
  END LOOP;
END
$revoke_fn$;
DROP TRIGGER IF EXISTS tr_candidate_shadow_witness_guard
 ON public.ai_agent_candidate_shadow_witnesses;
CREATE TRIGGER tr_candidate_shadow_witness_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.ai_agent_candidate_shadow_witnesses
FOR EACH ROW EXECUTE FUNCTION public.ai_agent_shadow_witness_guard();

ALTER TABLE public.ai_agent_candidate_shadow_witnesses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_agent_candidate_shadow_witnesses FROM PUBLIC;
DO $revoke_api$
DECLARE api_role text;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_catalog.pg_roles
    WHERE rolname IN ('anon','authenticated','service_role')
  LOOP
    EXECUTE format(
      'REVOKE ALL ON TABLE public.ai_agent_candidate_shadow_witnesses FROM %I',
      api_role
    );
  END LOOP;
END
$revoke_api$;

-- No policies allow Data API reads; the server owner performs the narrow
-- writes. No table can authorize actual financial execution.
COMMIT;
