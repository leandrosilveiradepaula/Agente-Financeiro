# Agente Financeiro DEMO

Interface web demonstrativa do Agente Financeiro para o Grupo Horizonte.

## Requisitos

- Node.js 20 ou superior
- npm
- Variaveis de ambiente configuradas no backend/Vercel

## Configuracao

Copie `.env.example` para `.env.local` apenas em ambiente local e preencha os valores reais fora do Git.

Variaveis principais:

```env
DATABASE_URL=
POSTGRES_SSL=true
N8N_GENERATE_SQL_WEBHOOK_URL=
N8N_EXECUTE_WATSON_WEBHOOK_URL=
N8N_INTERNAL_WEBHOOK_TOKEN=
AGENT_INTERFACE_MODE=demo
```

Nao versione credenciais, DSNs, tokens, URLs privadas ou endpoints reais.

## Instalar

```bash
npm install
```

## Desenvolvimento

```bash
npm run dev
```

Abra:

```text
http://127.0.0.1:3000
```

## Validacao

```bash
npm run test
npm run lint
npm run build
```

## Escopo

- Fluxo DEMO de geracao, validacao e execucao em chamada unica.
- Fluxo oficial separado preservado.
- Exportacao client-side em PDF, Excel e CSV usando apenas dados carregados na interface.
- Branding comercial Grupo Horizonte.
- Migrations versionadas para a aplicacao web DEMO.
