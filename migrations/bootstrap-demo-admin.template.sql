-- TEMPLATE OPERACIONAL.
-- NAO EXECUTAR COMO MIGRATION.
-- SOMENTE BANCO DEMO.
-- NAO VERSIONAR CREDENCIAIS REAIS.
-- Substituir placeholders apenas no momento da execucao controlada.

INSERT INTO public.ai_agent_users (
  name,
  email,
  user_profile,
  password_hash,
  is_active,
  failed_login_attempts,
  locked_until,
  password_changed_at,
  must_change_password,
  created_at,
  updated_at,
  last_admin_action_at
)
VALUES (
  :'admin_name',
  lower(:'admin_email'),
  'admin',
  crypt(:'temporary_password', gen_salt('bf')),
  true,
  0,
  NULL,
  now(),
  true,
  now(),
  now(),
  now()
);
