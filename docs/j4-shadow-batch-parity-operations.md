# J4 — Auditoria operacional em lote de SQL oficial × Shadow

## Entrega

A rota autenticada `GET /api/admin/runs/parity-review?limit=10&offset=0` e a tela
`/admin/runs/parity-review` avaliam **registros oficiais históricos já persistidos**
versus tentativas Shadow correlacionadas, reutilizando as portas de leitura e
comparação existentes. A interface fica acessível a usuários com
`can_view_all_runs` **e** `can_view_sql`; a autorização é feita novamente
no servidor. Apenas `limit` (1–20) e `offset` são aceitos, com leitura paginada
e no máximo 3 runs em processamento simultâneo.

O backend recupera os registros oficiais do banco por escopo autenticado.
No modo tenant, restringe em SQL por `organization_id` e rejeita linhas de
outra organização na memória. Nunca aceita SQL, organização, principal,
identificadores Shadow ou listas de benchmark vindos da URL/browser.

Para cada registro:

1. Verificar primeiro a origem operacional registrada pelo BFF (`source=interface`, `metadata.operation=generate_sql`, `execution_status=generated|executed`); candidatos LangGraph, testes P2 e registros ambíguos NÃO são baselines oficiais. Esta marcação comprova apenas o caminho BFF, não o provedor/modelo ou paridade financeira. Depois, rejeitar SQL ou principal ausentes; classificar cache sem execução Gemini
   independente como inelegível.
2. Listar as tentativas Shadow pelo `agent_run_id` oficial autorizado;
   negar seleção de uma entre múltiplas gerações (ou páginas saturadas).
3. Selecionar somente uma tentativa `generate` concluída, sem reparo pendente.
4. Comparar SQL oficial gerada e SQL oficial executada **separadamente**, pela
   API de comparação já existente, que relê e verifica fingerprints do
   `ShadowRunRecord` e identidade/tenant/pergunta.
5. Classificar estrutura, divergências, proveniência Gemini/modelo,
   intenção, isolamento e reparos sem inventar baseline.
6. Retornar exclusivamente estados, contadores e IDs auditáveis, nunca SQL
   ou perguntas brutas; não acessar dados financeiros.

## Limites claros

- Não executa SQL financeira, não chama Gemini ou SQL-InfoDive, não altera
  registros/credenciais/workflows e não executa benchmark de 63 perguntas.
- Feature gate `LANGGRAPH_SHADOW_COMPARISON_ENABLED` mantém-se desativada
  até habilitação deliberada em backend autorizado. Nenhuma implantação
  ou mudança de configuração está implícita no merge.
- `structural_match` indica comparação normalizada rigorosa com proveniência
  de tenant/provedor/modelo/intenção. **Nunca** prova igualdade contábil,
  snapshot comum, equivalência econômica ou prontidão de cutover.
- Histórico pré-existente **não é benchmark cego congelado**. Os campos
  oficiais de modelo/organização podem estar vazios e devem aparecer como
  proveniência insuficiente, não preenchidos por dedução.
- `shadow_missing`, `shadow_ambiguous`, `comparison_unavailable` e
  divergências são estados verificáveis, não sucesso. A avaliação é por
  página; não extrapolar contagens da página ao universo inteiro.
- Dada a SOURCE temporariamente pausada, nenhuma consulta ou reativação
  dela é necessária para esta auditoria. O G5 segue independente.

## Homologação restante para J4

1. Persistir baseline oficial e evidências Shadow da **mesma pergunta**,
   com versões/modelos autorizados e identidade de tenant verificável.
2. Rodar a análise do conjunto congelado, sem mostrar benchmark ao gerador,
   incluindo perguntas inéditas e duas configurações materialmente distintas.
3. Autorizar separadamente execução SELECT com menor privilégio em snapshots
   comparáveis, comparar **resultados financeiros**, e guardar evidências.
4. Validar falha isolada do Shadow e rollback antes de cutover humano.

Este bloco torna **operável a avaliação em lote**, não conclui J4 por si só.

## Evidência atual e próximo gate (29/10/2026)

Auditoria read-only na DEMO: 41 registros históricos `source=interface`, 38 executados com SQL, todos sem provedor/modelo atestado, e 1 `shadow_p2_generate_only` com recibo de transporte, mas sem SQL oficial. Nenhum registro está vinculado à organização ativa. Há 0 propostas candidatas persistidas. **Não existe par oficial+Shadow com identidade e contexto completos para P3**: marcar `official_origin_unverified` para origem desconhecida ou candidata, e **não** forçar backfill nem inferir modelo/tenant do legado. A criação de novo par exige uma operação canário autorizada para a mesma pergunta/tenant, mantendo execução financeira bloqueada e preços de LLM sob gate separado. A paridade numérica continua sujeita a autorização própria para duas consultas SELECT em snapshot igual.
