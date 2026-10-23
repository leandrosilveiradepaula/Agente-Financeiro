-- Only a disposable PostgreSQL CI service may execute this fixture.
-- No production connection, real customer row or financial query is used.
DO $guard$
BEGIN
  IF current_database() <> 'tenant_ci_fixture'
     OR current_user <> 'tenant_ci' THEN
    RAISE EXCEPTION 'tenant migration rehearsal database identity mismatch';
  END IF;
END
$guard$;

-- Historical rows exist BEFORE the additive organization schema.
INSERT INTO public.ai_agent_users (
  id, name, email, user_profile, password_hash
) VALUES (
  '33333333-3333-4333-8333-333333333333',
  'Synthetic Tenant A User',
  'tenant-a@invalid.example',
  'auditoria',
  'synthetic-fixture-not-a-password-hash'
);

INSERT INTO public.ai_agent_runs (
  id, user_id, pergunta, execution_status
) VALUES (
  '77777777-7777-4777-8777-777777777777',
  '33333333-3333-4333-8333-333333333333',
  'Legacy synthetic question, not a financial benchmark',
  'generated'
);
