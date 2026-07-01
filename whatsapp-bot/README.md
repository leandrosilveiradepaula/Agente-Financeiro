# Agente SQL Financeiro DuckLake - WhatsApp Bot

Servico Node.js/TypeScript separado para conversar com o Agente SQL Financeiro DuckLake via WhatsApp Business Cloud API.

Este MVP nao altera a interface Next.js, o `teams-bot`, o n8n, o Watson Flow ou regras financeiras. Ele consome o endpoint existente:

`https://n8n.srv1319424.hstgr.cloud/webhook/executar-sql-watson-orchestrate`

## Como configurar na Meta

1. Acesse Meta for Developers e crie um app do tipo Business.
2. Adicione o produto WhatsApp.
3. Vincule ou crie uma WhatsApp Business Account.
4. Copie:
   - `WHATSAPP_ACCESS_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_BUSINESS_ACCOUNT_ID`
5. Defina um token de verificacao qualquer e seguro em `WHATSAPP_VERIFY_TOKEN`.

## Variaveis de ambiente

Copie `.env.example` para `.env` e preencha:

```env
WHATSAPP_PORT=3980
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_APP_SECRET=
WHATSAPP_GRAPH_API_VERSION=v21.0
DUCKLAKE_AGENT_ENDPOINT=https://n8n.srv1319424.hstgr.cloud/webhook/executar-sql-watson-orchestrate
DUCKLAKE_WEB_APP_URL=
SAVED_REPORTS_FILE=./data/saved-reports.json
ALLOWED_WHATSAPP_NUMBERS=
MAX_WHATSAPP_MESSAGE_LENGTH=3500
```

`WHATSAPP_APP_SECRET` ativa validacao de assinatura `x-hub-signature-256`.

`ALLOWED_WHATSAPP_NUMBERS` aceita lista separada por virgula, por exemplo:

```env
ALLOWED_WHATSAPP_NUMBERS=5511999999999,5511888888888
```

Se vazio, todos os numeros sao permitidos durante desenvolvimento.

## Como rodar localmente

```bash
npm install
npm run dev
```

O servidor sobe em `http://localhost:3980`.

## Endpoints locais

- `GET /` - pagina simples do servico
- `GET /privacy` - texto simples de privacidade
- `GET /terms` - texto simples de termos
- `GET /health` - status do servico
- `GET /webhook` - verificacao da Meta
- `POST /webhook` - recebimento de mensagens
- `POST /debug/ask` - debug local sem envio para Meta

Exemplo de health:

```bash
curl http://localhost:3980/health
```

Exemplo de verificacao:

```bash
curl "http://localhost:3980/webhook?hub.mode=subscribe&hub.verify_token=SEU_TOKEN&hub.challenge=123"
```

## Expor com dev tunnel

Use a ferramenta de tunel de sua preferencia, por exemplo:

```bash
ngrok http 3980
```

Configure na Meta:

- Callback URL: `https://SEU_TUNEL/webhook`
- Verify token: o mesmo valor de `WHATSAPP_VERIFY_TOKEN`

## Teste de debug

```bash
curl -X POST http://localhost:3980/debug/ask ^
  -H "Content-Type: application/json" ^
  -d "{\"from\":\"5511999999999\",\"question\":\"Quais as contas que tiveram maiores estouros de orcamento no mes?\"}"
```

Esse endpoint chama o agente e retorna a resposta formatada, sem enviar mensagem para a Meta.

## Comandos no WhatsApp

- `ajuda` ou `help` - lista comandos
- `status` - mostra configuracao operacional
- `salvar` - salva o ultimo relatorio gerado para o numero
- `markdown` - envia o markdown do ultimo relatorio
- `meus relatorios` - lista os ultimos 5 relatorios salvos

## Limitacoes do MVP

- Apenas conversa 1:1.
- Apenas mensagens de texto.
- Nao envia templates ativos fora da janela de atendimento.
- Nao envia PDF ou arquivo `.md`.
- Mensagens longas sao truncadas para respeitar um limite seguro do WhatsApp.
- Storage local em JSON, adequado para MVP e desenvolvimento.
