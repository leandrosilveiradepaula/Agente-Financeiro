CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.ai_agent_profile_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  profile text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text,

  is_active boolean NOT NULL DEFAULT true,

  can_generate_sql boolean NOT NULL DEFAULT true,
  can_execute_sql boolean NOT NULL DEFAULT true,
  can_view_sql boolean NOT NULL DEFAULT false,
  can_view_own_runs boolean NOT NULL DEFAULT true,
  can_view_all_runs boolean NOT NULL DEFAULT false,
  can_manage_users boolean NOT NULL DEFAULT false,
  can_view_admin_area boolean NOT NULL DEFAULT false,

  allowed_intents jsonb NOT NULL DEFAULT '[]'::jsonb,
  denied_intents jsonb NOT NULL DEFAULT '[]'::jsonb,

  allowed_tables jsonb NOT NULL DEFAULT '[]'::jsonb,
  denied_tables jsonb NOT NULL DEFAULT '[]'::jsonb,

  allowed_columns jsonb NOT NULL DEFAULT '{}'::jsonb,
  denied_columns jsonb NOT NULL DEFAULT '{}'::jsonb,

  required_filters jsonb NOT NULL DEFAULT '{}'::jsonb,

  max_rows integer DEFAULT 500,
  max_execution_time_ms integer DEFAULT 30000,

  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_profile_policies_profile
  ON public.ai_agent_profile_policies (profile);

CREATE INDEX IF NOT EXISTS idx_ai_agent_profile_policies_active
  ON public.ai_agent_profile_policies (is_active);

INSERT INTO public.ai_agent_profile_policies (
  profile,
  display_name,
  description,
  is_active,
  can_generate_sql,
  can_execute_sql,
  can_view_sql,
  can_view_own_runs,
  can_view_all_runs,
  can_manage_users,
  can_view_admin_area,
  allowed_intents,
  denied_intents,
  allowed_tables,
  denied_tables,
  max_rows,
  max_execution_time_ms,
  metadata,
  updated_at
)
VALUES
  (
    'admin',
    'Administrador',
    'Acesso administrativo completo ao agente financeiro.',
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    '["*"]'::jsonb,
    '[]'::jsonb,
    '["*"]'::jsonb,
    '[]'::jsonb,
    5000,
    60000,
    '{}'::jsonb,
    now()
  ),
  (
    'diretoria',
    'Diretoria',
    'Acesso executivo a indicadores e visões gerenciais.',
    true,
    true,
    true,
    false,
    true,
    false,
    false,
    false,
    '["dre_resumo","orcado_vs_realizado","opex_por_centro_custo","indicadores_gerenciais"]'::jsonb,
    '["lancamentos_contabeis_detalhados"]'::jsonb,
    '["dev_lakehouse.main_gold.gold_orcamento","dev_lakehouse.main_gold.gold_rateios_orcamentos","dev_lakehouse.main_gold.gold_lancamentos_contabeis","dev_lakehouse.main_gold.gold_rateios_lancamentos_contabeis","dev_lakehouse.main_gold.gold_centro_custo","dev_lakehouse.main_gold.gold_plano_contas","dev_lakehouse.main_gold.gold_unidade_negocio"]'::jsonb,
    '[]'::jsonb,
    500,
    30000,
    '{}'::jsonb,
    now()
  ),
  (
    'financeiro',
    'Financeiro',
    'Acesso financeiro operacional e analítico.',
    true,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    '["dre_resumo","dre_detalhada","orcado_vs_realizado","opex_por_centro_custo","lancamentos_contabeis_detalhados"]'::jsonb,
    '[]'::jsonb,
    '["dev_lakehouse.main_gold.gold_orcamento","dev_lakehouse.main_gold.gold_lancamentos_contabeis","dev_lakehouse.main_gold.gold_rateios_lancamentos_contabeis","dev_lakehouse.main_gold.gold_centro_custo","dev_lakehouse.main_gold.gold_plano_contas","dev_lakehouse.main_gold.gold_unidade_negocio"]'::jsonb,
    '[]'::jsonb,
    1000,
    30000,
    '{}'::jsonb,
    now()
  ),
  (
    'auditoria',
    'Auditoria',
    'Acesso amplo para auditoria e revisão das execuções.',
    true,
    true,
    true,
    true,
    true,
    true,
    false,
    true,
    '["*"]'::jsonb,
    '[]'::jsonb,
    '["dev_lakehouse.main_gold.gold_orcamento","dev_lakehouse.main_gold.gold_lancamentos_contabeis","dev_lakehouse.main_gold.gold_rateios_lancamentos_contabeis","dev_lakehouse.main_gold.gold_centro_custo","dev_lakehouse.main_gold.gold_plano_contas","dev_lakehouse.main_gold.gold_unidade_negocio"]'::jsonb,
    '[]'::jsonb,
    2000,
    30000,
    '{}'::jsonb,
    now()
  ),
  (
    'comercial',
    'Comercial',
    'Perfil sem acesso a geracao ou execucao de SQL nesta fase.',
    true,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
    '[]'::jsonb,
    '["*"]'::jsonb,
    '[]'::jsonb,
    '["*"]'::jsonb,
    0,
    0,
    '{}'::jsonb,
    now()
  )
ON CONFLICT (profile) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active,
  can_generate_sql = EXCLUDED.can_generate_sql,
  can_execute_sql = EXCLUDED.can_execute_sql,
  can_view_sql = EXCLUDED.can_view_sql,
  can_view_own_runs = EXCLUDED.can_view_own_runs,
  can_view_all_runs = EXCLUDED.can_view_all_runs,
  can_manage_users = EXCLUDED.can_manage_users,
  can_view_admin_area = EXCLUDED.can_view_admin_area,
  allowed_intents = EXCLUDED.allowed_intents,
  denied_intents = EXCLUDED.denied_intents,
  allowed_tables = EXCLUDED.allowed_tables,
  denied_tables = EXCLUDED.denied_tables,
  max_rows = EXCLUDED.max_rows,
  max_execution_time_ms = EXCLUDED.max_execution_time_ms,
  metadata = EXCLUDED.metadata,
  updated_at = now();
