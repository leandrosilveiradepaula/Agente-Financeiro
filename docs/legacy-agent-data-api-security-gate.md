# Segurança do Produto Financeiro — restringir tabelas legadas da Data API

## Impacto confirmado na DEMO em 29/10/2026

No Supabase \`cenhadslwxgykqtuobgc\`, uma auditoria catalogal em
\`pg_catalog\` confirmou **sete tabelas** legadas com RLS desligado,
sem policies e com SELECT e DML acessíveis aos papéis
\`anon\`, \`authenticated\` e \`service_role\`: usuários, sessões,
execuções, políticas, eventos de login e auditoria.

- Todas as sete tabelas são owned pelo papel \`postgres\`, que tem
  \`BYPASSRLS\` e é a identidade da migration. A aplicação Next.js deste
  repositório utiliza \`pg.Pool(DATABASE_URL)\` diretamente, **não** usa
  \`supabase-js\`/API REST para suas operações de autenticação e histórico.
- A amostra dos últimos 24h do Supabase registrou 20 eventos PostgREST,
  mas zero com \`ai_agent_\` no path observado. Isto **não prova** que
  qualquer consumidor externo, n8n ou serviço legado nunca use a Data API.
- As organizações, memberships, propostas e intents novos já têm RLS ativo
  e Data API bloqueada. O escopo desta migração é **somente** as sete
  tabelas legadas, mais as duas funções de guarda SQL de trigger.
- As funções de trigger têm \`SECURITY INVOKER\`. Embora REVOKE FROM PUBLIC
  já estivesse aplicado, os grants de \`EXECUTE\` diretos aos papéis REST
  permaneceram; esta migration remove apenas esses grants.

## Migration

\`migrations/2026-10-29-lockdown-legacy-agent-data-api.sql\`

Toda a operação ocorre numa transação. Antes de mudar permissões,
verifica **cada uma** das sete tabelas, owner atual, direitos diretos
do owner e ausência de policies preexistentes. Se houver drift, a
transação inteira falha: não desliga políticas de terceiros nem pula
objetos. Liga RLS sem policies permissivas e revoga \`ALL\` de
\`PUBLIC\`, \`anon\`, \`authenticated\` e \`service_role\`.

Ao final da própria transação, verifica que RLS e denials estão
realmente presentes. Não altera default grants para outras tabelas,
dados financeiros, contextos semânticos ou identidades de clientes.
É idempotente para o esquema esperado.

**Critério de segurança:** um consumidor REST anteriormente autorizado
com \`anon\` ou \`authenticated\` terá o acesso recusado; o mesmo
ocorre com \`service_role\` para estas sete tabelas (intencionalmente).
A aplicação que autentica via PostgreSQL direto como proprietário
continua acessando os mesmos dados e com os mesmos direitos.

## Prova e rollout

O workflow \`demo-tenant-postgres-rehearsal.yml\` configura as sete
tabelas e simula grants amplos equivalentes ao caso real em um banco
descartável independente. Aplica a migration duas vezes, confere
RLS/ACL das sete tabelas, funções de guarda e \`SET ROLE\` real,
depois executa o ciclo de criação de tenant, membership, SQL candidata,
aprovação independente e pedido Execute Approved. Nenhuma SQL financeira
é disparada.

Após CI e merge humano, a aplicação na DEMO é autorizada somente
no escopo do Supabase DEMO; validar imediatamente os metadados
catalogais, os sete denials e os owners, e consultar os advisors
de segurança. Verificar a disponibilidade da aplicação com
\`DATABASE_URL\` autorizado; **não** ativar execução real.

## Volta segura

Se alguma integração REST legítima tiver dependência oculta, bloquear
a integração e diagnosticar seu papel antes de reabrir acesso.
Qualquer recuperação de GRANTs/RLS exige decisão humana específica,
escopo mínimo de tabela e papel, recálculo de superfície exposta e
registro de mudança. **Jamais** reativar \`GRANT ALL\` público
automaticamente apenas para mascarar uma falha de consumidor.
As demais migrações de identidade e aprovação permanecem intactas.

## Limites

Esta correção **não prova paridade de valores financeiros**, não
habilita tenant na Vercel, não altera n8n, não executa SQL, não
substitui o plano Shadow nem cutover. Permanece
\`OFFICIAL=n8n\`, \`SHADOW=LangGraph\`,
\`LANGGRAPH_ALLOW_REAL_SQL_EXECUTION=false\`.
