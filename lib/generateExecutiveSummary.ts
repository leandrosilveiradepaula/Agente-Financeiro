import { formatBRL, formatNumber, formatPercent } from "@/lib/number-formatting";
import { normalizeReportColumns, normalizeReportRows, parseReportNumber } from "@/lib/report-row-normalization";
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
  const { negativeRows, positiveRows, zeroRows } = splitVarianceRows(data);
  return negativeRows[0] ?? positiveRows[0] ?? zeroRows[0] ?? data[0];
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
  const highlights: string[] = [];
  const negative = negativeRows[0];
  const positive = positiveRows[0];

  if (negative) {
    highlights.push(
      `Maior variação negativa: ${text(negative, labelColumn)} com ${formatBRL(numberValue(negative, "variancia_rs"))}.`
    );
  }

  if (positive) {
    highlights.push(
      `Maior variação positiva: ${text(positive, labelColumn)} com ${formatBRL(numberValue(positive, "variancia_rs"))}.`
    );
  }

  return highlights;
}

function topLabels(rows: ResultRow[], labelColumn: string, limit = 3) {
  return rows.slice(0, limit).map((row) => text(row, labelColumn));
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
  const data = normalizeReportRows(input.data);
  const columns = normalizeReportColumns(input.columns, data);
  const normalizedInput = { ...input, columns, data };

  if (!data.length || !columns.length) {
    return {
      title: SUMMARY_TITLE,
      paragraphs: ["Nenhum dado foi carregado para gerar uma interpretação executiva."],
      highlights: [],
      warnings: ["Carregue um resultado do Watson antes de gerar o resumo."]
    };
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
