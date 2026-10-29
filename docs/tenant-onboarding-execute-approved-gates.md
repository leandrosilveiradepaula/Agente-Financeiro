# G3 / G4 — operador de tenant e preparação de Execute Approved

Esta entrega fecha o **caminho de preparação operacional** que faltava após a
migração de aprovação persistente já aplicada na DEMO.

## O que o Produto passa a fazer

- Um administrador **explicitamente autorizado por identidade** e feature
  flag cria a primeira organização com **nome digitado** e confirmação
  literal `CREATE-INITIAL-ORGANIZATION`. A operação é serializada
  transacionalmente e bloqueada se já existir qualquer organização.
- O criador recebe vínculo ativo, a sessão atual seleciona esse tenant, e a
  ação entra no histórico administrativo na mesma transação. Nenhum cliente,
  grupo econômico, conta, benchmark, SQL, contexto financeiro ou
  `organization_id` é presumido pelo código.
- Administradores autorizados podem adicionar **usuários existentes** à
  organização já selecionada, com checagem da associação do administrador
  e auditoria atômica. Vínculo desativado não é reativado via upsert.
- Após uma SQL candidata ser persistida e aprovada por **outro** administrador
  no mesmo tenant, o Produto pode **solicitar** uma execução.
  A solicitação tem hash da SQL, binding da aprovação, tenant, identidade,
  estado imutável `pending_authorization`, UNIQUE(review_id) e bloqueio de
  acesso pela Data API.
- O motor não recebe nenhum SQL a partir da solicitação. A rota retorna
  `real_sql_executed=false` e `execution_authorized=false`.
  **NÃO existe execução financeira nesta etapa.**
- A operação oficial de n8n permanece igual. O executor legado já bloqueia
  fontes `candidate_langgraph_generate_only`. Para SQL reparada,
  exige-se nova proposta e novo ciclo de aprovação humana.

## Variáveis de configuração — todas default-off

`AGENT_TENANT_IDENTITY_ENABLED=true` é pré-requisito; a migration de
identidade deve estar instalada. Para criar a primeira organização, definir
temporariamente `AGENT_TENANT_INITIAL_BOOTSTRAP_ENABLED=true` e
`AGENT_TENANT_BOOTSTRAP_ACTOR_ID=<UUID real do admin autenticado>`.
**Não criar tenant automaticamente.** Após o cadastro explícito,
voltar a flag de bootstrap a false.

`AGENT_TENANT_MEMBERSHIP_ADMIN_ENABLED=true` libera a administração
de membros apenas para perfis habilitados em `can_manage_users`.
Usuários pertencem somente ao tenant selecionado, não ao nome da
organização informado no browser.

`AGENT_CANDIDATE_EXECUTION_REQUEST_ENABLED=true` permite registrar
somente pedidos `pending_authorization`; exige também
`AGENT_CANDIDATE_REVIEW_ENABLED=true`, um tenant já selecionado,
`AGENT_CANDIDATE_AUTHORIZED_ORGANIZATION_ID` correspondente e
`can_execute_sql` + `can_view_sql` + perfil admin. A rota nunca
aceita SQL, versão, tenant ou ID do usuário via corpo; aceita apenas o
fingerprint completo da aprovação já persistida.

Esta flag **não** define `LANGGRAPH_ALLOW_REAL_SQL_EXECUTION` e não
habilita o executor. A transição para SQL real exige contrato separado,
assinatura do request aprovado, transação read-only sob role de menor
privilégio, limites de recursos, execução em n8n, validação por contexto
e rollback humano independente.

## Dependências e implantação

1. Migration file-only `2026-10-29-tenant-onboarding-and-execute-intent.sql`
   antes do deployment correspondente; sem backfill ou atribuição de clientes.
2. Criar a organização e os vínculos pelo Produto **somente após
   identificação explícita do operador e nome escolhido**.
   Em 29/10/2026 a DEMO tinha 0 organizações, 0 memberships e 1 usuário.
3. O tenant precisa de contexto semântico versionado e conector financeiro
   autorizado, não criado automaticamente no bootstrap.
4. Executar primeiro o teste PostgreSQL descartável do CI e depois
   homologação humana de geração/SQL/aprovação com pelo menos duas
   identidades reais autorizadas; não substituir mock por prova financeira.
5. Execução read-only real permanece gate separado, não incluído nesta PR.

## Segurança preexistente — não ignorar

A auditoria Supabase da DEMO revelou **sete tabelas legadas do schema
`public` sem RLS e com privilégios Data API**. O novo ledger de intents
é RLS-on e tem `REVOKE` para papéis REST. As sete tabelas antigas não são
alteradas nesta migration. Antes de ativar o Produto com dados reais,
reconciliar uso de `anon`, `authenticated`, `service_role` e
`DATABASE_URL` e preparar uma migration separada que preserve dependências
autorizadas. Não executar `ALTER TABLE ENABLE ROW LEVEL SECURITY` em
produção sem ensaio de policies/ACL e rollback.
