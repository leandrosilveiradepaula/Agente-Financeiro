# G3 — testemunha Shadow da SQL aprovada, sem execução financeira

O caminho auditável fica:

1. Pergunta autenticada → n8n candidato → LangGraph \`Generate\` → SQL.
2. Produto persiste proposta com hash/tenant/modelo/contexto.
3. Outra pessoa no mesmo tenant aprova exatamente o hash.
4. Operador registra \`Execute Approved intent\` com estado
   imutável \`pending_authorization\`, que **não autoriza execução**.
5. Novo \`POST /api/admin/candidate-execution-requests/[id]/shadow-validate\`
   reclama o intent **uma única vez** no banco, revalida identidade, tenant,
   estado, hash da pergunta, hash da SQL, binding e aprovação independente.
6. O Produto envia a SQL apenas para um **webhook n8n privado**
   \`/webhook/langgraph-candidate-approved-sql-shadow-v1\`.
   n8n encaminha ao LangGraph
   \`/v1/internal/sql-agent/execute-approved-shadow\` para checar gates,
   sem consultar a base financeira.
7. Resultado devolvido sem SQL/repair, com status, fingerprints e evidência
   de \`requires_reapproval\`. Produto grava uma só transição auditável:
   \`pending\` → \`success\`, \`rejected\` ou \`unavailable\`.
   Se repair foi proposto, a aprovação antiga é insuficiente e uma
   **nova geração e nova aprovação** são obrigatórias.

## Escopos e proteção

- Browser **não envia SQL, tenant, usuário nem fingerprint** à rota witness;
  envia exclusivamente POST vazio com o UUID do intent na URL.
- Uma única tentativa por intent: unique index + claim atômico. Falhas de
  transporte ambíguas requerem reconciliação humana; não repetir LLM
  automaticamente.
- Somente perfil admin com política ativa de ver SQL e executar SQL, sessão
  tenant selecionado e pinagem explícita do UUID do tenant.
- O workflow n8n precisa ser instalado como novo fluxo, **inativo** no
  repositório, sem tocar o n8n oficial. Credenciais do webhook Produto→n8n
  e da API LangGraph são independentes. Não imprimir no GitHub.
- As tabelas \`ai_agent_candidate_shadow_witnesses\` têm RLS ativo,
  Data API desautorizada, hash e tenant imutáveis, proibição de DELETE,
  atualização única pending→resultado e confirmação de gates.
- \`LANGGRAPH_ALLOW_REAL_SQL_EXECUTION=false\` deve ser atestado no
  runtime **antes** de habilitar
  \`AGENT_CANDIDATE_SHADOW_WITNESS_NO_EXECUTION_ATTESTED=true\`.
- O opt-in \`AGENT_CANDIDATE_SHADOW_WITNESS_ENABLED=true\` permanece
  **desligado por padrão**. Eventual reparo via provedor pago requer
  autorização de custo separada. Nenhum secret/configuração é ativado
  automaticamente no merge.

## Migração e rollout

A migration \`2026-10-29-candidate-shadow-witness.sql\` é apenas arquivo
até merge humano. Ensaio CI aplica o SQL em PostgreSQL descartável,
executa tenant→SQL→duas pessoas→intent→witness, valida imutabilidade,
não execução e ACLs. Aplicar na DEMO somente após merge autorizado e
validar catálogo/trigger/estado vazio/permits. Isso não permite ativar
n8n, Vercel, SQL read-only financeira nem cutover.

**Ainda faltam** homologação real do n8n candidato, contexto ativo
multicliente, evidência de Gemini real correlacionada, comparação
financeira autorizada e serviço verdadeiro de execução SELECT com
rollback. A rota testemunha confirma segurança e preflight,
**não executa** a SQL aprovada; uma resposta \`success\` nunca é paridade
financeira nem autorização de executar.

\`OFFICIAL=n8n\`; \`SHADOW=LangGraph\`; \`LANGGRAPH_ALLOW_REAL_SQL_EXECUTION=false\`.
