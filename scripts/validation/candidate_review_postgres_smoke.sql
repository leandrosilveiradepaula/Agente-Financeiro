-- Only run against isolated tenant_ci_fixture in CI, never production.
BEGIN;
DO $candidate_smoke$
DECLARE
  candidate_run uuid := gen_random_uuid();
  candidate_org uuid := gen_random_uuid();
  candidate_creator uuid := gen_random_uuid();
  candidate_reviewer uuid := gen_random_uuid();
  candidate_id uuid;
  candidate_sql text := 'SELECT metric FROM synthetic_catalog';
  raised boolean;
BEGIN
  IF current_database() <> 'tenant_ci_fixture' THEN
    RAISE EXCEPTION 'candidate_ci_database_required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public'
      AND c.relname='ai_agent_candidate_sql_reviews'
      AND c.relrowsecurity=true
  ) THEN
    RAISE EXCEPTION 'candidate_rls_missing';
  END IF;
  IF has_table_privilege('anon','public.ai_agent_candidate_sql_reviews','SELECT')
    OR has_table_privilege('authenticated','public.ai_agent_candidate_sql_reviews','SELECT')
    OR has_table_privilege('service_role','public.ai_agent_candidate_sql_reviews','SELECT')
  THEN
    RAISE EXCEPTION 'candidate_api_role_exposure';
  END IF;

  INSERT INTO public.ai_agent_users(id,name,email,user_profile,password_hash)
  VALUES
    (candidate_creator,'Creator','creator-candidate@fixture.invalid','admin','synthetic'),
    (candidate_reviewer,'Reviewer','reviewer-candidate@fixture.invalid','admin','synthetic');
  INSERT INTO public.ai_agent_organizations(id) VALUES(candidate_org);
  INSERT INTO public.ai_agent_user_organizations(user_id,organization_id)
  VALUES (candidate_creator,candidate_org),(candidate_reviewer,candidate_org);
  INSERT INTO public.ai_agent_runs (
    id,user_id,organization_id,pergunta,sql_generated,execution_status,source
  ) VALUES (
    candidate_run,candidate_creator,candidate_org,'Synthetic original',
    candidate_sql,'generated','candidate_langgraph_generate_only'
  );
  INSERT INTO public.ai_agent_candidate_sql_reviews (
    agent_run_id,organization_id,requested_by,langgraph_run_id,
    sql_text,sql_sha256,question_sha256,context_version,
    response_fingerprint,provider_key,model_key,config_version,binding_sha256
  ) VALUES (
    candidate_run,candidate_org,candidate_creator,'synthetic-langgraph',
    candidate_sql,encode(digest(candidate_sql,'sha256'),'hex'),
    encode(digest('Synthetic original','sha256'),'hex'),'synthetic-context',
    repeat('a',64),'synthetic-provider','synthetic-model','synthetic-config',repeat('b',64)
  ) RETURNING id INTO candidate_id;

  raised := false;
  BEGIN
    UPDATE public.ai_agent_candidate_sql_reviews
    SET sql_text='SELECT altered_sql' WHERE id=candidate_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'candidate_review_identity_immutable' THEN RAISE; END IF;
    raised := true;
  END;
  IF NOT raised THEN RAISE EXCEPTION 'candidate_sql_mutation_accepted'; END IF;

  UPDATE public.ai_agent_candidate_sql_reviews
  SET review_status='approved',decided_by=candidate_reviewer,decided_at=now()
  WHERE id=candidate_id;
  raised := false;
  BEGIN
    UPDATE public.ai_agent_candidate_sql_reviews
    SET review_status='rejected',decided_by=candidate_creator,decided_at=now()
    WHERE id=candidate_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'candidate_review_invalid_transition' THEN RAISE; END IF;
    raised := true;
  END;
  IF NOT raised THEN RAISE EXCEPTION 'candidate_reapproval_accepted'; END IF;

  raised := false;
  BEGIN
    DELETE FROM public.ai_agent_candidate_sql_reviews WHERE id=candidate_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'candidate_review_delete_forbidden' THEN RAISE; END IF;
    raised := true;
  END;
  IF NOT raised THEN RAISE EXCEPTION 'candidate_review_deletion_accepted'; END IF;
END
$candidate_smoke$;
ROLLBACK;
