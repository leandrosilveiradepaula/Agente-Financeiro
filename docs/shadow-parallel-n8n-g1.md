# Gate G1 — Demo Finance: n8n Parallel Shadow (contrato v1)

**Estado deste documento:** integração preparada em código; não atesta
workflow importado, publicado ou executado no n8n. Não altera o caminho
oficial. A implantação exige autorização e verificação do ambiente ativo.

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
