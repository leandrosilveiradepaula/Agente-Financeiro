# Diagnóstico do esquema multicliente — Gate G4

A inspeção somente leitura separa o ensaio em PostgreSQL descartável da verificação do banco instalado. Ela não aplica, altera ou autoriza DDL.

## Reconciliar o schema do destino implantado antes de migrar (somente leitura)

A rota administrativa `GET /api/admin/tenant-schema-readiness` exige sessão
autenticada e `can_manage_users`. Ela consulta apenas catálogos PostgreSQL
(`pg_catalog.pg_class`, `pg_attribute`, `pg_constraint` e `pg_index`)
via `DATABASE_URL` já configurada no **Produto**. Não faz leitura de linhas
financeiras nem de registros de usuários, não chama n8n/LLM e não executa DDL.

O retorno contém apenas status, booleanos e códigos fixos:
`legacy_incompatible`, `migration_pending`, `migration_incomplete`,
`structurally_present` ou `unavailable`. Verifica colunas tipadas,
FKs validadas, chave composta de membership, índices válidos e parciais,
além de permitir `organization_id` nulo sem default em sessões/runs legadas.

`structurally_present` **não** é sinal de aplicação de migration, comprovação
de ausência de backfill, RLS/GRANT, isolamento de conectores, memberships reais
ou autorização de ativação. O endpoint sempre devolve
`activation_authorized=false`. Não altera as variáveis tenant e não
substitui a reconciliação humana do histórico de DDL da instância real.

Fluxo operacional seguro: inspecionar o endpoint no deployment autorizado,
confrontar o relatório com o histórico de migrations efetivamente aplicadas,
revisar locks/dependências em janela própria, e só então buscar autorização
separada para qualquer DDL ou ativação. Não automatizar migração a partir
do resultado deste diagnóstico. A execução da rota pode ser custeada pelo
banco conectado, por isso é explicitamente solicitada pelo operador e
não funciona como healthcheck periódico.
