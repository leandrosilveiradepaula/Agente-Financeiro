import { formatBRL, formatNumber, formatPercentLiteral } from "@/lib/number-formatting";
import type { ResultRow } from "@/lib/types";

type ResultCellValue = ResultRow[string] | undefined;

export type ResultColumnKind =
  | "empty"
  | "boolean"
  | "identifier"
  | "ranking"
  | "percentage"
  | "date"
  | "currency"
  | "number"
  | "text";

const COLUMN_LABELS: Record<string, string> = {
  centro_custo: "Centro de Custo",
  conta_contabil: "Conta Contábil",
  grupo_dre: "Grupo DRE",
  marca: "Marca",
  receita: "Receita",
  receita_rs: "Receita",
  opex: "OPEX",
  opex_rs: "OPEX",
  opex_realizado_rs: "OPEX Realizado",
  opex_orcado_rs: "OPEX Orçado",
  realizado_rs: "Realizado",
  orcado_rs: "Orçado",
  variancia_rs: "Variação",
  variancia_perc: "Variação %",
  variancia_percentual: "Variação %",
  perc_orcado_consumido: "Orçamento Consumido",
  resultado_liquido_rs: "Resultado Líquido",
  resultado_perc_rol: "Resultado / ROL",
  ranking_desempenho: "Posição",
  ranking: "Posição",
  posicao: "Posição"
};

const KNOWN_ACRONYMS = new Set(["opex", "rol", "dre", "ebitda", "cmv", "id", "cpf", "cnpj"]);
const FALLBACK_TOKEN_LABELS: Record<string, string> = {
  metrica: "Métrica"
};

function normalizeColumn(column: string) {
  return column.trim().toLowerCase();
}

function displayText(value: ResultCellValue) {
  return String(value).replace(/\s+/g, " ").trim();
}

function titleCaseToken(token: string) {
  const normalized = token.toLowerCase();

  if (KNOWN_ACRONYMS.has(normalized)) {
    return normalized.toUpperCase();
  }

  if (FALLBACK_TOKEN_LABELS[normalized]) {
    return FALLBACK_TOKEN_LABELS[normalized];
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function isEmptyValue(value: ResultCellValue) {
  return value === null || value === undefined || value === "";
}

function numericLikeToNumber(value: ResultCellValue) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed || !/^-?\d+(?:[.,]\d+)?$/.test(trimmed)) {
    return null;
  }

  const numericValue = Number(trimmed.replace(",", "."));
  return Number.isFinite(numericValue) ? numericValue : null;
}

function isIdentifierColumn(normalizedColumn: string) {
  return (
    normalizedColumn === "id" ||
    normalizedColumn.endsWith("_id") ||
    normalizedColumn.includes("codigo") ||
    normalizedColumn.includes("cod") ||
    normalizedColumn.startsWith("nk_") ||
    normalizedColumn.includes("cpf") ||
    normalizedColumn.includes("cnpj")
  );
}

function isStructuredAccountingCode(column: string, value: ResultCellValue) {
  return normalizeColumn(column) === "conta_contabil" && typeof value === "string" && /[.\-/]/.test(value);
}

function isRankingColumn(normalizedColumn: string) {
  return normalizedColumn === "ranking" || normalizedColumn.includes("ranking") || normalizedColumn.includes("posicao");
}

function isPercentageColumn(normalizedColumn: string) {
  return (
    normalizedColumn.includes("perc") ||
    normalizedColumn.includes("percent") ||
    normalizedColumn.includes("percentual") ||
    normalizedColumn.includes("%")
  );
}

function isDateColumn(normalizedColumn: string) {
  return (
    normalizedColumn === "data" ||
    normalizedColumn.includes("_data") ||
    normalizedColumn.includes("data_") ||
    normalizedColumn.includes("date") ||
    normalizedColumn.includes("datetime") ||
    normalizedColumn.includes("timestamp") ||
    normalizedColumn.includes("periodo")
  );
}

function isIsoDateValue(value: ResultCellValue) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?$/.test(value.trim());
}

