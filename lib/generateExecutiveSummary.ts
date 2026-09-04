import { formatBRL, formatNumber, formatPercent } from "@/lib/number-formatting";
import { parseReportNumber } from "@/lib/report-row-normalization";
import type { ExecutiveSummaryResult, ResultRow } from "@/lib/types";

export type ExecutiveSummaryInput = {
  question?: string;
  columns: string[];
  data: ResultRow[];
  metadata?: {
    query_id?: string;
    execution_time_ms?: number | null;
    row_count?: number;
    success?: boolean;
    detected_intent?: string;
  };
};

const SUMMARY_TITLE = "Resumo executivo";

const DIMENSION_PRIORITY = [
  "centro_custo",
  "marca",
  "grupo_dre",
  "subgrupo",
  "conta_contabil",
  "gestor"
];

const CATEGORY_PATTERNS = [
  "marca",
  "grupo_dre",
  "subgrupo",
  "conta_contabil",
  "centro_custo",
  "gestor",
  "tipo_variacao",
  "tipo_ranking",
  "descricao",
  "nome",
  "entidade",
  "categoria",
  "setor",
  "status"
];

const METRIC_PATTERNS = [
  /_rs$/,
  /_perc$/,
  /^perc_/,
  /percentual/,
  /^ranking_/,
  /rank/,
  /valor/,
  /total/,
  /realizado/,
  /orcado/,
  /variancia/,
  /margem/,
  /resultado/,
  /rol/,
  /cmv/,
  /opex/
];

