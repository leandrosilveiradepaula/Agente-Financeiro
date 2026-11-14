## Segurança de tenant e operador — 14/11/2026

A sessão atual de `AgentSession` no Product contém `userId` e
`userProfile`, mas **não contém uma organização/tenant do usuário**.
O simples perfil `admin` seria insuficiente para abrir o G5 privado.
Por isso o BFF agora exige `G5_OWNER_REVIEW_ALLOWED_USER_ID` no
servidor, exatamente igual ao `session.userId` do operador autorizado,
além de `G5_OWNER_REVIEW_TENANT_ID` configurado. Caso falte ou divirja,
responde 403 **antes de qualquer leitura de fonte privada**.

Esta é uma restrição temporária de rollout único por tenant, não
prova de RBAC multitenant geral. A evolução deve associar formalmente
sessão e organização no Product, e autorizar cada contexto por tenant
sem configuração global compartilhada. Não criar `if client == ...`,
não expor IDs/segredos em cliente e não habilitar sem revisão humana.
Todos os recursos seguem OFF por padrão, sem deploy.

---

# G5/P3 — Revisão financeira dentro do produto existente (contrato não implantado)

## Objetivo

Permitir que o operador responsável faça a revisão humana dos 77 registros
financeiros G5 e dos 48 vínculos físicos P3 **sem usar SSH**, aproveitando
o login e a autorização administrativa do produto Next.js.

A implementação é uma extensão da interface existente, não outro aplicativo.
Nenhuma mudança em n8n, Supabase, produção, credenciais, permissões ou
execução de SQL de cliente foi autorizada ou executada.

## Arquivos

- `app/admin/g5-review/page.tsx`: interface de visualização por item,
  classificação e vinculação física. Não escolhe um campo por similaridade;
  exige clique humano explícito.
- `app/api/admin/g5-review/route.ts`: BFF com `requireAdminSession`,
  checagem de Origin nas mutações, limites de tamanho e validação de payload.
  Não aceita URLs ou caminhos arbitrários do navegador.
- `lib/g5-owner-review-client.ts`: serviço S2S de uso exclusivo do servidor,
  com token separado, URL HTTPS fixa, pin de hostname/tenant, timeout,
  corpo de resposta limitado e retornos sanitizados.
- `tests/g5-owner-review-client.test.ts` e
  `tests/g5-owner-review-route.test.ts`: testes negativos sem serviços reais.

## Política de ativação

**Desativado por padrão**: a tela não carrega fontes e o BFF responde
indisponível enquanto `G5_OWNER_REVIEW_ENABLED` não for explicitamente
definido para `true` pelo operador após revisão.

As variáveis seguintes são apenas nomes de configuração (não inserir
valores aqui nem em commits):

- `G5_OWNER_REVIEW_ENABLED` — false até homologação da rota.
- `G5_OWNER_REVIEW_INTERNAL_URL` — origem HTTPS fixa do serviço interno,
  com path raiz e sem query/credenciais.
- `G5_OWNER_REVIEW_ALLOWED_HOST` — hostname exato do serviço privado.
- `G5_OWNER_REVIEW_INTERNAL_TOKEN` — credencial dedicada de pelo menos
  32 caracteres, nunca a mesma token de Shadow SQL ou de evidências.
- `G5_OWNER_REVIEW_TENANT_ID` — tenant autorizado do contexto G5,
  validado por política organizacional.
- `G5_OWNER_REVIEW_WEB_ORIGIN` — origem exata do console para checagem de
  CSRF em POST.

O backend da PR #233 (`scripts/operations/g5_owner_review_http_contract.py`)
é **um contrato puro, ainda não montado no runtime HTTP**. Para uso real,
é obrigatório preparar um adaptador HTTP privado que preserve autenticação,
actor ID do BFF, headers de tenant e limites de entrada e que NÃO exponha
o endpoint pela mesma credencial geral de SQL/Shadow. Testar o acesso seguro
antes de qualquer deploy.

## Gates de segurança e governança

1. Validar login/admin, tenant e sessão no produto. Não carregar texto bruto
   G5 para perfis de diretoria, comercial, auditoria ou usuários anônimos.
2. Conectar o endpoint com token dedicado pelo serviço privado; registrar
   auditoria do ator no backend sem texto financeiro nos logs.
3. Persistir somente *drafts*; não criar comandos de aprovação final,
   ativação de contexto, cutover ou execução de SQL nessa tela.
4. Preservar o pacote original SHA-pinned em arquivos 0600 sob raiz 0700,
   sem replicá-lo no GitHub, n8n, benchmark ou prompt de LLM.
5. Obter revisão financeira explícita sobre os 77 significados e 48 vínculos,
   mais catálogo canônico versionado e assinatura externa da decisão.
6. Provar dois contextos financeiros reais materialmente diferentes,
   perguntas inéditas e paridade com n8n+Gemini oficial. Uma SELECT real
   exige autorização separada e menor privilégio.

Testes de frontend/backend aqui são **sem serviço real**. A CI confirma
contratos e tipo, não é evidência de disponibilidade da interface web,
aprovação contábil ou paridade financeira.

OFFICIAL=n8n+Gemini, SHADOW=n8n+LangGraph+Gemini,
`LANGGRAPH_ALLOW_REAL_SQL_EXECUTION=false`.
