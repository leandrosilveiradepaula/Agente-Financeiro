-- Opt-in tenant identity for the Product Shadow boundary.
-- File only: do not apply automatically. No organization, membership, session
-- selection, or historical run is created or backfilled by this migration.
BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_agent_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.ai_agent_user_organizations (
  user_id uuid NOT NULL REFERENCES public.ai_agent_users(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES public.ai_agent_organizations(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, organization_id)
);

ALTER TABLE public.ai_agent_sessions
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.ai_agent_organizations(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE public.ai_agent_runs
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.ai_agent_organizations(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_ai_agent_user_organizations_active_user
  ON public.ai_agent_user_organizations (user_id, organization_id)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_ai_agent_sessions_organization
  ON public.ai_agent_sessions (organization_id)
  WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_organization_created_at
  ON public.ai_agent_runs (organization_id, created_at DESC)
  WHERE organization_id IS NOT NULL;


-- Product reads these catalog/association tables through its authenticated
-- server-side PostgreSQL connection, never directly from a browser/Data API.
-- Supabase projects may grant ALL on new public tables to anon/authenticated
-- by default. Keep organizations and memberships private even on those
-- projects and independently of deployment-time tenant feature flags.
ALTER TABLE public.ai_agent_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_agent_user_organizations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.ai_agent_organizations,
  public.ai_agent_user_organizations
  FROM PUBLIC;

-- Portably revoke any pre-existing Supabase Data API role grants without
-- requiring the roles to exist in plain PostgreSQL installations.
DO $tenant_acl$
DECLARE
  api_role text;
BEGIN
  FOR api_role IN
    SELECT rolname
    FROM pg_catalog.pg_roles
    WHERE rolname IN ('anon', 'authenticated', 'service_role')
  LOOP
    EXECUTE format(
      'REVOKE ALL ON TABLE public.ai_agent_organizations, public.ai_agent_user_organizations FROM %I',
      api_role
    );
  END LOOP;
END
$tenant_acl$;

-- Deliberately no permissive RLS policies: only the server-side database
-- owner can manage memberships. Neither a JWT nor a browser request may
-- assign, enumerate, or modify an organization.

COMMIT;

-- Rollback (manual, after disabling AGENT_TENANT_IDENTITY_ENABLED and after a
-- reviewed data-retention decision): drop the indexes, columns, membership
-- table, then organization table in dependency order. Do not run implicitly.