function isCurrencyColumn(normalizedColumn: string) {
  return (
    normalizedColumn.endsWith("_rs") ||
    normalizedColumn.includes("receita") ||
    normalizedColumn.includes("faturamento") ||
    normalizedColumn.includes("opex") ||
    normalizedColumn.includes("realizado") ||
    normalizedColumn.includes("orcado") ||
    normalizedColumn.includes("orçado") ||
    normalizedColumn.includes("orcamento") ||
    normalizedColumn.includes("orçamento") ||
    normalizedColumn.includes("custo") ||
    normalizedColumn.includes("despesa") ||
    normalizedColumn.includes("resultado") ||
    normalizedColumn.includes("lucro") ||
    (normalizedColumn.includes("variancia") && !isPercentageColumn(normalizedColumn))
  );
}

function formatDateValue(value: ResultCellValue) {
  if (typeof value !== "string") {
    return displayText(value);
  }

  const trimmed = value.trim();
  const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return `${day}/${month}/${year}`;
  }

  const parsed = new Date(trimmed);

  if (Number.isNaN(parsed.getTime())) {
    return displayText(value);
  }

  return parsed.toLocaleDateString("pt-BR");
}

export function getResultColumnLabel(column: string): string {
  const normalizedColumn = normalizeColumn(column);
  const explicitLabel = COLUMN_LABELS[normalizedColumn];

  if (explicitLabel) {
    return explicitLabel;
  }

  return normalizedColumn
    .split("_")
    .filter(Boolean)
    .map(titleCaseToken)
    .join(" ");
}

export function getResultColumnKind(column: string, value?: ResultCellValue): ResultColumnKind {
  const normalizedColumn = normalizeColumn(column);

  if (value !== undefined && isEmptyValue(value)) {
    return "empty";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  if (isIdentifierColumn(normalizedColumn) || isStructuredAccountingCode(column, value)) {
    return "identifier";
  }

  if (isRankingColumn(normalizedColumn)) {
    return "ranking";
  }

  if (isPercentageColumn(normalizedColumn)) {
    return "percentage";
  }

  if (isDateColumn(normalizedColumn) || isIsoDateValue(value)) {
    return "date";
  }

  const numericValue = numericLikeToNumber(value);

  if (numericValue !== null && isCurrencyColumn(normalizedColumn)) {
    return "currency";
  }

  if (numericValue !== null) {
    return "number";
  }

  return "text";
}

export function formatResultCellValue(column: string, value: ResultCellValue): string {
  const kind = getResultColumnKind(column, value);

  if (kind === "empty") {
    return "—";
  }

  if (kind === "boolean") {
    return value ? "Sim" : "Não";
  }

  if (kind === "identifier" || kind === "text") {
    return displayText(value);
  }

  if (kind === "date") {
    return formatDateValue(value);
  }

  const numericValue = numericLikeToNumber(value);

  if (numericValue === null) {
    return displayText(value);
  }

  if (kind === "ranking") {
    return Number.isInteger(numericValue) ? `${numericValue}º` : formatNumber(numericValue);
  }

  if (kind === "percentage") {
    return formatPercentLiteral(numericValue, 1);
  }

  if (kind === "currency") {
    return formatBRL(numericValue);
  }

  return formatNumber(numericValue);
}

export function getResultColumnAlignment(kind: ResultColumnKind): "left" | "center" | "right" {
  if (kind === "currency" || kind === "percentage" || kind === "number" || kind === "ranking") {
    return "right";
  }

  if (kind === "date") {
    return "center";
  }

  return "left";
}

export function getResultColumnKindFromRows(column: string, rows: ResultRow[]): ResultColumnKind {
  const sampleRow = rows.find((row) => !isEmptyValue(row[column]));
  return getResultColumnKind(column, sampleRow?.[column]);
}

export function isNegativeResultValue(column: string, value: ResultCellValue) {
  const kind = getResultColumnKind(column, value);
  const numericValue = numericLikeToNumber(value);

  return (
    numericValue !== null &&
    numericValue < 0 &&
    (kind === "currency" || kind === "percentage" || kind === "number")
  );
}
