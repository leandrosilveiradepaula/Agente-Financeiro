# Gate G1 — Demo Finance: n8n Parallel Shadow (contrato v1)

**Estado em 2026-10-22:** integração sintética dos **sete nós** confirmada
pelo operador no workflow n8n `LwUsMRWi34D2ARWu1YzgV`. Webhook,
autenticação S2S, rejeição intencional pré-LLM, persistência, leitura
e `Assert Shadow Evidence` passaram com `correlated: true` e
`agent_run_id=g1-final-ec6ce53d6a8543d5925e58609383ef9b`.
Isto **não** atesta geração real Produto -> n8n ou paridade financeira.
O fluxo n8n + Gemini oficial permanece inalterado.

## Fluxos, sem troca implícita

| Modo configurado | Destino | Autenticação | Resposta exigida |
|---|---|---|---|
| `direct` (legado) | LangGraph S2S | `Authorization: Bearer` | HTTP 2xx |
| `n8n_relay` (legado) | Relay HTTPS existente | `Authorization: Bearer` | `relay_status=accepted`, `agent_run_id` |
| `n8n` (novo) | Workflow **paralelo** n8n de sete nós | `X-Agent-Shadow-Token` | HTTP **202**, `contract_version=1`, `accepted=true`, `agent_run_id` e `event` exatos |

A implementação `n8n` deve ser usada com
`agente-sql-langgraph/scripts/n8n/parallel_langgraph_shadow_v1.workflow.json`
na versão que preserva o `llm_selection` opcional. Não reutilizar o relay
antigo nem apontar o webhook para o workflow financeiro oficial.

O Produto continua a enviar a pergunta ao n8n oficial e só agenda o Shadow
separadamente após as validações normais. O Body e o status da resposta oficial
não dependem do sucesso do Shadow.

## Configuração no backend da Demo (server-only)

```text
LANGGRAPH_SHADOW_ENABLED=false
LANGGRAPH_SHADOW_TRANSPORT=n8n
LANGGRAPH_SHADOW_N8N_WEBHOOK_URL=https://<host-autorizado>/webhook/langgraph-shadow-parallel-v1
N8N_SHADOW_WEBHOOK_TOKEN=<segredo-separado-do-S2S-LangGraph>
```

Inicialmente manter `LANGGRAPH_SHADOW_ENABLED=false`. O endpoint exige HTTPS,
hostname não local, sem credenciais embutidas, query string nem redirects.
Esse modo **não** usa `LANGGRAPH_S2S_TOKEN` no pedido Produto → n8n.
O próprio n8n utiliza sua credencial S2S separada em n8n → LangGraph.

O workflow paralelo requer importação **como novo workflow**, credenciais
Header Auth nos nós autorizados e
`LANGGRAPH_SHADOW_INTERNAL_BASE_URL` alcançável pelo n8n. Não copiar
credenciais de outro workflow nem alterá-lo. O JSON do candidato é inativo.

## Versão do motor e provedor

- LangGraph Shadow TEST deve permanecer `LANGGRAPH_ALLOW_REAL_SQL_EXECUTION=false`
  e com `SEMANTIC_AGENT_VERSION` previamente homologada.
- A seleção versionada `llm_selection` do Produto deve chegar **inalterada**
  ao LangGraph via n8n; nenhum nó n8n seleciona o provedor ou reinterpreta
  configurações. O registro do LangGraph valida identidades e permissões.
- Durante a **Fase 1**, verificar que ambos os caminhos usaram Gemini
  equivalente, comparando os identificadores reais de provedor/modelo/
  configuração na evidência. A escolha do operador não é autorização
  implícita para mudar para outro provedor.
- `202 accepted` comprova apenas recebimento da solicitação. Nunca marcar
  SQL gerada, modelo correto ou paridade como comprovados a partir disso.

## Evidência necessária para concluir G1

Com uma solicitação de teste autorizada e correlação por identificador,
confrontar separadamente:

1. Execução oficial e `agent_run_id` persistidos no Produto;
2. HTTP 202 do webhook Shadow com `agent_run_id` e `event` idênticos;
3. POST interno para LangGraph com autenticação S2S e resposta de processamento;
4. Busca da evidência persistida com `agent_run_id`, `run_id`,
   `shadow_record_id` único e contexto/versionamento;
5. Provider/model e status reais, erros, tempos e aprovação dos gates;
6. Comparação **pós-geração** sem incluir SQL oficial, respostas esperadas ou
   benchmark no planejamento ou no prompt.

A evidência do workflow oficial não deve ser usada como instrução de geração.
A paridade **numérica** exige autorização posterior de execução somente leitura,
isolada e com menor privilégio. A resposta oficial continua no n8n até
cutover explicitamente autorizado.

## Rollback

Desabilitar apenas `LANGGRAPH_SHADOW_ENABLED` na configuração do Produto
interrompe novos disparos; não modifica n8n oficial nem cancela automaticamente
execuções Shadow já aceitas. Qualquer mudança de produção, credencial,
publicação do n8n ou ativação do Shadow exige autorização separada.

## Preparação da integração Produto -> n8n (levantamento 2026-10-22)

- A Demo Vercel foi observada READY no SHA `687447c8314d6706d9853fc595a262316afeb3ca` da branch `demo/grupo-horizonte`. READY não equivale a CI ou Shadow ativo.
- Inventário server-only (sem descriptografar segredos): `LANGGRAPH_SHADOW_N8N_WEBHOOK_URL` cadastrada em production, `LANGGRAPH_SHADOW_TRANSPORT` ausente e `N8N_SHADOW_WEBHOOK_TOKEN` ausente. O valor da flag sensível `LANGGRAPH_SHADOW_ENABLED` não foi atestado. Não ativar implicitamente.
- Token Webhook v2 foi exposto em screenshot anterior e deve ser rotacionado **na credencial existente** antes do próximo teste público. O novo token separado deve ser provisionado no backend da Demo após autorização. O S2S n8n -> LangGraph foi corrigido, não precisa de nova rotação.
- Fase 1: o Produto só permite dispatch quando a seleção versionada (provider_key, model_key, config_version) do Shadow corresponde exatamente à seleção oficial. Não pressupõe nomes de modelos ou regras de cliente. Provedores diferentes ficam cadastrados, porém indisponíveis para comparações antes da Fase 3 autorizada.
- Na verificação, o GitHub Actions `Demo Shadow transport offline` do SHA acima terminou `failure` em cerca de quatro segundos e não disponibilizou logs de execução pelo conector; a causa **não** foi estabelecida. Investigar runners/limites e rodar CI antes de homologar.
- Próximos gates: rotação Webhook, variáveis server-only completas, decisão operacional explícita de habilitação isolada, correlação real Produto -> n8n oficial + Shadow Gemini/Gemini e avaliação sem benchmark no gerador. Teste com LLM e comparação financeira exigem autorização própria; SQL real no Shadow permanece desligado.
