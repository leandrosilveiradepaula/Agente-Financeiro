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

function normalizeColumn(column: string) {
  return column.trim().toLowerCase();
}

function normalizeColumnForMatching(column: string) {
  return column
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function hasColumns(columns: string[], required: string[]) {
  const available = new Set(columns.map(normalizeColumn));
  return required.every((column) => available.has(column));
}

function value(row: ResultRow | undefined, column: string): ResultRow[string] {
  return row?.[column] ?? row?.[column.toLowerCase()] ?? null;
}

function text(row: ResultRow | undefined, column: string, fallback = "não informado") {
  const raw = value(row, column);
  return raw === null || raw === undefined || raw === "" ? fallback : String(raw);
}

function numberValue(row: ResultRow | undefined, column: string): number {
  const raw = value(row, column);
  return parseReportNumber(raw) ?? 0;
}

function optionalNumberValue(row: ResultRow | undefined, column: string): number | null {
  return parseReportNumber(value(row, column));
}

function byNumber(data: ResultRow[], column: string, direction: "asc" | "desc") {
  return [...data].sort((a, b) => {
    const diff = numberValue(a, column) - numberValue(b, column);
    return direction === "asc" ? diff : -diff;
  });
}

function splitVarianceRows(data: ResultRow[]) {
  const negativeRows = byNumber(
    data.filter((row) => numberValue(row, "variancia_rs") < 0),
    "variancia_rs",
    "asc"
  );
  const positiveRows = byNumber(
    data.filter((row) => numberValue(row, "variancia_rs") > 0),
    "variancia_rs",
    "desc"
  );
  const zeroRows = data.filter((row) => numberValue(row, "variancia_rs") === 0);

  return { negativeRows, positiveRows, zeroRows };
}

function mainVarianceRow(data: ResultRow[]) {
  return [...data].sort(
    (a, b) => Math.abs(numberValue(b, "variancia_rs")) - Math.abs(numberValue(a, "variancia_rs"))
  )[0];
}

function varianceSignText(row: ResultRow | undefined) {
  const variance = numberValue(row, "variancia_rs");

  if (variance < 0) {
    return "variação negativa";
  }

  if (variance > 0) {
    return "variação positiva";
  }

  return "sem variação";
}

function varianceHighlights(data: ResultRow[], labelColumn: string) {
  const { negativeRows, positiveRows } = splitVarianceRows(data);
  const main = mainVarianceRow(data);
  const mainVariance = numberValue(main, "variancia_rs");
  const negative = negativeRows[0];
  const positive = positiveRows[0];
  const negativeHighlight = negative
    ? `Maior variação negativa: ${text(negative, labelColumn)} com ${formatBRL(numberValue(negative, "variancia_rs"))}.`
    : null;
  const positiveHighlight = positive
    ? `Maior variação positiva: ${text(positive, labelColumn)} com ${formatBRL(numberValue(positive, "variancia_rs"))}.`
    : null;

  if (mainVariance > 0) {
    return [positiveHighlight, negativeHighlight].filter(
      (highlight): highlight is string => Boolean(highlight)
    );
  }

  if (mainVariance < 0) {
    return [negativeHighlight, positiveHighlight].filter(
      (highlight): highlight is string => Boolean(highlight)
    );
  }

  return [negativeHighlight, positiveHighlight].filter(
    (highlight): highlight is string => Boolean(highlight)
  );
}

function topLabels(rows: ResultRow[], labelColumn: string, limit = 3) {
  return rows.slice(0, limit).map((row) => text(row, labelColumn));
}

function isRankingColumn(column: string) {
  return /(^|[_\s-])(ranking|rank|posicao|posição|classificacao|classificação)([_\s-]|$)/i.test(
    normalizeColumnForMatching(column)
  );
}

function validNumericRows(data: ResultRow[], column: string) {
  return data
    .map((row, index) => ({ row, index, value: optionalNumberValue(row, column) }))
    .filter((item): item is { row: ResultRow; index: number; value: number } => item.value !== null);
}

function uniqueCount(values: string[]) {
  return new Set(values.filter(Boolean)).size;
}

function bestTextDimension(columns: string[], data: ResultRow[]) {
  const candidates = columns
    .map((column) => {
      const values = data
        .map((row) => value(row, column))
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim());

      return { column, filled: values.length, unique: uniqueCount(values) };
    })
    .filter((candidate) => candidate.filled > 0);

  return candidates.sort((a, b) => b.unique - a.unique || b.filled - a.filled)[0]?.column;
}

