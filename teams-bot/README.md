# Agente SQL Financeiro DuckLake — Teams Bot

Bot Microsoft Teams para consultar o Agente SQL Financeiro DuckLake usando o endpoint existente do n8n.

## Variáveis de ambiente

```env
TEAMS_BOT_APP_ID=
TEAMS_BOT_APP_PASSWORD=
TEAMS_BOT_TENANT_ID=
DUCKLAKE_AGENT_ENDPOINT=https://n8n.srv1319424.hstgr.cloud/webhook/executar-sql-watson-orchestrate
TEAMS_BOT_PORT=3978
DUCKLAKE_WEB_APP_URL=
SAVED_REPORTS_FILE=./data/saved-reports.json
ALLOWED_TEAMS_TENANT_ID=
ALLOWED_TEAMS_USERS=
```

`ALLOWED_TEAMS_USERS` aceita uma lista separada por vírgula de IDs de usuários Teams.

## Rodar localmente

```bash
cd teams-bot
npm install
npm run dev
```

O bot expõe:

```text
POST http://localhost:3978/api/messages
GET  http://localhost:3978/health
```

## Expor com dev tunnel ou ngrok

Exemplo com ngrok:

```bash
ngrok http 3978
```

Use a URL pública no endpoint de mensagens do Bot Framework:

```text
https://sua-url-publica.ngrok-free.app/api/messages
```

## Configurar Bot no Azure/Microsoft Teams

1. Crie um Azure Bot.
2. Configure Messaging endpoint como `/api/messages`.
3. Copie App ID e App Password para `.env`.
4. Configure canal Microsoft Teams.
5. Atualize `appPackage/manifest.json` com o `botId` real.

## Empacotar appPackage

Inclua no ZIP:

```text
manifest.json
color.png
outline.png
```

Os arquivos `color.png` e `outline.png` devem ser os ícones oficiais do app antes da instalação no Teams.

## Instalar no Teams

1. Abra Teams Admin Center ou Teams Developer Portal.
2. Faça upload do pacote ZIP.
3. Instale o app no escopo pessoal.

## Teste principal

Envie ao bot:

```text
Quais as contas que tiveram maiores estouros de orçamento no mês?
```

Resposta esperada:

- Adaptive Card com `Relatório Executivo`
- Intenção `estouro_orcamento`
- Query ID presente
- Resumo executivo
- Destaques
- Observações e alertas
- Tabela resumida
- Botões `Salvar relatório`, `Enviar Markdown`, `Abrir interface`

## Comandos

- `help`
- `status`
- `meus relatórios`
- `limpar`
