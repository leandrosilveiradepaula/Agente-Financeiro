# Agente SQL Financeiro DuckLake

Interface web corporativa para gerar, revisar, copiar e analisar SQL financeiro DuckLake integrado ao Watson Orchestration.

Versão da interface: `interface-v1.0-demo`

Versão do agente: `v2.0.6.2-benchmark-30-30-stable`

## Status Atual

- Geração de SQL e execução Watson pela camada de orquestração.
- Revisão e cópia de SQL no Monaco Editor.
- Modo manual para colar retorno JSON do Watson.
- Tabela de resultados com filtro e exportação CSV.
- Resumo executivo automático determinístico.
- Relatório executivo com prévia, cópia em Markdown e exportação PDF.
- Histórico local em `localStorage`.

## Requisitos

- Node.js 20 ou superior
- npm
- Serviço de orquestração unificado configurado

## Instalação

```bash
npm install
```

## Variáveis de Ambiente

Crie um arquivo `.env.local` na raiz do projeto:

```env
N8N_GENERATE_SQL_WEBHOOK_URL=https://n8n.srv1319424.hstgr.cloud/webhook/executar-sql-watson-orchestrate
N8N_EXECUTE_WATSON_WEBHOOK_URL=https://n8n.srv1319424.hstgr.cloud/webhook/executar-sql-watson-orchestrate
```

Não use `NEXT_PUBLIC_` para essas variáveis. Elas devem ficar disponíveis apenas no backend do Next.js.
As rotas internas usam esse endpoint unificado para gerar SQL com `{ pergunta }` e executar Watson com `{ modo: "executar_sql", pergunta, limit: 100, sql }`.

## Rodar Localmente

```bash
npm run dev
```

Abra:

```text
http://127.0.0.1:3000
```

## Scripts

```bash
npm run lint
npm run test
npm run build
npm run start
```

- `npm run lint`: checagem TypeScript.
- `npm run test`: testes unitários com Vitest.
- `npm run build`: build de produção.
- `npm run start`: servidor de produção após build.

## Fluxo de Uso Homologado

1. Digite uma pergunta ou escolha uma pergunta padrão.
2. Clique em `Gerar SQL`.
3. Revise a SQL gerada.
4. Clique em `Executar no Watson` para usar a SQL já gerada, sem gerar uma nova SQL.
5. Como alternativa, clique em `Copiar SQL`, execute manualmente no Watson e cole o JSON na aba `Colar retorno Watson`.
6. Revise tabela, resumo executivo e relatório.
7. Exporte CSV ou PDF, se necessário.

## Modo Manual Watson

O modo manual aceita JSON com campos como:

```json
{
  "columns": ["marca", "setor", "opex_rs"],
  "data": [],
  "execution_time_ms": 503.66,
  "query_id": "89780e1e",
  "row_count": 33,
  "success": true
}
```

Também são aceitos aliases como `rows`, `result.data`, `result.rows`, `queryId`, `executionTimeMs` e `rowCount`.

## Embedded Chat Watson Orchestrate

A interface inclui um painel opcional `Chat Watson Orchestrate`, fechado por padrão.

Esse painel carrega o embedded chat publicado no watsonx Orchestrate para o agente `Rivatti Lakehouse Agent`. Ele é auxiliar ao fluxo principal e não substitui o processo homologado de gerar SQL, copiar SQL, executar manualmente no Watson e colar o retorno JSON.

Variáveis públicas opcionais:

```env
NEXT_PUBLIC_WXO_HOST_URL=https://us-south.watson-orchestrate.cloud.ibm.com
NEXT_PUBLIC_WXO_ORCHESTRATION_ID=dcb73a4cf6ba45a498d4fe3f24f1b114_92d931c3-9a72-4844-97e4-a641ca7bd5b8
NEXT_PUBLIC_WXO_AGENT_ID=d1ec6cd9-2f9b-4f71-ab35-f99e4551405d
NEXT_PUBLIC_WXO_CRN=crn:v1:bluemix:public:watsonx-orchestrate:us-south:a/dcb73a4cf6ba45a498d4fe3f24f1b114:92d931c3-9a72-4844-97e4-a641ca7bd5b8::
```

Nenhuma API key deve ser exposta no frontend. O componente apenas configura o embedded chat e carrega o script público do Orchestrate:

```text
https://us-south.watson-orchestrate.cloud.ibm.com/wxochat/wxoLoader.js?embed=true
```

## Exportar CSV

A tabela permite filtrar resultados e exportar CSV. A exportação preserva os dados da tabela carregada.

## Exportar PDF

Após carregar um resultado, a interface permite gerar um relatório executivo em PDF contendo:

- Pergunta original
- Metadados
- Resumo executivo
- SQL gerada
- Tabela limitada às primeiras 50 linhas

## Execução Watson

O botão `Executar no Watson` usa sempre a última SQL gerada e armazenada na interface. Se ainda não houver SQL, a aplicação mostra `Gere uma SQL antes de executar no Watson.`.

O modo manual continua disponível para colar o JSON retornado pelo Watson quando a execução automática não for desejada.

## Segurança

- O frontend chama apenas rotas internas.
- Secrets ficam apenas no backend.
- O arquivo `.env` é ignorado pelo Git.
- O modo manual não envia dados para servidor externo.
- PDF e CSV são gerados no navegador.

## Homologação

Use o checklist:

```text
docs/HOMOLOGACAO_INTERFACE_V1.md
```