function describeRow(row: ResultRow, rowIndex: number, dimensionColumn?: string) {
  if (dimensionColumn) {
    return text(row, dimensionColumn);
  }

  return `linha ${rowIndex + 1}`;
}

const RANKING_TOKENS = new Set(["ranking", "rank", "posicao", "classificacao"]);

function columnTokens(column: string) {
  return normalizeColumnForMatching(column)
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !RANKING_TOKENS.has(token));
}

function relatedMetricColumn(rankingColumn: string, columns: string[], data: ResultRow[]) {
  const rankingTokens = new Set(columnTokens(rankingColumn));
  const candidates = columns
    .filter((column) => column !== rankingColumn)
    .map((column) => {
      const hasNumericValue = data.some((row) => optionalNumberValue(row, column) !== null);
      if (!hasNumericValue) {
        return null;
      }

      const tokens = columnTokens(column);
      const score = tokens.filter((token) => rankingTokens.has(token)).length;
      return { column, score };
    })
    .filter((candidate): candidate is { column: string; score: number } => Boolean(candidate))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  return candidates.length === 1 || candidates[0]?.score > (candidates[1]?.score ?? 0)
    ? candidates[0]?.column
    : undefined;
}

function formatMetricValue(column: string, metricValue: number) {
  const normalized = normalizeColumnForMatching(column);

  if (normalized.endsWith("_rs")) {
    return formatBRL(metricValue);
  }

  if (normalized.includes("perc") || normalized.includes("%")) {
    return formatPercent(metricValue);
  }

  return formatNumber(metricValue);
}

