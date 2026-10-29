-- G3 platform security. Seven existing authentication/policy/audit/run
-- tables are server-only and have NO supported browser/Data API consumers.
-- Prior to applying in an environment, verify the app's DATABASE_URL uses
-- the table owner or separately authorized direct-PostgreSQL service role.
-- Do not use this migration to grant or expand financial data privileges.
-- No personal records, business tables, n8n workflows, or tenants are changed.
BEGIN;

DO $legacy_api_lockdown$
DECLARE
  table_name text;
  api_role text;
  object_id oid;
  object_owner text;
  policy_count integer;
  names text[] := ARRAY[
    'ai_agent_account_audit_events',
    'ai_agent_admin_audit_events',
    'ai_agent_auth_events',
    'ai_agent_profile_policies',
    'ai_agent_runs',
    'ai_agent_sessions',
    'ai_agent_users'
  ];
BEGIN
  -- Preflight every table before the first permission change. Never silently
  -- skip a table or erase a pre-existing client-specific RLS policy.
  FOREACH table_name IN ARRAY names LOOP
    SELECT c.oid, pg_catalog.pg_get_userbyid(c.relowner),
           (SELECT count(*)::integer FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid)
      INTO object_id, object_owner, policy_count
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=table_name AND c.relkind='r';
    IF object_id IS NULL OR object_owner <> current_user OR policy_count <> 0 THEN
      RAISE EXCEPTION 'legacy_api_lockdown_preflight_rejected';
    END IF;
    IF NOT pg_catalog.has_table_privilege(current_user,object_id,'SELECT')
       OR NOT pg_catalog.has_table_privilege(current_user,object_id,'INSERT')
       OR NOT pg_catalog.has_table_privilege(current_user,object_id,'UPDATE')
    THEN
      RAISE EXCEPTION 'legacy_api_lockdown_server_privilege_missing';
    END IF;
  END LOOP;

  FOREACH table_name IN ARRAY names LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',table_name);
    FOR api_role IN
      SELECT rolname FROM pg_catalog.pg_roles
      WHERE rolname IN ('anon','authenticated','service_role')
    LOOP
      EXECUTE format(
        'REVOKE ALL ON TABLE public.%I FROM %I',table_name,api_role
      );
    END LOOP;
  END LOOP;

  -- The two candidate guard functions are SECURITY INVOKER, but Supabase
  -- default function ACLs explicitly granted EXECUTE to Data API roles.
  -- Only the owner needs to maintain them; these remain trigger-only.
  FOR api_role IN
    SELECT rolname FROM pg_catalog.pg_roles
    WHERE rolname IN ('anon','authenticated','service_role')
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.ai_agent_candidate_review_guard() FROM %I',
      api_role
    );
    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.ai_agent_candidate_execution_request_guard() FROM %I',
      api_role
    );
  END LOOP;

  -- Postcondition is in the same transaction: any grant inherited from
  -- PUBLIC/role memberships must fail closed and roll back all changes.
  FOREACH table_name IN ARRAY names LOOP
    SELECT c.oid INTO object_id FROM pg_catalog.pg_class c
    WHERE c.oid=format('public.%I',table_name)::regclass AND c.relrowsecurity;
    IF object_id IS NULL THEN
      RAISE EXCEPTION 'legacy_api_lockdown_rls_not_enabled';
    END IF;
    FOR api_role IN
      SELECT rolname FROM pg_catalog.pg_roles
      WHERE rolname IN ('anon','authenticated','service_role')
    LOOP
      IF pg_catalog.has_table_privilege(api_role,object_id,'SELECT')
        OR pg_catalog.has_table_privilege(api_role,object_id,'INSERT')
        OR pg_catalog.has_table_privilege(api_role,object_id,'UPDATE')
        OR pg_catalog.has_table_privilege(api_role,object_id,'DELETE')
        OR pg_catalog.has_table_privilege(api_role,object_id,'TRUNCATE')
      THEN
        RAISE EXCEPTION 'legacy_api_lockdown_inherited_grant_remains';
      END IF;
    END LOOP;
  END LOOP;
END
$legacy_api_lockdown$;
COMMIT;

-- The migration deliberately never changes default privileges for unrelated
-- schemas/tables. Rollback is a SEPARATE operator gate: a targeted regrant
-- and RLS review may reopen sensitive access and is not performed silently.