function normalizeColumn(column: string) {
  return column
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function columnKey(column: string) {
  return normalizeColumn(column).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function columnLookup(columns: string[]) {
  const lookup = new Map<string, string>();

  for (const column of columns) {
    lookup.set(columnKey(column), column);
  }

  return lookup;
}

function findColumn(columns: string[], aliases: string[]) {
  const lookup = columnLookup(columns);

  for (const alias of aliases) {
    const column = lookup.get(columnKey(alias));
    if (column) {
      return column;
    }
  }

  return undefined;
}

function hasColumn(columns: string[], aliases: string[]) {
  return Boolean(findColumn(columns, aliases));
}

function value(row: ResultRow | undefined, column?: string): ResultRow[string] {
  if (!row || !column) {
    return null;
  }

  return row[column] ?? row[column.toLowerCase()] ?? null;
}

function text(row: ResultRow | undefined, column?: string, fallback = "não informado") {
  const raw = value(row, column);
  return raw === null || raw === undefined || raw === "" ? fallback : String(raw);
}

function optionalNumberValue(row: ResultRow | undefined, column?: string): number | null {
  return parseReportNumber(value(row, column));
}

function numberValue(row: ResultRow | undefined, column?: string): number {
  return optionalNumberValue(row, column) ?? 0;
}

function validNumericRows(data: ResultRow[], column: string) {
  return data
    .map((row, index) => ({ row, index, value: optionalNumberValue(row, column) }))
    .filter((item): item is { row: ResultRow; index: number; value: number } => item.value !== null);
}

function byNumber(data: ResultRow[], column: string, direction: "asc" | "desc") {
  return [...data].sort((a, b) => {
    const diff = numberValue(a, column) - numberValue(b, column);
    return direction === "asc" ? diff : -diff;
  });
}

function formatMetricValue(column: string, metricValue: number) {
  const normalized = columnKey(column);

  if (normalized.endsWith("_rs")) {
    return formatBRL(metricValue);
  }

  if (normalized.endsWith("_perc") || normalized.startsWith("perc_") || normalized.includes("percentual")) {
    return formatPercent(metricValue);
  }

  return formatNumber(metricValue);
}

function isCategoryColumn(column: string) {
  const normalized = columnKey(column);
  return CATEGORY_PATTERNS.some((pattern) => normalized === pattern || normalized.includes(pattern));
}

function isMetricColumn(column: string, data: ResultRow[]) {
  const normalized = columnKey(column);

  if (isCategoryColumn(column)) {
    return false;
  }

  return METRIC_PATTERNS.some((pattern) => pattern.test(normalized)) &&
    validNumericRows(data, column).length > 0;
}

function metricColumns(columns: string[], data: ResultRow[]) {
  return columns.filter((column) => isMetricColumn(column, data));
}

function bestDimensionColumn(columns: string[]) {
  for (const preferred of DIMENSION_PRIORITY) {
    const column = findColumn(columns, [preferred]);
    if (column) {
      return column;
    }
  }

  return columns.find(isCategoryColumn);
}

function rowLabel(row: ResultRow | undefined, columns: string[], maxLabels = 2) {
  const labels = DIMENSION_PRIORITY
    .map((dimension) => findColumn(columns, [dimension]))
    .filter((column): column is string => Boolean(column))
    .map((column) => text(row, column, ""))
    .filter(Boolean);

  return labels.slice(0, maxLabels).join(" / ") || "linha não identificada";
}

function splitVarianceRows(data: ResultRow[], varianceColumn: string) {
  const negativeRows = byNumber(
    data.filter((row) => numberValue(row, varianceColumn) < 0),
    varianceColumn,
    "asc"
  );
  const positiveRows = byNumber(
    data.filter((row) => numberValue(row, varianceColumn) > 0),
    varianceColumn,
    "desc"
  );
  const zeroRows = data.filter((row) => numberValue(row, varianceColumn) === 0);

  return { negativeRows, positiveRows, zeroRows };
}

function mainVarianceRow(data: ResultRow[], varianceColumn: string) {
  return [...data].sort(
    (a, b) => Math.abs(numberValue(b, varianceColumn)) - Math.abs(numberValue(a, varianceColumn))
  )[0];
}

function varianceSignText(row: ResultRow | undefined, varianceColumn: string) {
  const variance = numberValue(row, varianceColumn);

  if (variance < 0) {
    return "principal variação negativa observada";
  }

  if (variance > 0) {
    return "principal variação positiva observada";
  }

  return "sem variação relevante observada";
}

function varianceHighlights(data: ResultRow[], columns: string[], varianceColumn: string) {
  const { negativeRows, positiveRows } = splitVarianceRows(data, varianceColumn);
  const main = mainVarianceRow(data, varianceColumn);
  const mainVariance = numberValue(main, varianceColumn);
  const negative = negativeRows[0];
  const positive = positiveRows[0];
  const negativeHighlight = negative
    ? `Maior variação negativa: ${rowLabel(negative, columns)}, com ${formatBRL(numberValue(negative, varianceColumn))}.`
    : null;
  const positiveHighlight = positive
    ? `Maior variação positiva: ${rowLabel(positive, columns)}, com ${formatBRL(numberValue(positive, varianceColumn))}.`
    : null;

  if (mainVariance > 0) {
    return [positiveHighlight, negativeHighlight].filter(
      (highlight): highlight is string => Boolean(highlight)
    );
  }

  return [negativeHighlight, positiveHighlight].filter(
    (highlight): highlight is string => Boolean(highlight)
  );
}

function budgetVarianceSummary(input: ExecutiveSummaryInput): ExecutiveSummaryResult | null {
  const { columns, data } = input;
  const varianceColumn = findColumn(columns, ["variancia_rs", "variacao_rs", "variância_rs"]);
  const variancePercentColumn = findColumn(columns, [
    "variancia_perc",
    "variacao_perc",
    "variância_perc",
    "percentual_variacao"
  ]);
  const realizedColumn = findColumn(columns, [
    "realizado_rs",
    "opex_realizado_rs",
    "rol_realizado_rs",
    "valor_realizado"
  ]);
  const budgetColumn = findColumn(columns, [
    "orcado_rs",
    "opex_orcado_rs",
    "rol_orcado_rs",
    "valor_orcado"
  ]);

  if (!varianceColumn || !realizedColumn || !budgetColumn) {
    return null;
  }

  const main = mainVarianceRow(data, varianceColumn);
  const mainLabel = rowLabel(main, columns);
  const variancePercent = variancePercentColumn
    ? `, equivalente a ${formatPercent(numberValue(main, variancePercentColumn))}`
    : "";
  const highlights = varianceHighlights(data, columns, varianceColumn);
  const { negativeRows } = splitVarianceRows(data, varianceColumn);
  const hasAccountContext =
    hasColumn(columns, ["conta_contabil"]) ||
    hasColumn(columns, ["subgrupo"]) ||
    hasColumn(columns, ["grupo_dre"]);

  if (negativeRows.length && hasAccountContext) {
    highlights.push(
      "Maiores estouros de orçamento:",
      ...negativeRows
        .slice(0, 3)
        .map(
          (row, index) =>
            `${index + 1}. ${rowLabel(row, columns, 3)}: variação de ${formatBRL(
              numberValue(row, varianceColumn)
            )}.`
        )
    );
  }

  return {
    title: SUMMARY_TITLE,
    paragraphs: [
      `Com base no resultado carregado, a ${varianceSignText(main, varianceColumn)} foi em ${mainLabel}, com variação de ${formatBRL(numberValue(main, varianceColumn))}${variancePercent}.`,
      "A leitura executiva separa efeitos positivos e negativos do orçamento sem interpretar causalidade."
    ],
    highlights
  };
}

function brandResultSummary(input: ExecutiveSummaryInput): ExecutiveSummaryResult | null {
  const { columns, data } = input;
  const brandColumn = findColumn(columns, ["marca"]);
  const rolColumn = findColumn(columns, ["rol_rs", "rol"]);
  const resultColumn = findColumn(columns, ["resultado_liquido_rs", "resultado_rs"]);
  const resultPercentColumn = findColumn(columns, ["resultado_perc_rol", "perc_resultado_rol"]);

  if (!brandColumn || !rolColumn || !resultColumn || !resultPercentColumn) {
    return null;
  }

  const bestByResult = byNumber(data, resultColumn, "desc")[0];
  const bestByPercent = byNumber(data, resultPercentColumn, "desc")[0];
  const bestByRol = byNumber(data, rolColumn, "desc")[0];

  return {
    title: SUMMARY_TITLE,
    paragraphs: [
      `O maior resultado líquido aparece em ${text(bestByResult, brandColumn)}, com ${formatBRL(numberValue(bestByResult, resultColumn))}.`,
      `O melhor resultado sobre ROL é ${text(bestByPercent, brandColumn)}, com ${formatPercent(numberValue(bestByPercent, resultPercentColumn))}.`
    ],
    highlights: [
      `Maior resultado líquido: ${text(bestByResult, brandColumn)}, com ${formatBRL(numberValue(bestByResult, resultColumn))}.`,
      `Melhor resultado sobre ROL: ${text(bestByPercent, brandColumn)}, com ${formatPercent(numberValue(bestByPercent, resultPercentColumn))}.`,
      `Maior ROL: ${text(bestByRol, brandColumn)}, com ${formatBRL(numberValue(bestByRol, rolColumn))}.`
    ]
  };
}

function costCenterSummary(input: ExecutiveSummaryInput): ExecutiveSummaryResult | null {
  const { columns, data } = input;
  const costCenterColumn = findColumn(columns, ["centro_custo"]);
  const varianceColumn = findColumn(columns, ["variancia_rs", "variacao_rs", "variância_rs"]);
  const bestRankingColumn = findColumn(columns, ["ranking_maiores", "ranking_melhores"]);
  const worstRankingColumn = findColumn(columns, ["ranking_menores"]);

  if (!costCenterColumn) {
    return null;
  }

  const best = varianceColumn
    ? byNumber(data, varianceColumn, "desc")[0]
    : bestRankingColumn
      ? byNumber(data, bestRankingColumn, "asc")[0]
      : null;
  const worst = varianceColumn
    ? byNumber(data, varianceColumn, "asc")[0]
    : worstRankingColumn
      ? byNumber(data, worstRankingColumn, "asc")[0]
      : null;

  if (!best && !worst) {
    return null;
  }

  const bestValue = varianceColumn && best ? `, com variação de ${formatBRL(numberValue(best, varianceColumn))}` : "";
  const worstValue = varianceColumn && worst ? `, com variação de ${formatBRL(numberValue(worst, varianceColumn))}` : "";

  return {
    title: SUMMARY_TITLE,
    paragraphs: [
      "A leitura de centros de custo compara os desempenhos disponíveis no resultado carregado.",
      "Os destaques abaixo usam métricas e rankings explícitos da tabela, sem inferir causa de negócio."
    ],
    highlights: [
      best ? `Melhor centro de custo: ${text(best, costCenterColumn)}${bestValue}.` : null,
      worst ? `Pior centro de custo: ${text(worst, costCenterColumn)}${worstValue}.` : null
    ].filter((highlight): highlight is string => Boolean(highlight))
  };
}

function opexByBrandSectorSummary(input: ExecutiveSummaryInput): ExecutiveSummaryResult | null {
  const { columns, data } = input;
  const brandColumn = findColumn(columns, ["marca"]);
  const sectorColumn = findColumn(columns, ["setor"]);
  const percentColumn = findColumn(columns, ["perc_representatividade"]);

  if (!brandColumn || !sectorColumn || !percentColumn) {
    return null;
  }

  const brands = Array.from(new Set(data.map((row) => text(row, brandColumn, "")).filter(Boolean)));
  const topByBrand = brands.map((brand) => {
    const rows = data.filter((row) => text(row, brandColumn, "") === brand);
    return byNumber(rows, percentColumn, "desc")[0] ?? rows[0];
  });

  return {
    title: SUMMARY_TITLE,
    paragraphs: [
      "A análise mostra o peso de cada setor no OPEX de sua respectiva marca.",
      "Maior representatividade significa maior concentração do gasto de OPEX dentro da marca."
    ],
    highlights: [
      `Principais setores por marca: ${topByBrand
        .map((row) => `${text(row, brandColumn)}: ${text(row, sectorColumn)}`)
        .join("; ")}.`
    ]
  };
}

function isRankingColumn(column: string) {
  const normalized = columnKey(column);
  return /(^|_)(ranking|rank|posicao|classificacao)(_|$)/.test(normalized);
}

const RANKING_TOKENS = new Set(["ranking", "rank", "posicao", "classificacao"]);

function columnTokens(column: string) {
  return columnKey(column)
    .split("_")
    .filter((token) => token && !RANKING_TOKENS.has(token));
}

function relatedMetricColumn(rankingColumn: string, columns: string[], data: ResultRow[]) {
  const rankingTokens = new Set(columnTokens(rankingColumn));
  const candidates = metricColumns(columns, data)
    .filter((column) => column !== rankingColumn)
    .map((column) => {
      const tokens = columnTokens(column);
      const score = tokens.filter((token) => rankingTokens.has(token)).length;
      return { column, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  return candidates.length === 1 || candidates[0]?.score > (candidates[1]?.score ?? 0)
    ? candidates[0]?.column
    : undefined;
}

function rankingSummary(input: ExecutiveSummaryInput): ExecutiveSummaryResult | null {
  const { columns, data } = input;
  const hasWorstRanking = Boolean(findColumn(columns, ["ranking_menores"]));
  const rankingColumns = columns.filter((column) => {
    const normalized = columnKey(column);
    const isAmbiguousPerformance = hasWorstRanking && normalized.includes("ranking_desempenho");
    return !isAmbiguousPerformance && isRankingColumn(column) && validNumericRows(data, column).length > 0;
  });

  if (!rankingColumns.length) {
    return null;
  }

  const dimensionColumn = bestDimensionColumn(columns);
  const highlights = rankingColumns.map((rankingColumn) => {
    const numericRows = validNumericRows(data, rankingColumn);
    const bestRank = Math.min(...numericRows.map((item) => item.value));
    const leaders = numericRows.filter((item) => item.value === bestRank);
    const labels = leaders.map((item) => text(item.row, dimensionColumn, `linha ${item.index + 1}`));
    const metricColumn = relatedMetricColumn(rankingColumn, columns, data);
    const metricText =
      metricColumn && leaders.length === 1
        ? `, com ${metricColumn} de ${formatMetricValue(
            metricColumn,
            optionalNumberValue(leaders[0].row, metricColumn) ?? 0
          )}`
        : "";

    return `${rankingColumn}: liderança na posição ${formatNumber(bestRank)} para ${labels.join(
      ", "
    )}${metricText}.`;
  });

  return {
    title: SUMMARY_TITLE,
    paragraphs: [
      `Com base nos dados carregados, foram identificadas ${rankingColumns.length} colunas de ranking válidas em ${data.length} linhas.`,
      "A leitura abaixo destaca líderes objetivos dos rankings disponíveis, sem inferir causa de negócio."
    ],
    highlights
  };
}

function genericSummary(input: ExecutiveSummaryInput): ExecutiveSummaryResult {
  const { columns, data } = input;
  const metrics = metricColumns(columns, data).slice(0, 3);

  return {
    title: SUMMARY_TITLE,
    paragraphs: [
      `A tabela possui ${data.length} linhas e ${columns.length} colunas.`,
      metrics.length
        ? `Foram identificadas métricas financeiras como ${metrics.join(", ")}.`
        : "Não foram identificadas métricas numéricas financeiras suficientes para destaque executivo."
    ],
    highlights: [
      metrics.length
        ? "Não foi identificado um padrão executivo específico suficiente para inferir ranking ou variação."
        : "O resultado parece ser predominantemente categórico; mantenha a leitura no nível de tabela."
    ],
    warnings: ["Evite interpretar causalidade sem validar o contexto de negócio e os filtros da consulta."]
  };
}

export function generateExecutiveSummary(input: ExecutiveSummaryInput): ExecutiveSummaryResult {
  const normalizedInput = { ...input, columns: input.columns, data: input.data };

  if (!input.data.length || !input.columns.length) {
    return {
      title: SUMMARY_TITLE,
      paragraphs: ["Nenhum dado foi carregado para gerar uma interpretação executiva."],
      highlights: [],
      warnings: ["Carregue um resultado do Watson antes de gerar o resumo."]
    };
  }

  return (
    brandResultSummary(normalizedInput) ??
    costCenterSummary(normalizedInput) ??
    budgetVarianceSummary(normalizedInput) ??
    opexByBrandSectorSummary(normalizedInput) ??
    rankingSummary(normalizedInput) ??
    genericSummary(normalizedInput)
  );
}