function rankingSummary(input: ExecutiveSummaryInput): ExecutiveSummaryResult | null {
  const { columns, data } = input;
  const rankingColumns = columns.filter((column) => {
    return isRankingColumn(column) && validNumericRows(data, column).length > 0;
  });

  if (!rankingColumns.length) {
    return null;
  }

  const dimensionColumn = bestTextDimension(columns, data);
  const highlights = rankingColumns.map((rankingColumn) => {
    const numericRows = validNumericRows(data, rankingColumn);
    const bestRank = Math.min(...numericRows.map((item) => item.value));
    const leaders = numericRows.filter((item) => item.value === bestRank);
    const labels = leaders.map((item) => describeRow(item.row, item.index, dimensionColumn));
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
  const firstRow = data[0];
  const numericColumns = columns.filter((column) =>
    data.some((row) => Math.abs(numberValue(row, column)) > 0)
  );
  const topNumericHighlights = numericColumns.slice(0, 3).map((column) => {
    const topRow = byNumber(data, column, "desc")[0];
    return `${column}: maior valor observado foi ${formatNumber(numberValue(topRow, column))}.`;
  });

  return {
    title: SUMMARY_TITLE,
    paragraphs: [
      `Com base no resultado carregado, a tabela possui ${data.length} linhas e ${columns.length} colunas.`,
      "Não foi identificado um padrão específico de análise; portanto, a leitura abaixo destaca apenas sinais objetivos presentes nos dados."
    ],
    highlights: [
      firstRow
        ? `A primeira linha traz ${columns
            .slice(0, 4)
            .map((column) => `${column}: ${text(firstRow, column)}`)
            .join(", ")}.`
        : "Nenhuma linha disponível para análise.",
      ...topNumericHighlights
    ],
    warnings: ["Evite interpretar causalidade sem validar o contexto de negócio e os filtros da consulta."]
  };
}

function dreBudgetSummary(input: ExecutiveSummaryInput): ExecutiveSummaryResult {
  const { data } = input;
  const main = mainVarianceRow(data);

  return {
    title: SUMMARY_TITLE,
    paragraphs: [
      `Com base no resultado carregado, a principal ${varianceSignText(main)} observada foi em ${text(main, "grupo_dre")}, com variação de ${formatBRL(numberValue(main, "variancia_rs"))}, equivalente a ${formatPercent(numberValue(main, "variancia_perc"))} frente ao orçamento.`,
      "A leitura executiva deve priorizar as maiores variações absolutas, separando efeitos negativos e positivos no resultado."
    ],
    highlights: [
      ...varianceHighlights(data, "grupo_dre"),
      `${text(main, "tipo_variacao", "Tipo de variação não informado")} aparece como classificação do principal impacto.`
    ]
  };
}

function accountOverrunSummary(input: ExecutiveSummaryInput): ExecutiveSummaryResult {
  const { data } = input;
  const main = mainVarianceRow(data);
  const mainLabel =
    text(main, "conta_contabil", "") ||
    text(main, "subgrupo", "") ||
    text(main, "grupo_dre", "não informado");

  return {
    title: SUMMARY_TITLE,
    paragraphs: [
      `O maior ponto de atenção é ${mainLabel} em ${text(main, "subgrupo")}, com ${varianceSignText(main)} de ${formatBRL(numberValue(main, "variancia_rs"))}, equivalente a ${formatPercent(numberValue(main, "variancia_perc"))} frente ao orçamento.`,
      "Neste tipo de leitura, variância negativa representa estouro frente ao orçamento, enquanto variância positiva indica economia."
    ],
    highlights: [
      ...varianceHighlights(data, "conta_contabil"),
      `Grupo DRE do principal ponto: ${text(main, "grupo_dre")}.`
    ]
  };
}

function brandResultSummary(input: ExecutiveSummaryInput): ExecutiveSummaryResult {
  const { data } = input;
  const bestByValue = byNumber(data, "resultado_liquido_rs", "desc")[0];
  const validPercentRows = data.filter((row) => {
    const status = text(row, "status_rol", "").toLowerCase();
    return !status || (!status.includes("inv") && !status.includes("baixo") && !status.includes("zero") && !status.includes("neg"));
  });
  const bestByPercent = byNumber(validPercentRows.length ? validPercentRows : data, "resultado_perc_rol", "desc")[0];
  const excluded = data.filter((row) => row !== bestByPercent && text(row, "status_rol", "").trim());

  return {
    title: SUMMARY_TITLE,
    paragraphs: [
      `O melhor desempenho em valor aparece em ${text(bestByValue, "marca")}, com resultado líquido de ${formatBRL(numberValue(bestByValue, "resultado_liquido_rs"))}.`,
      `Em percentual sobre ROL, o destaque é ${text(bestByPercent, "marca")}, com ${formatPercent(numberValue(bestByPercent, "resultado_perc_rol"))}.`
    ],
    highlights: [
      "O ranking por valor mostra quem mais contribuiu em reais; o ranking percentual mostra eficiência relativa sobre a ROL.",
      excluded.length
        ? `Marcas com atenção no critério de ROL: ${topLabels(excluded, "marca").join(", ")}.`
        : "Não foram identificadas marcas fora do ranking percentual por restrição de ROL.",
      `Margem de contribuição do destaque em valor: ${formatBRL(numberValue(bestByValue, "margem_contribuicao_rs"))}.`
    ]
  };
}

function costCenterSummary(input: ExecutiveSummaryInput): ExecutiveSummaryResult {
  const { data } = input;
  const best = byNumber(data, "ranking_desempenho", "asc").slice(0, 3);
  const worst = byNumber(data, "ranking_desempenho", "desc").slice(0, 3);
  const withoutBudget = data.filter(
    (row) => numberValue(row, "opex_orcado_rs") === 0 && numberValue(row, "opex_realizado_rs") !== 0
  );

  return {
    title: SUMMARY_TITLE,
    paragraphs: [
      "A leitura de centros de custo compara consumo realizado contra orçamento e prioriza o ranking de desempenho.",
      "Variância positiva indica economia frente ao orçamento; variância negativa indica estouro."
    ],
    highlights: [
      `Melhores centros de custo: ${topLabels(best, "centro_custo").join(", ") || "não identificados"}.`,
      `Piores centros de custo: ${topLabels(worst, "centro_custo").join(", ") || "não identificados"}.`,
      withoutBudget.length
        ? `Centros sem orçamento com gasto realizado: ${topLabels(withoutBudget, "centro_custo").join(", ")}.`
        : "Não foram identificados centros sem orçamento com gasto realizado."
    ]
  };
}

function opexByBrandSectorSummary(input: ExecutiveSummaryInput): ExecutiveSummaryResult {
  const { data } = input;
  const brands = Array.from(new Set(data.map((row) => text(row, "marca", "")).filter(Boolean)));
  const topByBrand = brands.map((brand) => {
    const rows = data.filter((row) => text(row, "marca", "") === brand);
    return byNumber(rows, "perc_representatividade", "desc")[0] ?? rows[0];
  });
  const concentrated = topByBrand.filter((row) => numberValue(row, "perc_representatividade") > 50);
  const sectorCounts = new Map<string, number>();

  for (const row of topByBrand) {
    const sector = text(row, "setor", "");
    if (sector) {
      sectorCounts.set(sector, (sectorCounts.get(sector) ?? 0) + 1);
    }
  }

  const recurring = [...sectorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([sector]) => sector);

  return {
    title: SUMMARY_TITLE,
    paragraphs: [
      "A análise mostra o peso de cada setor no OPEX de sua respectiva marca.",
      "Maior representatividade significa maior concentração do gasto de OPEX dentro da marca."
    ],
    highlights: [
      `Principais setores por marca: ${topByBrand.map((row) => `${text(row, "marca")}: ${text(row, "setor")}`).join("; ")}.`,
      concentrated.length
        ? `Marcas com setor acima de 50% do OPEX: ${concentrated.map((row) => `${text(row, "marca")} (${text(row, "setor")})`).join(", ")}.`
        : "Nenhuma marca apresentou setor concentrando mais de 50% do OPEX.",
      `Setores recorrentes entre os maiores impactos: ${recurring.join(", ") || "não identificados"}.`
    ]
  };
}

export function generateExecutiveSummary(input: ExecutiveSummaryInput): ExecutiveSummaryResult {
  const data = input.data;
  const columns = input.columns;
  const normalizedInput = { ...input, columns, data };

  if (!data.length || !columns.length) {
    return {
      title: SUMMARY_TITLE,
      paragraphs: ["Nenhum dado foi carregado para gerar uma interpretação executiva."],
      highlights: [],
      warnings: ["Carregue um resultado do Watson antes de gerar o resumo."]
    };
  }

  const ranking = rankingSummary(normalizedInput);
  if (ranking) {
    return ranking;
  }

  if (
    hasColumns(columns, [
      "grupo_dre",
      "subgrupo",
      "conta_contabil",
      "realizado_rs",
      "orcado_rs",
      "variancia_rs",
      "variancia_perc",
      "tipo_variacao"
    ])
  ) {
    return accountOverrunSummary(normalizedInput);
  }

  if (
    hasColumns(columns, [
      "grupo_dre",
      "realizado_rs",
      "orcado_rs",
      "variancia_rs",
      "variancia_perc",
      "tipo_variacao"
    ])
  ) {
    return dreBudgetSummary(normalizedInput);
  }

  if (
    hasColumns(columns, [
      "tipo_impacto",
      "grupo_dre",
      "subgrupo",
      "conta_contabil",
      "realizado_rs",
      "orcado_rs",
      "variancia_rs",
      "variancia_perc",
      "ranking_no_tipo"
    ])
  ) {
    return accountOverrunSummary(normalizedInput);
  }

  if (
    hasColumns(columns, [
      "marca",
      "rol_rs",
      "cmv_rs",
      "lucro_bruto_rs",
      "margem_contribuicao_rs",
      "opex_rs",
      "resultado_liquido_rs",
      "resultado_perc_rol",
      "ranking_por_valor",
      "ranking_por_perc_rol",
      "status_rol"
    ])
  ) {
    return brandResultSummary(normalizedInput);
  }

  if (
    hasColumns(columns, [
      "centro_custo",
      "opex_realizado_rs",
      "opex_orcado_rs",
      "variancia_rs",
      "perc_orcado_consumido",
      "status_orcamento",
      "ranking_desempenho"
    ])
  ) {
    return costCenterSummary(normalizedInput);
  }

  if (
    hasColumns(columns, [
      "marca",
      "setor",
      "opex_rs",
      "total_opex_marca_rs",
      "perc_representatividade",
      "ranking_na_marca"
    ])
  ) {
    return opexByBrandSectorSummary(normalizedInput);
  }

  return genericSummary(normalizedInput);
}
