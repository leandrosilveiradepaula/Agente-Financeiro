# Agente Financeiro DEMO — comparação SQL pós-geração

Estado: candidato inativo na branch demo/grupo-horizonte. Preserva os
68 nós do n8n oficial e o relay HTTPS Shadow já implementado na DEMO.

## Proveniência e arquitetura

O GitHub confirma que main e demo/grupo-horizonte não possuem ancestral
comum. Esta integração adiciona **somente** comparação pós-geração
compatível com a DEMO; não realiza merge da main, nem cria workflow n8n.

O usuário autenticado e com política can_view_sql visualiza registros
Shadow vinculados ao mesmo run. O backend lê SQL e pergunta armazenadas,
sem aceitar SQL do browser, e compara com a geração LangGraph persistida
através do endpoint interno autenticado de comparação. Retorna apenas
facetas estruturais, status de modelo e intenção, limitações e flags de
reaprovação; não retorna SQL ou dados sensíveis. Releitura de evidências
após dispatch assíncrono nunca dispara geração ou execução financeira.

A SQL original Gemini antes do cleaner não consta da resposta oficial
final: o n8n de 68 nós já limpa e executa SQL internamente. O campo
sql_generated do Produto representa SQL retornada pelo n8n, e o campo
sql_executed representa eventual execução posterior registrada no
Produto. Diferença entre eles não prova transformação do cleaner.

## Gating operacional

Na DEMO ainda faltam as variáveis LANGGRAPH_INTERNAL_BASE_URL,
LANGGRAPH_S2S_TOKEN e LANGGRAPH_SHADOW_COMPARISON_ENABLED. Nenhuma é
adicionada ou ativada nesta PR. A DEMO já possui transporte
LANGGRAPH_SHADOW_TRANSPORT=n8n_relay em código, mas o relay de dispatch
**não substitui** um caminho S2S HTTPS autorizado para ler evidências e
compará-las. Endereço Docker/localhost não é rota utilizável por Vercel.

Verificar no runtime LangGraph: versão de comparação pós-geração,
provedor/modelo Gemini, contexto semântico autorizado e
LANGGRAPH_ALLOW_REAL_SQL_EXECUTION=false. Nunca enviar SQL oficial,
benchmarks, golden answers ou respostas esperadas ao gerador/planner.

O Produto ainda não possui identidade tenant confiável no tipo de
sessão. O comparador deve apresentar tenant_identity_attested=false;
sem contexto autorizado e isolamento de dados não há paridade
multicliente demonstrada. A resposta final do n8n também não atesta seu
plano financeiro completo nem a SQL Gemini pré-cleaner.

## Testes offline e risco de deploy

Rodar os testes de comparação, cliente S2S, autorização e ShadowRunPanel
via npm test, executar npm run lint e npm run build. Nenhum desses
testes precisa de LLM paga, n8n, banco ou SQL real.

O GitHub Actions do Produto foi bloqueado por faturamento em runs
anteriores, portanto CI vermelho antes de iniciar runner não demonstra
falha de código, e Preview READY não comprova testes aprovados.

Merge nesta branch poderá disparar deploy da aplicação DEMO.
A ativação da comparação, mudanças em n8n e credenciais, chamada paga
Gemini, execução SQL read-only, produção e cutover exigem autorização
separada. O rollback da leitura desliga sua flag, preservando a
resposta oficial n8n + Gemini.
