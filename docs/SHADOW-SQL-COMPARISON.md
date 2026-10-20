# Comparação SQL pós-geração na tela de histórico

A PR de Produto acrescenta uma comparação estrutural real, não outro
workflow n8n. O usuário autorizado abre a execução no histórico, seleciona
um Shadow de tipo Generate e clica "Comparar SQL com oficial (sem executar)".

O backend usa exclusivamente a pergunta, usuário e SQL oficial
persistidos, depois da autorização em authorizeAdminRunReadAccess e
can_view_sql. Nada de SQL bruta, credenciais ou resultados do banco
é aceito do navegador ou devolvido a ele. O cliente envia apenas
para a API interna S2S do LangGraph já implementada pela PR #137:
POST /v1/internal/sql-agent/compare-shadow-sql.

O LangGraph busca sua própria SQL Shadow persistida e verifica
agent_run_id, shadow_record_id, pergunta, principal e tenant quando
existente. Compara filtros, tabelas, joins, projeções e estruturas. A
interface mostra as categorias diferentes sem expor valores/SQL.

Flags padrão: LANGGRAPH_SHADOW_COMPARISON_ENABLED=false;
LANGGRAPH_SHADOW_ENABLED mantém seu estado anterior e não deve ser
ativado implicitamente. Em ambiente explicitamente autorizado,
LANGGRAPH_SHADOW_COMPARISON_ENABLED=true permite somente leitura e
análise offline de SQL geradas previamente (não chama LLM e não executa
SQL real). Exige LANGGRAPH_INTERNAL_BASE_URL e LANGGRAPH_S2S_TOKEN
já aprovados e serviço LangGraph com a nova rota implantada.

A comparação pode ser inconclusiva. SQLs com texto normalizado igual
ainda não provam equivalência financeira. Mapeamento contábil,
portabilidade multicliente com organization_id autorizado e paridade
numérica sob execução read-only isolada são gates separados.

Não realizar merge ou deploy sem garantir que o serviço LangGraph
suporta a nova rota. No momento o GitHub Actions do Produto não pode
iniciar runner por bloqueio de faturamento da conta; compilação da
Preview não substitui Vitest. Nenhum teste pago de LLM é necessário.
