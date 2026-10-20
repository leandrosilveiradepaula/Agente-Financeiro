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


## Proveniência e limite das duas SQLs persistidas

A exportação **ativa e confirmada pelo operador** com 68 nós contém o
percurso `Gemini - Gerar SQL` → `Code - Limpar SQL DuckLake` →
validação/preflight → `Postgres - Executar SQL Demo` →
`Code - Normalizar Resultado Postgres Demo` → relatório/resposta.
Há caminhos de cache e reparo, mas a resposta de geração ao Produto
**já contém SQL após o cleaner e após execução interna ao n8n**.

- `ai_agent_runs.sql_generated` guarda a SQL **devolvida pelo n8n**
  ao Produto; seu nome não comprova que seja a SQL original do Gemini.
- `ai_agent_runs.sql_executed` registra, quando disponível, a SQL da
  **etapa de execução posterior do Produto**; não identifica necessariamente
  a consulta que o n8n executou dentro de seu webhook inicial.
- A comparação pode examinar os dois campos contra a mesma evidência
  LangGraph. `official_sql_text_changed` indica apenas divergência
  textual entre os campos (inclusive formatação), **não** uma
  transformação causada pelo cleaner.
- O draft original do Gemini, anterior ao cleaner, e cada transformação
  interna não estão presentes no payload final analisado. Atribuição de
  divergência ao cleaner exige inspeção autorizada de evidências internas
  do n8n ou instrumentação separadamente aprovada.

A interface informa quando não existe SQL posterior. Nenhum valor de
SQL bruta é exposto ao navegador. Não declarar paridade financeira ou
comparação com o Gemini pré-cleaner sem evidências específicas.

## Disponibilidade do controle de comparação

A API de listagem de Shadow retorna `comparison_enabled` ao usuário
já autorizado a ver suas execuções. O painel só exibe o botão de
comparação quando a flag está ativa no backend. Com a flag ausente ou
desativada, mostra texto explicativo em vez de um botão inutilizável.
Isso evita criar uma ação que parece disponível antes da configuração
operacional e dos gates necessários.

## Evidência de igualdade de LLM, sem inventar aliases

O comparador LangGraph fornece apenas identificadores sanitizados do
provedor e modelo **realmente utilizados** na geração Shadow (e no reparo,
quando houver). O backend do Produto confronta esses identificadores
com `llm_provider` e `llm_model` persistidos no run oficial e responde:

- `identifiers_matched`: identificadores idênticos, inclusive reparador
  quando houve reparo; NÃO comprova resultado, contexto ou SQL equivalentes.
- `identifier_mismatch`: rótulos registrados diferentes; sem prova de
  mesmo modelo, mesmo que dois rótulos possam ser aliases.
- `unattested`: falta algum identificador ou comprovação do reparador;
  nunca inferir Gemini pela configuração default.

Nenhum valor oficial é repassado ao gerador, planejador ou à LLM Shadow
para produzir a SQL. Essa avaliação acontece estritamente **após** a
geração e a persistência da evidência. Não contém tabela, métrica,
cliente, threshold ou SQL casuístico.

## Evidência Shadow assíncrona

A geração Shadow é agendada após a resposta oficial. A consulta inicial
ao histórico pode ocorrer antes de o LangGraph persistir a evidência.
Quando a flag `LANGGRAPH_SHADOW_ENABLED` está ativa para a instância, a
interface realiza novas **leituras** do histórico, no máximo 12 tentativas
com intervalo de 8 segundos, encerrando após resultado, erro ou unmount.
A consulta não aciona novamente o gerador, Gemini, n8n ou execução SQL.

Com o Shadow desativado, não há polling adicional. Resultado ausente
após a janela significa somente **não comprovado**, não sucesso nem falha
de geração; é necessário investigar logs e IDs antes de atestar paridade.

## Comparação de intenção observada, sem hardcode

O Produto já armazena `detected_intent` retornado pelo n8n oficial.
Na comparação pós-geração, a API protegida envia opcionalmente esse
identificador de intenção — **não ao gerador** — ao comparador LangGraph,
que obtém sua própria intenção da evidência assinada. A interface
recebe apenas um status `identifiers_matched`, `identifier_mismatch`
ou `unattested`, sem nomes de intenções, SQL ou valores financeiros.
Rótulos diferentes não provam conceitos contábeis divergentes; possíveis
aliases são definidos no contexto versionado, jamais hardcoded no motor.

A exportação de 68 nós do n8n não transmite seu plano integral ao
Produto; portanto este status atesta apenas os **rótulos** de intenção,
e não paridade de métricas, dimensões, filtros de negócio ou plano.
Essas evidências de planejamento continuam pendentes de instrumentação
autorizada no fluxo oficial. Sem isso, não declarar G1/G3 concluídos.
