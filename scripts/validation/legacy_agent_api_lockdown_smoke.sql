-- Disposable PostgreSQL role-hardening test only.
-- PROHIBITED on DEMO, production, SOURCE or any non-fixture database.
DO $legacy_api_acl_smoke$
DECLARE
  name text;
  actor text;
  table_oid oid;
BEGIN
  IF current_database() <> 'tenant_candidate_ci_fixture'
     OR current_user <> 'tenant_ci' THEN
    RAISE EXCEPTION 'legacy_acl_smoke_only_disposable_ci';
  END IF;
  FOREACH name IN ARRAY ARRAY[
    'ai_agent_account_audit_events',
    'ai_agent_admin_audit_events',
    'ai_agent_auth_events',
    'ai_agent_profile_policies',
    'ai_agent_runs',
    'ai_agent_sessions',
    'ai_agent_users'
  ] LOOP
    SELECT c.oid INTO table_oid
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=name AND c.relkind='r'
        AND c.relrowsecurity;
    IF table_oid IS NULL THEN
      RAISE EXCEPTION 'legacy_acl_smoke_rls_missing: %',name;
    END IF;
    IF NOT has_table_privilege(current_user,table_oid,'SELECT')
       OR NOT has_table_privilege(current_user,table_oid,'INSERT')
       OR NOT has_table_privilege(current_user,table_oid,'UPDATE') THEN
      RAISE EXCEPTION 'legacy_acl_smoke_server_access_broken: %',name;
    END IF;
    FOREACH actor IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF has_table_privilege(actor,table_oid,'SELECT')
        OR has_table_privilege(actor,table_oid,'INSERT')
        OR has_table_privilege(actor,table_oid,'UPDATE')
        OR has_table_privilege(actor,table_oid,'DELETE')
        OR has_table_privilege(actor,table_oid,'TRUNCATE') THEN
        RAISE EXCEPTION 'legacy_acl_smoke_api_exposure: %, %',name,actor;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH actor IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(
         actor,'public.ai_agent_candidate_review_guard()','EXECUTE'
       ) OR has_function_privilege(
         actor,'public.ai_agent_candidate_execution_request_guard()','EXECUTE'
       ) THEN
      RAISE EXCEPTION 'legacy_acl_smoke_guard_acl: %',actor;
    END IF;
  END LOOP;
END
$legacy_api_acl_smoke$;

-- Actual role-switch denial is validated in the accompanying CI shell:
-- SET ROLE anon/authenticated/service_role, then SELECT from users/runs.
-- PostgreSQL owner can still access these tables and the candidate API.
