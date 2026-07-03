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
WHATSAPP_PROVIDER=debug
WHATSAPP_WEBJS_ENABLE_INBOUND=false
WHATSAPP_WEBJS_DRY_RUN=true
WHATSAPP_ALLOWED_NUMBERS=
WHATSAPP_REQUIRE_TRIGGER=true
WHATSAPP_TRIGGER_PREFIX=AGENTE
WHATSAPP_IGNORE_GROUPS=true
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
DEMO_BOT_PHONE_NUMBER=5551999999999
DEMO_DEFAULT_QUESTION=Quais as contas que tiveram maiores estouros de orçamento no mês?
DEMO_TITLE=Agente SQL Financeiro DuckLake
DEMO_SUBTITLE=Escaneie o QR Code para testar o agente financeiro pelo WhatsApp
DEMO_REQUIRE_ALLOWED_NUMBER=false
```

`WHATSAPP_APP_SECRET` ativa validacao de assinatura `x-hub-signature-256`.

`ALLOWED_WHATSAPP_NUMBERS` aceita lista separada por virgula, por exemplo:

```env
ALLOWED_WHATSAPP_NUMBERS=5511999999999,5511888888888
```

Se vazio, todos os numeros sao permitidos durante desenvolvimento.

`WHATSAPP_PROVIDER` controla o adaptador ativo:

- `debug` - apenas endpoints locais, como `/debug/ask`
- `meta` - mantem o webhook da WhatsApp Cloud API em `/webhook`
- `webjs` - inicia WhatsApp Web via `whatsapp-web.js` e mostra o QR tecnico no terminal

## WebJS Safety Guard

Por seguranca, o modo WebJS bloqueia mensagens recebidas por padrao. Isso evita que o bot responda contatos pessoais quando o WhatsApp Web estiver conectado em um numero de teste.

Defaults seguros:

```env
WHATSAPP_WEBJS_ENABLE_INBOUND=false
WHATSAPP_WEBJS_DRY_RUN=true
WHATSAPP_ALLOWED_NUMBERS=
WHATSAPP_REQUIRE_TRIGGER=true
WHATSAPP_TRIGGER_PREFIX=AGENTE
WHATSAPP_IGNORE_GROUPS=true
```

Com esses valores, o WebJS pode conectar, mas nao chama o agente e nao responde mensagens. Para um teste controlado, habilite explicitamente:

```env
WHATSAPP_PROVIDER=webjs
WHATSAPP_WEBJS_ENABLE_INBOUND=true
WHATSAPP_WEBJS_DRY_RUN=false
WHATSAPP_ALLOWED_NUMBERS=5551888888888
WHATSAPP_REQUIRE_TRIGGER=true
WHATSAPP_TRIGGER_PREFIX=AGENTE
```

Somente numeros na allowlist podem acionar o agente, e a mensagem deve comecar com o prefixo, por exemplo:

```text
AGENTE Quais as contas que tiveram maiores estouros de orçamento no mês?
```

Consulte a configuracao segura sem expor numeros completos:

```bash
curl http://localhost:3980/webjs/safety
```

## Como rodar localmente

```bash
npm install
npm run dev
```

O servidor sobe em `http://localhost:3980`.

## WhatsApp WebJS

Para demonstração com WhatsApp Web local:

```env
WHATSAPP_PROVIDER=webjs
DUCKLAKE_AGENT_ENDPOINT=https://n8n.srv1319424.hstgr.cloud/webhook/executar-sql-watson-orchestrate
```

Depois rode:

```bash
npm run dev
```

Ao iniciar, deve aparecer no terminal:

```text
Escaneie o QR Code com o WhatsApp para conectar o agente.
```

Escaneie o QR tecnico com o WhatsApp do numero do robo. Se a sessao ja estiver salva, o terminal deve mostrar:

```text
WhatsApp Web conectado.
```

Status:

```bash
curl http://localhost:3980/webjs/status
```

## Endpoints locais

- `GET /` - pagina simples do servico
- `GET /privacy` - texto simples de privacidade
- `GET /terms` - texto simples de termos
- `GET /health` - status do servico
- `GET /webjs/status` - status do WhatsApp Web quando `WHATSAPP_PROVIDER=webjs`
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

## Demonstracao com QR Code

Este modo e apenas para demonstracao comercial e testes. Nao utilize em producao e nao solicite dados sensiveis durante a apresentacao.

Configure no `.env`:

```env
WHATSAPP_PROVIDER=webjs
DEMO_BOT_PHONE_NUMBER=5551999999999
DEMO_DEFAULT_QUESTION=Quais as contas que tiveram maiores estouros de orçamento no mês?
```

`DEMO_BOT_PHONE_NUMBER` deve ser o numero conectado ao robo, em formato internacional, apenas numeros, sem `+`, espacos ou tracos.

Fluxo sugerido:

1. Rode `npm run dev`.
2. Se estiver usando WhatsApp WebJS, escaneie o QR interno do WhatsApp Web no terminal para conectar o numero do robo.
3. Abra `http://localhost:3980/demo`.
4. Mostre o QR Code da pagina para o cliente.
5. O cliente escaneia, abre o WhatsApp e envia a pergunta ja preenchida.
6. O bot recebe a pergunta e responde pelo WhatsApp.

Endpoints de demonstracao:

- `GET /demo` - pagina HTML com QR Code
- `GET /demo/qr.png` - imagem PNG do QR Code
- `GET /demo/link` - JSON com link `wa.me`, numero e pergunta
- `GET /demo/questions` - perguntas sugeridas

Tambem e possivel escolher a pergunta:

```bash
curl "http://localhost:3980/demo/link?questionId=orcado_vs_realizado"
```

Ou gerar um QR com texto customizado, limitado a 300 caracteres:

```bash
curl "http://localhost:3980/demo/link?text=Monte%20uma%20analise%20por%20marca"
```

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
