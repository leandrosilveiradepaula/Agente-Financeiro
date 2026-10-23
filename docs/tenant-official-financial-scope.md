# G1/G4 — Identidade organizacional versus isolamento financeiro oficial

**Estado:** somente código candidato da PR #24. Nenhuma migração aplicada, nenhum tenant provisionado, nenhuma variável ativada, nenhuma mudança no n8n, na Vercel ou no banco.

## Duas fronteiras distintas

A identidade persistida `AGENT_TENANT_IDENTITY_ENABLED` restringe a visualização de sessões, runs e evidências de Shadow. Isso **não** garante, isoladamente, que o n8n oficial, sua conexão Ducklake/PostgreSQL ou seu cache SQL usem dados do mesmo tenant. O fluxo oficial continua n8n + Gemini. O runtime LangGraph tem seu próprio gate `LANGGRAPH_EXPECTED_ORGANIZATION_ID`; ele não substitui o controle do Produto na rota oficial.

Para evitar que a nova identidade permita consultar uma fonte financeira de outra organização, o Produto exige uma **segunda configuração**, exclusivamente do backend:

```text
AGENT_TENANT_IDENTITY_ENABLED=false
AGENT_TENANT_OFFICIAL_ORGANIZATION_ID=
```

Somente após autorização operacional separada, migração revisada, memberships reais e verificação independente de que o endpoint n8n oficial e seu datasource pertencem à organização pretendida, a segunda variável poderá conter o UUID exato dessa organização. **Não** configurá-la automaticamente e não ativar o modo tenant com destino financeiro compartilhado.

Enquanto o modo tenant estiver habilitado, mas a vinculação oficial estiver ausente ou divergente, as rotas de geração e execução retornam erro sanitizado **antes de qualquer chamada ao n8n, geração/execução ou persistência de uma nova run**. A configuração é estrutural por implantação, sem `if` por cliente e sem nomes de tabelas financeiras hardcoded. Ela **não** atesta que o n8n/DSN esteja realmente isolado: isso demanda auditoria do runtime e credenciais.

## Cache, execução e correlação

- O cache SQL legado não possui segregação por tenant/versionamento comprovada. Em modo tenant, `use_sql_cache` é forçado a `false` no transporte oficial. Se o n8n devolver `cache.hit=true` mesmo assim, o Produto rejeita a resposta, não retorna a SQL cacheada e persiste somente o status de falha sanitizado.
- IDs de correlação `run_id` fornecidos pelo cliente são ignorados na geração em modo tenant. O Produto emite um ID novo, vinculado à execução persistida.
- Em modo tenant, a execução aprovada exige ID de run existente no **tenant autenticado**. SQL alterada em relação à gerada não pode ser executada silenciosamente; precisa retornar para validação e aprovação explícitas.
- As verificações seguem separadas de `LANGGRAPH_SHADOW_ENABLED`. Desabilitar o Shadow não remove controles da rota financeira oficial.
- Sem `AGENT_TENANT_IDENTITY_ENABLED=true`, as rotas conservam o comportamento anterior da Demo (migração não exigida), inclusive cache legado e IDs históricos. Isso **não** habilita comportamento multicliente no sistema legado.

## Critérios antes de ativar

1. Revisar e aplicar a migração da PR #24 por procedimento próprio (não neste PR), confirmar associação persistida de cada usuário, memberships múltiplas e comportamento de sessões legadas.
2. Atestar por evidências a correspondência entre UUID da organização, serviço n8n **oficial**, conector financeiro, permissões SELECT, schema e contexto versionado. Não depender de nomes, placeholders ou da configuração por si só.
3. Não compartilhar fonte física ou cache financeiro entre organizações sem isolamento de dados demonstrado. Para vários tenants no mesmo deployment, ainda será necessária uma arquitetura de roteamento/autorização de conectores aprovada; o escopo atual permite **uma organização por deployment oficial verificado**.
4. Validar a correlação n8n → LangGraph em Shadow isolado, incluindo identidade organizacional confiável, sem ativar SQL real no Shadow. Comparação de resultados financeiros exige autorização separada.
5. Antes de merge ou produção, validar CI/TypeScript e corrigir de maneira independente o bloqueio pré-existente de `next build` (Next/Turbopack × `exceljs`) para ter um build reproduzível.
6. Qualquer execução de SQL real, migração, configuração de produção, ativação do Shadow, rotacionamento de segredos ou cutover depende de autorização explícita; não presumir aprovação a partir de CI verde.

**Rollback do opt-in:** desabilitar o gate tenant no Produto recupera a compatibilidade do caminho legado, mas não remove dados de organizações nem migrações. N8n oficial e LangGraph continuam separados. Não apagar associações ou histórico sem uma decisão formal de retenção.
