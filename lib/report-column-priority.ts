const PRESENTATION_COLUMN_PRIORITY = [
  "tipo_ranking",
  "tipo_variacao",
  "tipo_impacto",
  "grupo_dre",
  "subgrupo",
  "conta_contabil",
  "nk_conta_contabil",
  "marca",
  "centro_custo",
  "setor",
  "realizado_rs",
  "orcado_rs",
  "variancia_rs",
  "variancia_perc",
  "realizado_anterior_rs",
  "variancia_vs_anterior_rs",
  "variancia_vs_anterior_perc",
  "ranking_geral",
  "ranking_maiores",
  "ranking_menores"
];

function normalizeColumnName(column: string) {
  return column.trim().toLowerCase();
}

export function prioritizePresentationColumns(columns: string[], maxColumns: number) {
  const limit = Math.max(0, Math.trunc(maxColumns));
  if (limit === 0) return [];

  const byNormalizedName = new Map(
    columns.map((column) => [normalizeColumnName(column), column] as const)
  );
  const prioritized = PRESENTATION_COLUMN_PRIORITY.map((column) =>
    byNormalizedName.get(column)
  ).filter((column): column is string => Boolean(column));
  const prioritizedSet = new Set(prioritized);
  const remaining = columns.filter((column) => !prioritizedSet.has(column));

  return [...prioritized, ...remaining].slice(0, limit);
}
