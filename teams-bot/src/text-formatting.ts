import type { ResultRow } from "./types.js";

const DIMENSION_COLUMNS = new Set([
  "conta_contabil",
  "nk_conta_contabil",
  "grupo_dre",
  "subgrupo",
  "marca",
  "setor",
  "centro_custo",
  "tipo_impacto",
  "tipo_variacao",
  "status_rol",
  "status_orcamento"
]);

export function normalizeTeamsMessage(text: string) {
  return text
    .replace(/<at>.*?<\/at>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const normalized = value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatBRL(value: number) {
  const formatted = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Math.abs(value));

  return value < 0 ? `-${formatted}` : formatted;
}

export function formatPercent(value: number) {
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;

  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(normalized)}%`;
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
}

export function formatTeamsTableValue(column: string, value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const normalizedColumn = column.trim().toLowerCase();
  const text = String(value).replace(/\s+/g, " ").trim();

  if (DIMENSION_COLUMNS.has(normalizedColumn)) {
    return text;
  }

  const numericValue = parseNumber(value);

  if (normalizedColumn.startsWith("ranking_") || normalizedColumn.includes("ranking")) {
    return numericValue === null ? text : formatNumber(Math.round(numericValue));
  }

  if (normalizedColumn.endsWith("_rs")) {
    return numericValue === null ? text : formatBRL(numericValue);
  }

  if (normalizedColumn.includes("_perc") || normalizedColumn.startsWith("perc_")) {
    return numericValue === null ? text : formatPercent(numericValue);
  }

  return numericValue !== null && typeof value === "number" ? formatNumber(numericValue) : text;
}

export function buildMarkdownReport({
  question,
  summary,
  queryId,
  rowCount,
  executionTimeMs,
  columns,
  dataPreview
}: {
  question: string;
  summary: { paragraphs: string[]; highlights: string[]; warnings?: string[]; intent?: string };
  queryId?: string;
  rowCount?: number;
  executionTimeMs?: number | null;
  columns: string[];
  dataPreview: ResultRow[];
}) {
  const tableColumns = columns.slice(0, 5);
  const rows = dataPreview.slice(0, 5);
  const table =
    tableColumns.length && rows.length
      ? [
          tableColumns.join(" | "),
          tableColumns.map(() => "---").join(" | "),
          ...rows.map((row) =>
            tableColumns.map((column) => formatTeamsTableValue(column, row[column])).join(" | ")
          )
        ].join("\n")
      : "Sem prévia tabular.";

  return `# Agente SQL Financeiro DuckLake — Relatório Executivo

## Pergunta
${question}

## Metadados
- Query ID: ${queryId || "Não informado"}
- Intenção: ${summary.intent || "Não informada"}
- Linhas: ${rowCount ?? "Não informado"}
- Tempo: ${
    executionTimeMs === null || executionTimeMs === undefined ? "Não informado" : `${executionTimeMs} ms`
  }

## Resumo executivo
${summary.paragraphs.join("\n\n")}

## Destaques
${summary.highlights.map((highlight) => `- ${highlight}`).join("\n")}

${
  summary.warnings?.length
    ? `## Observações e alertas\n${summary.warnings.map((warning) => `- ${warning}`).join("\n")}\n`
    : ""
}

## Tabela resumida
${table}
`;
}

export function truncateMarkdown(markdown: string, limit = 3500) {
  if (markdown.length <= limit) {
    return markdown;
  }

  return `${markdown.slice(0, limit)}

Markdown completo disponível no relatório salvo ou na interface.`;
}
